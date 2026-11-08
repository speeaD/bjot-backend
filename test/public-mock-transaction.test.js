const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers/promises');
const { publicMockTransaction } = require('../utils/public-mock-transaction');
const { lockQuiz, canEditQuestions } = require('../utils/quiz-editing');
const { transactionLocks } = require('./helpers/transaction-locks');

const identity = { quizId: 'quiz', email: 'one@example.com', deviceHash: 'device-one' };
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function within(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Independent transaction was blocked')), 1000); })])
    .finally(() => clearTimeout(timer));
}
function database() {
  const db = {};
  const locks = transactionLocks(db);
  db.$transaction = locks.transaction;
  return { db, events: locks.events };
}

test('different students can use the same quiz concurrently and advisory keys are acquired in a stable order', async () => {
  const { db, events } = database();
  const entered = deferred(), release = deferred(), otherEntered = deferred();
  const first = publicMockTransaction(db, identity, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const second = publicMockTransaction(db, { ...identity, email: 'two@example.com', deviceHash: 'device-two' }, async () => otherEntered.resolve());
  try { await within(otherEntered.promise); }
  finally { release.resolve(); await Promise.all([first, second]); }
  assert.equal(events.filter((event) => event.key === 'quiz:quiz' && event.mode === 'shared').length, 2);
  for (const owner of [1, 2]) {
    const keys = events.filter((event) => event.owner === owner && event.key.startsWith('advisory:')).map((event) => BigInt(event.key.slice(9)));
    assert.equal(keys.length, 2);
    assert(keys[0] <= keys[1], 'global key ordering avoids deadlocks');
  }
});

for (const [label, otherIdentity] of [
  ['same email on another device', { ...identity, deviceHash: 'another-device' }],
  ['same device with another email', { ...identity, email: 'another@example.com' }],
]) {
  test(`${label} remains serialized until the first transaction finishes`, async () => {
    const { db } = database();
    const entered = deferred(), release = deferred();
    let otherEntered = false;
    const first = publicMockTransaction(db, identity, async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const second = publicMockTransaction(db, otherIdentity, async () => { otherEntered = true; });
    try { await setImmediate(); assert.equal(otherEntered, false); }
    finally { release.resolve(); await Promise.all([first, second]); }
    assert.equal(otherEntered, true);
  });
}

test('different mocks never share identity locks', async () => {
  const { db } = database();
  const entered = deferred(), release = deferred(), otherEntered = deferred();
  const first = publicMockTransaction(db, identity, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const second = publicMockTransaction(db, { ...identity, quizId: 'another-quiz' }, async () => otherEntered.resolve());
  try { await within(otherEntered.promise); }
  finally { release.resolve(); await Promise.all([first, second]); }
});

test('paper replacement waits for public starts, then sees the new session and remains blocked', async () => {
  const { db } = database();
  let sessions = 0, editEntered = false;
  db.assignedQuiz = db.quizSubmission = db.questionSetOrder = { count: async () => 0 };
  db.publicMockSession = { count: async () => sessions };
  const entered = deferred(), release = deferred();
  const student = publicMockTransaction(db, identity, async () => { entered.resolve(); await release.promise; sessions++; });
  await entered.promise;
  const edit = db.$transaction(async (tx) => {
    await lockQuiz(tx, identity.quizId);
    editEntered = true;
    assert.equal(await canEditQuestions(tx, identity.quizId), false);
  });
  try { await setImmediate(); assert.equal(editEntered, false); }
  finally { release.resolve(); await Promise.all([student, edit]); }
  assert.equal(editEntered, true);
});

test('a start waits for an existing paper replacement before reading the updated quiz', async () => {
  const { db } = database();
  const entered = deferred(), release = deferred();
  let paper = 'old', studentEntered = false;
  const edit = db.$transaction(async (tx) => { await lockQuiz(tx, identity.quizId); entered.resolve(); await release.promise; paper = 'new'; });
  await entered.promise;
  const student = publicMockTransaction(db, identity, async () => { studentEntered = true; assert.equal(paper, 'new'); });
  try { await setImmediate(); assert.equal(studentEntered, false); }
  finally { release.resolve(); await Promise.all([edit, student]); }
});

test('failed transactions release their identity locks so the original attempt can be retried', async () => {
  const { db } = database();
  await assert.rejects(publicMockTransaction(db, identity, async () => { throw Object.assign(new Error('Expired'), { code: 'P2028' }); }), { code: 'P2028' });
  assert.equal(await within(publicMockTransaction(db, identity, async () => 'retried')), 'retried');
});

test('a cold database workload beyond five seconds receives an explicit transaction and connection-wait budget', async () => {
  let suppliedOptions;
  const db = { $transaction: async (run, options) => {
    suppliedOptions = options;
    let elapsed = 0;
    return run({ $queryRaw: async () => {
      elapsed += 1800; // Virtual database latency, with no slow wall-clock sleeps.
      if (elapsed > (options?.timeout ?? 5000)) throw Object.assign(new Error('Transaction already closed'), { code: 'P2028' });
      return [];
    } });
  } };
  assert.equal(await publicMockTransaction(db, identity, async () => 'started'), 'started');
  assert.deepEqual(suppliedOptions, { maxWait: 10_000, timeout: 20_000 });
});
