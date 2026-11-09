const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { subscriptionUpdate, adminStudent, adminSubscriptionOptions } = require('../utils/admin-subscriptions');
const { requirePro } = require('../utils/subscriptions');
const now = new Date('2026-11-09T12:00:00Z');
const expiry = '2098-12-31T23:00:00.000Z';
const cutoff = '2099-03-31T23:00:00.000Z';
const previousCutoff = process.env.PRO_MAX_EXPIRES_AT;
process.env.PRO_MAX_EXPIRES_AT = cutoff;
test.after(() => { if (previousCutoff === undefined) delete process.env.PRO_MAX_EXPIRES_AT; else process.env.PRO_MAX_EXPIRES_AT = previousCutoff; });

let students, events, sequence;
const db = {
  quizTaker: {
    findUnique: async ({ where }) => students.find((student) => where.id ? student.id === where.id : student.accessCode === where.accessCode) || null,
    findFirst: async ({ where }) => students.find((student) => (!where.email || student.email === where.email) && (!where.accountType || student.accountType === where.accountType) && student.id !== where.NOT?.id) || null,
    findMany: async () => students,
    count: async () => students.length,
    create: async ({ data }) => { const student = { id: `student-${sequence++}`, isActive: true, questionSets: [], assignedQuizzes: [], ...data }; students.push(student); events.push('create'); return student; },
    update: async ({ where, data }) => { events.push('update'); return Object.assign(students.find((student) => student.id === where.id), data); },
  },
  questionSet: { findMany: async () => ['English', 'Physics', 'Chemistry', 'Biology'].map((title, i) => ({ id: `subject-${i}`, title })) },
  quizTakerQuestionSet: { createMany: async () => {}, deleteMany: async () => {} },
  $queryRaw: async (parts, id) => { assert.match(parts.join(''), /quiz_takers[\s\S]*FOR UPDATE/); events.push(`lock:${id}`); return [{ id }]; },
  $transaction: async (run) => run(db),
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
const router = require('../routes/admin');
const { verifyAdmin } = require('../middleware/auth');
test.beforeEach(() => {
  students = [{ id: 'legacy', email: 'legacy@example.com', accountType: 'premium', subscriptionLevel: null, subscriptionPlanId: null,
    subscriptionExpiresAt: null, accessCode: 'ABC123456', isActive: true, questionSets: [], assignedQuizzes: [] }];
  events = []; sequence = 1;
});
async function call(method, path, body = {}, params = {}, file) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await route.stack.at(-1).handle({ body, params, query: {}, file, admin: { id: 'admin' } }, response);
  return response;
}

test('manual tiers have a future expiry, preserve same-tier catalogue IDs, and respect the Pro Max tutorial boundary', () => {
  const patch = subscriptionUpdate({}, { accountType: 'premium', subscriptionLevel: 'pro', subscriptionExpiresAt: expiry }, now);
  assert.equal(patch.subscriptionPlanId, 'admin-pro');
  assert.equal(patch.accountType, 'premium');
  assert.equal(adminStudent(patch, now).subscription.hasProAccess, true);
  assert.equal(subscriptionUpdate({ subscriptionLevel: 'pro', subscriptionPlanId: 'science-foundation-pro' }, { subscriptionLevel: 'pro', subscriptionExpiresAt: expiry }, now).subscriptionPlanId, 'science-foundation-pro');
  assert.equal(subscriptionUpdate({}, { subscriptionLevel: 'pro-max', subscriptionExpiresAt: cutoff }, now).subscriptionLevel, 'pro-max');
  assert.equal(adminSubscriptionOptions(now).proMaxExpiresAt, cutoff);
  for (const input of [
    { subscriptionLevel: 'invalid', subscriptionExpiresAt: expiry },
    { subscriptionLevel: 'pro' }, { subscriptionLevel: 'pro', subscriptionExpiresAt: null },
    { subscriptionLevel: 'pro', subscriptionExpiresAt: 'not-a-date' },
    { subscriptionLevel: 'pro', subscriptionExpiresAt: '2026-01-01T00:00:00Z' },
    { subscriptionLevel: 'pro-max', subscriptionExpiresAt: '2100-01-01T00:00:00Z' },
    { accountType: 'regular', subscriptionLevel: 'pro', subscriptionExpiresAt: expiry },
  ]) assert.throws(() => subscriptionUpdate({}, input, now), { statusCode: 400 });
});

