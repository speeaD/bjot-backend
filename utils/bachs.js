const crypto = require('node:crypto');

const configurationError = () => Object.assign(
  new Error('Payments are not configured yet. Please contact BJOT support.'), { status: 503 },
);

function assertConfiguration() {
  const environment = process.env.BACHS_ENVIRONMENT || 'sandbox';
  const key = process.env.BACHS_API_KEY;
  if (!['sandbox', 'live'].includes(environment) || typeof key !== 'string' ||
      !key.startsWith(`sk_${environment}_`) || key.length <= `sk_${environment}_`.length) {
    throw configurationError();
  }
  return { key, baseUrl: environment === 'live' ? 'https://api.bachs.io' : 'https://sandbox-api.bachs.io' };
}

// Bachs resources are returned at the top level, without a data envelope.
// Keep the same idempotency key when retrying an uncertain checkout creation.
async function bachs(path, body, idempotencyKey) {
  const { key, baseUrl } = assertConfiguration();
  if (typeof path !== 'string' || !/^\/v1\/[a-z0-9/_-]+(?:%[0-9A-Fa-f]{2}[a-z0-9/_-]*)*$/i.test(path)) {
    throw new Error('Invalid Bachs resource path');
  }
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    const result = await response.json();
    if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result) || result.error) {
      throw new Error('Provider rejected request');
    }
    return result;
  } catch {
    // Do not forward provider messages, keys, or customer information to browsers/logs.
    throw Object.assign(new Error('Unable to complete the request with Bachs. Please retry shortly.'), { status: 502 });
  }
}

function headerValue(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name);
  return headers?.[name.toLowerCase()];
}

function validSignature(rawBody, headers) {
  const secret = process.env.BACHS_WEBHOOK_SECRET;
  if (!secret) throw configurationError();
  if (!Buffer.isBuffer(rawBody)) return false;
  const v2 = headerValue(headers, 'x-bachs-signature-v2');
  let timestamp;
  let signatures;
  if (v2 !== undefined && v2 !== null) {
    if (typeof v2 !== 'string') return false;
    const parts = v2.split(',').map((part) => part.trim());
    const timestamps = parts.filter((part) => part.startsWith('t='));
    if (timestamps.length !== 1) return false;
    timestamp = timestamps[0].slice(2);
    signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  } else {
    timestamp = headerValue(headers, 'x-bachs-timestamp');
    signatures = [headerValue(headers, 'x-bachs-signature')];
  }
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp) ||
      !Number.isSafeInteger(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  return signatures.some((signature) => typeof signature === 'string' && /^[a-f0-9]{64}$/i.test(signature) &&
    crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex')));
}

module.exports = { bachs, assertConfiguration, validSignature };
