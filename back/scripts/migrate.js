const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
async function loadMigrations(directory = path.join(__dirname, '../sql')) {
  const names = (await fs.readdir(directory)).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async (name) => {
    const sql = await fs.readFile(path.join(directory, name), 'utf8');
    return {name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex')};
  }));
}
function plan(migrations, applied, baseline) {
  if (baseline && !migrations.some((entry) => entry.name === baseline)) throw new Error('Unknown baseline filename');
  const known = new Map(applied.map((row) => [row.name, row.checksum]));
  return migrations.map((entry) => {
    const previous = known.get(entry.name);
    if (previous && previous !== entry.checksum) throw new Error(`Applied migration was changed: ${entry.name}`);
    return {...entry, action: previous ? 'skip' : baseline && entry.name <= baseline ? 'baseline' : 'apply'};
  });
}
async function migrate(args = process.argv.slice(2)) {
  const dry = args.includes('--dry-run'), bi = args.indexOf('--baseline');
  const baseline = bi >= 0 ? args[bi + 1] : undefined;
  if (bi >= 0 && !baseline) throw new Error('--baseline requires a filename');
  const valid = args.every((arg, i) => arg === '--dry-run' || arg === '--baseline' || (bi >= 0 && i === bi + 1));
  if (!valid) throw new Error('Unknown migration argument');
  const migrations = await loadMigrations();
  plan(migrations, [], baseline);
  const mysql = require('mysql2/promise'), config = require('../src/config');
  // Dedicated connection; API pool must never enable multipleStatements.
  const connection = await mysql.createConnection({...config.db, multipleStatements: true});
  let locked = false;
  try {
    if (dry) {
      const [exists] = await connection.execute("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", ['schema_migrations']);
      const [applied] = exists.length ? await connection.execute('SELECT name, checksum FROM schema_migrations') : [[]];
      for (const entry of plan(migrations, applied, baseline)) console.log(`${entry.action}: ${entry.name}`);
      return;
    }
    const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [`${config.db.database}:migrations`]);
    if (Number(lock.acquired) !== 1) throw new Error('Another migration process holds the lock');
    locked = true;
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(128) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
    const [applied] = await connection.execute('SELECT name, checksum FROM schema_migrations');
    for (const entry of plan(migrations, applied, baseline)) {
      if (entry.action === 'skip') continue;
      // DDL commits implicitly. On failure inspect partial DDL before retrying.
      if (entry.action === 'apply') await connection.query(entry.sql);
      await connection.execute('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [entry.name, entry.checksum]);
      console.log(`${entry.action}: ${entry.name}`);
    }
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [`${config.db.database}:migrations`]).catch(() => {});
    await connection.end();
  }
}
if (require.main === module) migrate().catch((error) => {console.error(error.code || error.message); process.exitCode = 1;});
module.exports = {loadMigrations, plan, migrate};