test('generic membership changes never guess a paid tier, erase a current paid plan, or reactivate stale entitlements', () => {
  const paid = { accountType: 'premium', subscriptionLevel: 'pro-max', subscriptionPlanId: 'science-ultimate-pro-max', subscriptionExpiresAt: cutoff };
  assert.deepEqual(subscriptionUpdate(paid, { isActive: false }, now), {});
  assert.deepEqual(subscriptionUpdate(paid, { accountType: 'premium' }, now), {});
  const regular = { ...paid, accountType: 'regular', ...subscriptionUpdate(paid, { accountType: 'regular' }, now) };
  assert.equal(regular.subscriptionLevel, null);
  const legacy = { ...regular, accountType: 'premium', ...subscriptionUpdate(regular, { accountType: 'premium' }, now) };
  assert.equal(adminStudent(legacy, now).subscription.hasProAccess, false);
});

test('admin directory shows effective Pro, Pro Max, expired, and unset-plan membership without guessing existing students', async () => {
  students.push(...['pro', 'pro-max'].map((level) => ({ ...students[0], id: level, email: `${level}@example.com`, subscriptionLevel: level, subscriptionExpiresAt: expiry })));
  students.push({ ...students[0], id: 'expired', subscriptionLevel: 'pro', subscriptionExpiresAt: new Date(0) });
  const response = await call('get', '/quiztakers');
  assert.equal(response.body.quizTakers.find((student) => student.id === 'pro').subscription.planLevel, 'pro');
  assert.equal(response.body.quizTakers.find((student) => student.id === 'pro-max').subscription.planLevel, 'pro-max');
  assert.equal(response.body.quizTakers.find((student) => student.id === 'expired').subscription.hasProAccess, false);
  assert.equal(response.body.quizTakers.find((student) => student.id === 'legacy').subscription.planLevel, null);
  assert.equal(response.body.subscriptionOptions.proMaxExpiresAt, cutoff);
});

test('setting an existing legacy student to Pro immediately enables the JAMB authorization guard and preserves login/subjects', async () => {
  const response = await call('put', '/quiztaker/:id', { accountType: 'premium', subscriptionLevel: 'pro', subscriptionExpiresAt: expiry }, { id: 'legacy' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.quizTaker.subscription.hasProAccess, true);
  assert.equal(students[0].accessCode, 'ABC123456');
  let allowed = false;
  requirePro({ quizTaker: students[0] }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
  assert(events.indexOf('lock:legacy') < events.indexOf('update'));
  assert.equal((await call('put', '/quiztaker/:id', { subscriptionLevel: 'pro-max', subscriptionExpiresAt: cutoff }, { id: 'legacy' })).body.quizTaker.subscription.planLevel, 'pro-max');
});

test('paid creation and plan-only upgrades issue a login code; malformed paid plans fail without writes', async () => {
  const created = await call('post', '/quiztaker', { email: 'pro@example.com', accountType: 'premium', subscriptionLevel: 'pro', subscriptionExpiresAt: expiry });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.quizTaker.subscription.hasProAccess, true);
  assert.match(created.body.quizTaker.accessCode, /^[A-Z0-9]{9}$/);
  students[0].accountType = 'regular'; students[0].accessCode = null;
  assert.equal((await call('put', '/quiztaker/:id', { subscriptionLevel: 'pro', subscriptionExpiresAt: expiry }, { id: 'legacy' })).statusCode, 200);
  assert.match(students[0].accessCode, /^[A-Z0-9]{9}$/);
  events = [];
  const bad = await call('post', '/quiztaker', { email: 'bad@example.com', accountType: 'premium', subscriptionLevel: 'pro' });
  assert.equal(bad.statusCode, 400);
  assert.equal(events.includes('create'), false);
});

test('CSV imports persist the explicit tier and expiry, and reject paid rows without expiry', async () => {
  const sheet = XLSX.utils.json_to_sheet(['valid@example.com', 'invalid@example.com'].map((email, index) => ({ email, accountType: 'premium', subscriptionLevel: 'pro', subscriptionExpiresAt: index ? '' : expiry,
    questionSet1: 'English', questionSet2: 'Physics', questionSet3: 'Chemistry', questionSet4: 'Biology' })));
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Students');
  const response = await call('post', '/bulk-upload-quiztakers', {}, {}, { buffer: XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) });
  assert.equal(response.body.results.successCount, 1);
  assert.equal(response.body.results.failCount, 1);
  assert.equal(students.find((student) => student.email === 'valid@example.com').subscriptionLevel, 'pro');
  assert.equal(students.some((student) => student.email === 'invalid@example.com'), false);
});

test('admin plan routes retain their administrator authorization guard', () => {
  for (const path of ['/quiztakers', '/quiztaker', '/quiztaker/:id', '/bulk-upload-quiztakers']) {
    for (const layer of router.stack.filter((entry) => entry.route?.path === path)) assert.equal(layer.route.stack[0].handle, verifyAdmin);
  }
});
