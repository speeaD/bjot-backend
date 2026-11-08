const { ensurePublicMockDevice, requirePublicMockDevice } = require('../../utils/public-mock-device');

process.env.JWT_SECRET = 'public-mock-device-tests-only';
const devices = new Map();

function deviceHeaders(name = 'default') {
  if (!devices.has(name)) {
    ensurePublicMockDevice({}, { cookie(key, value) { devices.set(name, { cookie: `${key}=${encodeURIComponent(value)}` }); } });
  }
  return devices.get(name);
}

function headersForDevice(hash) {
  return [...devices.values()].find((headers) => requirePublicMockDevice({ headers }) === hash) || deviceHeaders();
}

module.exports = { deviceHeaders, headersForDevice };
