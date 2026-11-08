const test = require('node:test');
const assert = require('node:assert/strict');
const { DEVICE_COOKIE, ensurePublicMockDevice, requirePublicMockDevice } = require('../utils/public-mock-device');
const { deviceHeaders } = require('./helpers/public-device');

test('device cookies are signed, opaque, persistent, HttpOnly and scoped to the site', () => {
  let cookie;
  ensurePublicMockDevice({}, { cookie(...args) { cookie = args; } });
  const [name, value, options] = cookie;
  assert.equal(name, DEVICE_COOKIE);
  assert.match(value, /^v1\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/');
  assert.equal(options.maxAge, 365 * 24 * 60 * 60 * 1000);
  const request = { headers: { cookie: `${name}=${value}` } };
  const hash = requirePublicMockDevice(request);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, value.split('.')[1]);
  assert.equal(requirePublicMockDevice(request), hash);
  ensurePublicMockDevice(request, { cookie() { assert.fail('must preserve an existing device identity'); } });
});

test('production device cookies require HTTPS', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { ensurePublicMockDevice({}, { cookie(_name, _value, options) { assert.equal(options.secure, true); } }); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test('missing, forged, malformed and duplicate cookies cannot start a device-bound attempt', () => {
  const valid = deviceHeaders('tampering').cookie;
  for (const headers of [{}, { 'x-device-id': 'anything' }, { cookie: `${DEVICE_COOKIE}=%broken` },
    { cookie: `${DEVICE_COOKIE}=v1.${'a'.repeat(64)}.${'b'.repeat(64)}` }, { cookie: `${valid}; ${valid}` }]) {
    assert.throws(() => requirePublicMockDevice({ headers }), { statusCode: 428 });
  }
  const tampered = valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0');
  assert.throws(() => requirePublicMockDevice({ headers: { cookie: tampered } }), { statusCode: 428 });
  assert.equal(requirePublicMockDevice({ headers: { cookie: `other=value; ${valid}; auth-token=private` } }),
    requirePublicMockDevice({ headers: { cookie: valid } }));
});

test('registration replaces an invalid cookie while each new browser receives a distinct identity', () => {
  let replacement;
  ensurePublicMockDevice({ headers: { cookie: `${DEVICE_COOKIE}=forged` } }, {
    cookie(name, value) { replacement = { cookie: `${name}=${value}` }; },
  });
  assert.match(requirePublicMockDevice({ headers: replacement }), /^[a-f0-9]{64}$/);
  assert.notEqual(requirePublicMockDevice({ headers: deviceHeaders('browser-one') }), requirePublicMockDevice({ headers: deviceHeaders('browser-two') }));
});
