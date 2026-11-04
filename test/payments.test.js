const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { subscriptionFor, requirePro } = require('../utils/subscriptions');
const { paymentPlans, addMonths } = require('../utils/payment-plans');
const { kobo, validateCheckout, fulfillPayment } = require('../utils/payment-fulfillment');

const studentId = '00000000-0000-4000-8000-000000000001';
const reference = 'bjot-00000000-0000-4000-8000-000000000002';
const now = new Date('2026-11-04T10:00:00Z');
const originalEnvironment = { STUDENT_APP_URL: process.env.STUDENT_APP_URL, PRO_MAX_EXPIRES_AT: process.env.PRO_MAX_EXPIRES_AT, BACHS_WEBHOOK_SECRET: process.env.BACHS_WEBHOOK_SECRET };
let student, payments, providerCalls, studentWrites, paymentWrites, signatureValid, signatureInput, queue;
const copy = (value) => structuredClone(value);
const database = {
  quizTaker: {
    findUnique: async ({ where }) => where.id === student.id ? copy(student) : null,
    update: async ({ where, data }) => { assert.equal(where.id, student.id); studentWrites++; Object.assign(student, data); return copy(student); },
  },
  payment: {
    findUnique: async ({ where }) => copy(payments.find((item) => Object.entries(where).every(([key, value]) => item[key] === value)) || null),
    findFirst: async ({ where }) => copy(payments.find((item) => item.quizTakerId === where.quizTakerId && item.planId === where.planId && item.status === where.status && item.createdAt > where.createdAt.gt) || null),
    create: async ({ data }) => { const result = { id: `payment-${payments.length + 1}`, createdAt: new Date(), status: 'pending', fulfilledAt: null, ...data }; payments.push(result); return copy(result); },
    updateMany: async ({ where, data }) => { const matched = payments.filter((item) => Object.entries(where).every(([key, value]) => item[key] === value)); matched.forEach((item) => Object.assign(item, data)); return { count: matched.length }; },
    update: async ({ where, data }) => { paymentWrites++; const payment = payments.find((item) => item.id === where.id); Object.assign(payment, data); return copy(payment); },
  },
  $queryRaw: async (strings, id) => {
    assert.match(strings.join('?'), /quiz_takers.*FOR UPDATE/s);
    assert.equal(id, studentId);
    return [{ id }];
  },
  // Model the serial execution enforced by the PostgreSQL student row lock.
  $transaction: (callback) => {
    const result = queue.then(() => callback(database));
    queue = result.catch(() => {});
    return result;
  },
};
function payment(overrides = {}) {
  return { id: 'payment-1', reference, checkoutId: 'chk_test', quizTakerId: studentId,
    planId: 'science-foundation-pro', planLevel: 'pro', months: 1, fixedExpiresAt: null,
    amount: 1000000, currency: 'NGN', email: 'student@example.com', status: 'pending',
    createdAt: now, fulfilledAt: null, ...overrides };
}
function session(overrides = {}) {
  return { checkout_id: 'chk_test', reference, status: 'completed', payment_status: 'succeeded',
    amount: '10000.00', currency: 'NGN', customer: { email: 'student@example.com' },
    charge: { status: 'succeeded', amount: '10000.00', currency: 'NGN' }, completed_at: now.toISOString(), ...overrides };
}
let providerSession;
const provider = {
  assertConfiguration: () => ({ apiKey: 'test', baseUrl: 'https://sandbox-api.bachs.io' }),
  bachs: async (url, body, idempotencyKey) => {
    providerCalls.push({ url, body, idempotencyKey });
    return body ? { checkout_id: 'chk_created', checkout_url: 'https://checkout.bachs.io/c/test' } : copy(providerSession);
  },
  validSignature: (body, headers) => { signatureInput = { body, headers }; return signatureValid; },
};
for (const [filename, exports] of [['../utils/database', database], ['../utils/bachs', provider]]) {
  const resolved = path.resolve(__dirname, `${filename}.js`);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const router = require('../routes/payments');
const { verifyQuizTaker } = require('../middleware/auth');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, sendStatus(code) { this.statusCode = code; return this; } });
async function call(method, route, body, params = {}, owner = studentId, headers = {}) {
  const handler = router.stack.find((layer) => layer.route?.path === route && layer.route.methods[method]).route.stack.at(-1).handle;
  const res = response();
  await handler({ body, params, headers, quizTaker: { ...student, id: owner } }, res);
  return res;
}
beforeEach(() => {
  student = { id: studentId, email: 'student@example.com', accountType: 'regular', isActive: true };
  payments = []; providerCalls = []; studentWrites = 0; paymentWrites = 0;
  signatureValid = true; signatureInput = null; queue = Promise.resolve(); providerSession = session();
  process.env.STUDENT_APP_URL = 'https://students.example.com';
  process.env.BACHS_WEBHOOK_SECRET = 'test-webhook-secret';
  delete process.env.PRO_MAX_EXPIRES_AT;
});
after(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('exact decimal amounts reject malformed, fractional-kobo and unsafe values', () => {
  assert.equal(kobo('10000.00'), 1000000);
  assert.equal(kobo('0.01'), 1);
  for (const value of ['1e4', '1.001', '-1', 'NaN', '', '1,000.00', 10000, '9007199254740991']) assert.equal(kobo(value), null);
});

test('calendar-month terms clamp month-end and Max stops at the March Lagos boundary', () => {
  assert.equal(addMonths(new Date('2027-01-31T12:00:00Z'), 1).toISOString(), '2027-02-28T12:00:00.000Z');
  const plans = paymentPlans(now);
  assert.equal(plans.length, 14);
  assert.equal(plans.find((item) => item.id === 'art-commercial-ultimate-pro').amount, 2400000);
  assert.equal(plans.find((item) => item.id === 'science-ultimate-pro-max').expiresAt, '2027-03-31T23:00:00.000Z');
  assert(paymentPlans(new Date('2027-03-31T23:00:00Z')).filter((item) => item.level === 'pro-max').every((item) => !item.available));
});

test('legacy premium and Lite have no Pro access; expiration is checked at the exact boundary', () => {
  for (const value of [student, { ...student, accountType: 'premium' }, { ...student, accountType: 'premium', subscriptionLevel: 'lite' }]) {
    assert.equal(subscriptionFor(value, now).hasProAccess, false);
    let allowed = false;
    const res = response();
    requirePro({ quizTaker: value }, res, () => { allowed = true; });
    assert.equal(allowed, false); assert.equal(res.statusCode, 403); assert.equal(res.body.code, 'PRO_REQUIRED');
  }
  const subscribed = { ...student, accountType: 'premium', subscriptionLevel: 'pro', subscriptionExpiresAt: now };
  assert.equal(subscriptionFor(subscribed, new Date(now.getTime() - 1)).hasProAccess, true);
  assert.equal(subscriptionFor(subscribed, now).accountType, 'regular');
  assert.equal(subscriptionFor(subscribed, now).hasProAccess, false);
});

test('successful-looking checkout with wrong identity or money cannot grant access', async () => {
  const changes = [{ amount: '9999.99' }, { currency: 'USD' }, { checkout_id: 'chk_other' }, { reference: 'other' },
    { customer: { email: 'other@example.com' } }, { charge: null },
    { charge: { status: 'succeeded', currency: 'USD', amount: '10000.00' } },
    { charge: { status: 'succeeded', currency: 'NGN', amount: '9999.99' } }];
  for (const change of changes) await assert.rejects(fulfillPayment(database, payment(), session(change), now), { status: 409 });
  assert.equal(studentWrites, 0); assert.equal(paymentWrites, 0);
});

test('pending and free/trial completion never grant paid access', async () => {
  for (const change of [{ status: 'open', payment_status: 'pending' }, { payment_status: 'no_payment_required' }, { payment_status: 'failed' }]) {
    assert.equal(await fulfillPayment(database, payment(), session(change), now), false);
  }
  assert.equal(studentWrites, 0); assert.equal(paymentWrites, 0);
});

test('concurrent callback and webhook fulfillment grant once under serialized student lock', async () => {
  const original = payment(); payments.push(copy(original));
  const results = await Promise.all(Array.from({ length: 8 }, () => fulfillPayment(database, original, session(), now)));
  assert(results.every(Boolean)); assert.equal(studentWrites, 1); assert.equal(paymentWrites, 1);
  assert.equal(student.subscriptionExpiresAt.toISOString(), '2026-12-04T10:00:00.000Z');
  assert.equal(subscriptionFor(student, now).hasProAccess, true); assert.equal(payments[0].status, 'success');
});

test('same-level renewal extends existing expiry and late lower-tier payment cannot downgrade', async () => {
  Object.assign(student, { accountType: 'premium', subscriptionLevel: 'pro', subscriptionExpiresAt: new Date('2026-12-31T10:00:00Z') });
  payments.push(payment());
  await fulfillPayment(database, payment(), session(), now);
  assert.equal(student.subscriptionExpiresAt.toISOString(), '2027-01-31T10:00:00.000Z');
  const lower = payment({ id: 'payment-2', reference: `${reference.slice(0, -1)}3`, planLevel: 'lite' }); payments.push(lower);
  await assert.rejects(fulfillPayment(database, lower, session({ reference: lower.reference }), now), { status: 409 });
  assert.equal(student.subscriptionLevel, 'pro'); assert.equal(studentWrites, 1);
});

test('paid routes require authentication while provider webhook precedes it', () => {
  const authIndex = router.stack.findIndex((layer) => layer.handle === verifyQuizTaker);
  assert(authIndex >= 0);
  assert(router.stack.findIndex((layer) => layer.route?.path === '/webhook') < authIndex);
  for (const route of ['/plans', '/subscription', '/initialize', '/verify/:reference']) {
    assert(router.stack.findIndex((layer) => layer.route?.path === route) > authIndex);
  }
});

test('checkout ignores client amount, currency, email, expiry and access level', async () => {
  const res = await call('post', '/initialize', { planId: 'science-foundation-lite', amount: 1, currency: 'USD', email: 'attacker@example.com', planLevel: 'pro-max', months: 99 });
  assert.equal(res.statusCode, 200);
  assert.equal(payments[0].amount, 900000); assert.equal(payments[0].planLevel, 'lite'); assert.equal(payments[0].months, 1);
  assert.equal(payments[0].email, student.email);
  assert.deepEqual(providerCalls[0].body.pricing, { amount: '9000.00', currency: 'NGN' });
  assert.equal(providerCalls[0].idempotencyKey, payments[0].reference);
  assert.equal(studentWrites, 0);
});

test('invalid plans and active-plan downgrades do not reach the gateway', async () => {
  assert.equal((await call('post', '/initialize', { planId: 'free-pro-max' })).statusCode, 400);
  Object.assign(student, { accountType: 'premium', subscriptionLevel: 'pro', subscriptionExpiresAt: new Date('2099-01-01') });
  assert.equal((await call('post', '/initialize', { planId: 'science-foundation-lite' })).statusCode, 409);
  assert.equal(providerCalls.length, 0); assert.equal(payments.length, 0);
});

test('checkout retries reuse the persisted payment and hosted checkout', async () => {
  const first = await call('post', '/initialize', { planId: 'science-foundation-pro' });
  const second = await call('post', '/initialize', { planId: 'science-foundation-pro' });
  assert.deepEqual(first.body, second.body); assert.equal(payments.length, 1); assert.equal(providerCalls.length, 1);
});

test('verification rejects another student payment before querying Bachs', async () => {
  payments.push(payment());
  const res = await call('get', '/verify/:reference', undefined, { reference }, '00000000-0000-4000-8000-000000000099');
  assert.equal(res.statusCode, 404); assert.equal(providerCalls.length, 0); assert.equal(studentWrites, 0);
});

test('verification reports pending without upgrade, and verifies a successful payment on server', async () => {
  payments.push(payment()); providerSession = session({ status: 'open', payment_status: 'pending' });
  assert.equal((await call('get', '/verify/:reference', undefined, { reference })).body.status, 'pending');
  assert.equal(studentWrites, 0);
  providerSession = session();
  const res = await call('get', '/verify/:reference', undefined, { reference });
  assert.equal(res.body.status, 'success'); assert.equal(res.body.subscription.hasProAccess, true);
});

test('webhook rejects invalid signature before reading payment state and preserves raw bytes', async () => {
  signatureValid = false;
  const raw = Buffer.from('{ "type": "collection.succeeded", "data": {"checkout_id":"chk_test"}}');
  const headers = { 'x-bachs-signature-v2': 'test' };
  const res = await call('post', '/webhook', raw, {}, studentId, headers);
  assert.equal(res.statusCode, 400); assert.equal(signatureInput.body, raw); assert.equal(signatureInput.headers, headers);
  assert.equal(providerCalls.length, 0); assert.equal(studentWrites, 0);
});

test('webhook only reconciles known collections and duplicate deliveries do not regrant', async () => {
  payments.push(payment());
  const emit = (type, checkoutId = 'chk_test') => call('post', '/webhook', Buffer.from(JSON.stringify({ type, data: { checkout_id: checkoutId } })));
  assert.equal((await emit('checkout.completed')).statusCode, 200);
  assert.equal((await emit('collection.succeeded', 'chk_unknown')).statusCode, 200);
  assert.equal(studentWrites, 0);
  assert.equal((await emit('collection.succeeded')).statusCode, 200);
  assert.equal((await emit('collection.succeeded')).statusCode, 200);
  assert.equal(studentWrites, 1); assert.equal(providerCalls.length, 1);
});


test('expired or cancelled checkout is retired so the student can start a fresh checkout', async () => {
  for (const status of ['expired', 'cancelled']) {
    payments = [payment({ createdAt: new Date() })];
    providerSession = session({ status, payment_status: 'pending' });
    const verified = await call('get', '/verify/:reference', undefined, { reference });
    assert.equal(verified.statusCode, 400);
    assert.equal(payments[0].status, 'failed');
    assert.equal(studentWrites, 0);
    const replacement = await call('post', '/initialize', { planId: 'science-foundation-pro' });
    assert.equal(replacement.statusCode, 200);
    assert.notEqual(replacement.body.reference, reference);
    assert.equal(payments.length, 2);
  }
});

test('Pro Max checkout cannot shorten an existing paid term beyond its fixed cutoff', async () => {
  Object.assign(student, { accountType: 'premium', subscriptionLevel: 'pro', subscriptionExpiresAt: new Date('2099-05-01') });
  // Keep the tutorial offer current independently of the wall clock.
  process.env.PRO_MAX_EXPIRES_AT = '2099-03-31T23:00:00Z';
  const res = await call('post', '/initialize', { planId: 'science-ultimate-pro-max' });
  assert.equal(res.statusCode, 409); assert.equal(payments.length, 0); assert.equal(providerCalls.length, 0);
});

test('Pro Max cannot fulfill after its cutoff or overwrite longer access changed since checkout', async () => {
  const cutoff = new Date('2027-03-31T23:00:00Z');
  const maxPayment = payment({ planId: 'science-ultimate-pro-max', planLevel: 'pro-max', months: null, fixedExpiresAt: cutoff });
  payments.push(copy(maxPayment));
  await assert.rejects(fulfillPayment(database, maxPayment, session(), cutoff), { status: 409 });
  assert.equal(studentWrites, 0); assert.equal(paymentWrites, 0);
  Object.assign(student, { accountType: 'premium', subscriptionLevel: 'pro', subscriptionExpiresAt: new Date('2027-05-01') });
  await assert.rejects(fulfillPayment(database, maxPayment, session(), now), { status: 409 });
  assert.equal(studentWrites, 0); assert.equal(paymentWrites, 0);
  assert.equal(student.subscriptionLevel, 'pro');
});
