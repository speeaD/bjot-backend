const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { bachs, assertConfiguration, validSignature } = require('../utils/bachs');

const originalFetch = global.fetch;
const originalEnv = { BACHS_ENVIRONMENT: process.env.BACHS_ENVIRONMENT, BACHS_API_KEY: process.env.BACHS_API_KEY, BACHS_WEBHOOK_SECRET: process.env.BACHS_WEBHOOK_SECRET };
afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function sign(body, timestamp = String(Math.floor(Date.now() / 1000)), secret = 'endpoint-secret') {
  return { timestamp, signature: crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex') };
}

test('webhook authenticates the raw bytes and supports every V2 rotation signature', () => {
  process.env.BACHS_WEBHOOK_SECRET = 'endpoint-secret';
  const body = Buffer.from('{ "type": "collection.succeeded" }');
  const { timestamp, signature } = sign(body);
  const headers = { 'x-bachs-signature-v2': `t=${timestamp},v1=${'0'.repeat(64)},v1=${signature}` };
  assert.equal(validSignature(body, headers), true);
  assert.equal(validSignature(Buffer.from('{"type":"collection.succeeded"}'), headers), false);
  assert.equal(validSignature(body, { ...headers, 'x-bachs-signature-v2': `t=${timestamp},v1=${'1'.repeat(64)}` }), false);
});

test('webhook rejects stale/future timestamps, malformed signatures and ambiguous V2 timestamps', () => {
  process.env.BACHS_WEBHOOK_SECRET = 'endpoint-secret';
  const body = Buffer.from('{}');
  for (const offset of [-301, 301]) {
    const { timestamp, signature } = sign(body, String(Math.floor(Date.now() / 1000) + offset));
    assert.equal(validSignature(body, { 'x-bachs-timestamp': timestamp, 'x-bachs-signature': signature }), false);
  }
  const { timestamp, signature } = sign(body);
  for (const header of [`t=${timestamp},t=${timestamp},v1=${signature}`, `t=NaN,v1=${signature}`, `t=${timestamp},v1=short`, '']) {
    assert.equal(validSignature(body, { 'x-bachs-signature-v2': header, 'x-bachs-timestamp': timestamp, 'x-bachs-signature': signature }), false);
  }
  assert.equal(validSignature({}, { 'x-bachs-timestamp': timestamp, 'x-bachs-signature': signature }), false);
});

test('webhook accepts legacy headers and fails closed when secret is missing', () => {
  process.env.BACHS_WEBHOOK_SECRET = 'endpoint-secret';
  const body = Buffer.from('{}');
  const { timestamp, signature } = sign(body);
  assert.equal(validSignature(body, { 'x-bachs-timestamp': timestamp, 'x-bachs-signature': signature }), true);
  assert.equal(validSignature(body, new Headers({ 'X-Bachs-Signature-V2': `t=${timestamp},v1=${signature}` })), true);
  delete process.env.BACHS_WEBHOOK_SECRET;
  assert.throws(() => validSignature(body, {}), { status: 503 });
});

test('sandbox is the default and environment/key mismatches are rejected before network calls', async () => {
  delete process.env.BACHS_ENVIRONMENT;
  process.env.BACHS_API_KEY = 'sk_sandbox_test';
  assert.equal(assertConfiguration().baseUrl, 'https://sandbox-api.bachs.io');
  process.env.BACHS_API_KEY = 'sk_live_test';
  await assert.rejects(bachs('/v1/checkout-sessions'), { status: 503 });
  process.env.BACHS_ENVIRONMENT = 'live';
  assert.equal(assertConfiguration().baseUrl, 'https://api.bachs.io');
  process.env.BACHS_ENVIRONMENT = 'typo';
  assert.throws(assertConfiguration, { status: 503 });
});

test('checkout sends decimal amounts, bearer and idempotency headers and returns the raw resource', async () => {
  process.env.BACHS_ENVIRONMENT = 'sandbox';
  process.env.BACHS_API_KEY = 'sk_sandbox_test';
  const expected = { checkout_id: 'chk_test', checkout_url: 'https://sandbox-checkout.bachs.io/c/test' };
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://sandbox-api.bachs.io/v1/checkout-sessions');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer sk_sandbox_test');
    assert.equal(options.headers['Idempotency-Key'], 'bjot-example');
    assert.deepEqual(JSON.parse(options.body), { pricing: { currency: 'NGN', amount: '10000.00' } });
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => expected };
  };
  assert.equal(await bachs('/v1/checkout-sessions', { pricing: { currency: 'NGN', amount: '10000.00' } }, 'bjot-example'), expected);
});

test('provider and transport failures expose only a safe error', async () => {
  process.env.BACHS_ENVIRONMENT = 'sandbox';
  process.env.BACHS_API_KEY = 'sk_sandbox_test';
  for (const fakeFetch of [
    async () => ({ ok: false, json: async () => ({ error: 'customer@example.com private provider detail' }) }),
    async () => { throw new Error('sk_sandbox_test secret transport error'); },
    async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } }),
  ]) {
    global.fetch = fakeFetch;
    await assert.rejects(bachs('/v1/checkout-sessions/chk_test'), (error) => error.status === 502 && !/secret|@|sk_/.test(error.message));
  }
});
