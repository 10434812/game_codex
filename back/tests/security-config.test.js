const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('production config does not ship insecure auth defaults', () => {
  const config = fs.readFileSync(path.join(__dirname, '../src/config/index.js'), 'utf8');
  const adminAuth = fs.readFileSync(path.join(__dirname, '../src/routes/admin/auth.js'), 'utf8');

  assert.doesNotMatch(config, /change-this-to-random-secret-in-production/);
  assert.doesNotMatch(config, /admin123/);
  assert.match(config, /requireProductionEnv/);
  assert.match(adminAuth, /config\.admin\.password/);
});

test('production CORS is environment controlled instead of unconditional wildcard', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const config = fs.readFileSync(path.join(__dirname, '../src/config/index.js'), 'utf8');

  assert.doesNotMatch(app, /app\.use\(cors\(\)\)/);
  assert.match(app, /cors\(\{ origin: config\.cors\.origin/);
  assert.match(config, /CORS_ORIGIN/);
});
