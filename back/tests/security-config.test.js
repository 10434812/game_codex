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

test('avatar upload URL uses CDN or forwarded public origin instead of localhost default', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/user.js'), 'utf8');
  const envExample = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');

  assert.match(routeSource, /CDN_BASE_URL/);
  assert.match(routeSource, /x-forwarded-host/);
  assert.match(routeSource, /x-forwarded-proto/);
  assert.doesNotMatch(routeSource, /http:\/\/localhost:\$\{process\.env\.PORT/);
  assert.match(envExample, /CDN_BASE_URL=/);
});
