const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const DEVICE_COOKIE = 'bjot_public_mock_device';
const TOKEN = /^v1\.([a-f0-9]{64})\.([a-f0-9]{64})$/;

function signature(id) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required to sign public mock device cookies');
  return createHmac('sha256', secret).update(`public-mock-device:v1:${id}`).digest('hex');
}

function readToken(req) {
  const cookies = (req.headers?.cookie || '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${DEVICE_COOKIE}=`));
  if (cookies.length !== 1) return null;
  try { return decodeURIComponent(cookies[0].slice(DEVICE_COOKIE.length + 1)); }
  catch { return null; }
}

function verifiedId(req) {
  const match = TOKEN.exec(readToken(req) || '');
  if (!match || !timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(signature(match[1]), 'hex'))) return null;
  return match[1];
}

function ensurePublicMockDevice(req, res) {
  if (verifiedId(req)) return;
  const id = randomBytes(32).toString('hex');
  res.cookie(DEVICE_COOKIE, `v1.${id}.${signature(id)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

function requirePublicMockDevice(req) {
  const id = verifiedId(req);
  if (!id) {
    throw Object.assign(new Error('Allow cookies and reload the mock page before starting or submitting this exam.'), { statusCode: 428 });
  }
  // Store only an opaque hash, never the browser's signed token.
  return createHash('sha256').update(id).digest('hex');
}

module.exports = { DEVICE_COOKIE, ensurePublicMockDevice, requirePublicMockDevice };
