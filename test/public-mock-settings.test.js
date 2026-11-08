const test = require('node:test');
const assert = require('node:assert/strict');
const { orderedQuestions } = require('../utils/question-order');
const { deviceHeaders, headersForDevice } = require('./helpers/public-device');
const { requirePublicMockDevice } = require('../utils/public-mock-device');

const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
let quiz;
let sessions;
let attempts;
let grades;
let sequence;
let locks;
let transactionQueue = Promise.resolve();
const hydrated = (session) => session && ({ ...session, quiz, attempt: attempts.find((attempt) => attempt.sessionId === session.id) || null });
function matchesSession(session, where) {
  const hasAttempt = attempts.some((attempt) => attempt.sessionId === session.id);
  return (!where.quizId || session.quizId === where.quizId) && (!where.email || session.email === where.email) &&
    (!where.deviceHash || session.deviceHash === where.deviceHash) && (!where.OR || where.OR.some((filter) => matchesSession(session, filter))) &&
    (!where.attempt || ('isNot' in where.attempt ? hasAttempt : !hasAttempt));
}
const db = {
  quiz: { findMany: async () => [quiz], findUnique: async () => quiz },
  questionSet: { count: async () => 4, findMany: async () => quiz.questionSets.map((set) => ({ id: set.questionSetId, title: set.title })) },
  publicMockSession: {
    findFirst: async ({ where }) => hydrated(sessions.findLast((session) => matchesSession(session, where))),
    findUnique: async ({ where }) => hydrated(sessions.find((session) => session.id === where.id)),
    create: async ({ data }) => {
      const session = { id: uuid(sequence++), createdAt: new Date(), ...data };
      sessions.push(session);
      return session;
    },
    update: async ({ where, data }) => Object.assign(sessions.find((session) => session.id === where.id), data),
  },
  publicMockAttempt: { create: async ({ data }) => {
    assert(!attempts.some((attempt) => attempt.sessionId === data.sessionId), 'one attempt per session');
    const attempt = { id: uuid(sequence++), ...data };
    attempts.push(attempt);
    return attempt;
  } },
  publicMockGrade: { upsert: async ({ create }) => {
    let grade = grades.find((grade) => grade.quizId === create.quizId && grade.email === create.email);
    if (!grade) { grade = create; grades.push(grade); }
    return grade;
  } },
  $queryRaw: async (parts, id) => { assert.match(parts.join(''), /FROM quizzes[\s\S]*FOR UPDATE/); assert.equal(id, quiz.id); locks++; },
  $transaction: (fn) => {
    const result = transactionQueue.then(() => fn(db));
    transactionQueue = result.catch(() => {});
    return result;
  },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
const router = require('../routes/public-exams');
const legacyRouter = require('../routes/public');

test.beforeEach(() => {
  quiz = { id: uuid(1), title: 'Public mock', isActive: true, isOpenQuiz: true, examType: 'multi-subject',
    multipleAttempts: false, looseFocus: false, viewResults: true, viewAnswer: true,
    durationHours: 2, durationMinutes: 0, durationSeconds: 0,
    questionSets: Array.from({ length: 4 }, (_, s) => ({ questionSetId: uuid(10 + s), title: `Subject ${s}`, orderNum: s + 1, totalPoints: 24,
      questions: Array.from({ length: 12 }, (_, q) => ({ id: uuid(100 + s * 12 + q), type: 'multiple-choice',
        question: `Question ${q}`, orderNum: q + 1, points: 2, options: ['Wrong', 'Right'], correctAnswer: 'B',
        passage: 'Passage', diagram: '/diagram.png', diagramAlt: 'Diagram description' })),
    })),
  };
  sessions = []; attempts = []; grades = []; sequence = 1000; locks = 0;
});

async function call(target, method, path, body, params = {}, headers = deviceHeaders()) {
  const route = target.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const res = { statusCode: 200, cookies: [], cookie(...cookie) { this.cookies.push(cookie); return this; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await route.stack.at(-1).handle({ body, params, headers }, res);
  return res;
}
const start = (email = 'Student@Example.com', ids = quiz.questionSets.map((set) => set.questionSetId), headers = deviceHeaders(email.trim().toLowerCase())) => call(router, 'post', '/mock/sessions', {
  name: 'Student', email, quizId: quiz.id, questionSetIds: ids,
}, {}, headers);
const submit = (id, answers = [], headers = headersForDevice(sessions.find((session) => session.id === id)?.deviceHash)) => call(router, 'post', '/mock/sessions/:id/submit', { answers }, { id }, headers);
const legacySubmit = (email = 'student@example.com', headers = deviceHeaders(email.trim().toLowerCase())) => call(legacyRouter, 'post', '/:quizId/submit', {
  name: 'Student', email, questionSetCombination: quiz.questionSets.map((set) => set.questionSetId), answers: [],
}, { quizId: quiz.id }, headers);

test('listing and session responses preserve both admin settings in either state', async () => {
  for (const enabled of [false, true]) {
    quiz.multipleAttempts = enabled;
    quiz.looseFocus = enabled;
    const listed = await call(router, 'get', '/question-sets');
    assert.equal(listed.body.mocks[0].multipleAttempts, enabled);
    assert.equal(listed.body.mocks[0].looseFocus, enabled);
    const started = await start();
    assert.equal(started.body.session.multipleAttempts, enabled);
    assert.equal(started.body.session.looseFocus, enabled);
  }
});

test('single-attempt public mocks reject normalized-email retakes through both APIs until admin enables them', async () => {
  const first = (await start()).body.session;
  assert.equal((await submit(first.id)).statusCode, 200);
  for (const response of [await start('  STUDENT@example.com '), await legacySubmit(' STUDENT@example.com ')]) {
    assert.equal(response.statusCode, 403);
    assert.match(response.body.message, /Retakes are disabled/);
  }
  assert.equal(sessions.length, 1);
  assert.equal(attempts.length, 1);
  assert.equal((await start('another@example.com')).statusCode, 201);
  quiz.multipleAttempts = true;
  const second = (await start()).body.session;
  assert.notEqual(second.id, first.id);
  assert.equal((await submit(second.id)).body.countsForGrade, false);
  assert.equal((await legacySubmit()).statusCode, 200);
  assert.equal(grades.filter((grade) => grade.email === 'student@example.com').length, 1);
});

test('a legacy completed result also blocks a new session and another legacy submission', async () => {
  assert.equal((await legacySubmit()).statusCode, 200);
  assert.equal((await start()).statusCode, 403);
  assert.equal((await legacySubmit()).statusCode, 403);
  assert.equal(attempts.length, 1);
});

test('concurrent starts resume one session with the original subjects, timer, and shuffled question order', async () => {
  const ids = quiz.questionSets.map((set) => set.questionSetId).reverse();
  const [a, b] = await Promise.all([start('student@example.com', ids), start()]);
  assert.equal(sessions.length, 1);
  assert.equal(a.body.session.id, b.body.session.id);
  assert.deepEqual(a.body.session.questionSetIds, ids);
  assert.deepEqual(a.body.session.questionsBySet, b.body.session.questionsBySet);
  sessions[0].createdAt = new Date(Date.now() - 126_000);
  const resumed = (await start()).body.session;
  assert.ok(resumed.remainingSeconds >= 7073 && resumed.remainingSeconds <= 7074);
  assert.deepEqual(resumed.questionsBySet, a.body.session.questionsBySet);
  assert.deepEqual(resumed.questionSetIds, ids);
  sessions[0].createdAt = new Date(Date.now() - 8_000_000);
  assert.equal((await start()).body.session.remainingSeconds, 0);
});

test('duplicate submissions stay idempotent and pre-existing sessions cannot bypass a disabled retake setting', async () => {
  const first = (await start()).body.session;
  // Such sessions could exist from the old flow or an administrator changing settings.
  const spare = { ...sessions[0], id: uuid(sequence++) };
  sessions.push(spare);
  const [a, b] = await Promise.all([submit(first.id), submit(first.id)]);
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.body, b.body);
  assert.equal(attempts.length, 1);
  assert.equal((await submit(spare.id)).statusCode, 403);
  assert.equal(attempts.length, 1);
  assert.ok(locks >= 4, 'all starts and submissions use the quiz lock');
});

test('students receive different stable permutations with sequential numbering and grading follows question IDs', async () => {
  const original = structuredClone(quiz.questionSets);
  const first = (await start()).body.session;
  const second = (await start('other@example.com')).body.session;
  const answers = [];
  for (const source of quiz.questionSets) {
    const a = first.questionsBySet[source.questionSetId];
    const b = second.questionsBySet[source.questionSetId];
    const ids = (questions) => questions.map((q) => q._id);
    assert.notDeepEqual(ids(a), ids(b));
    assert.notDeepEqual(ids(a), source.questions.map((q) => q.id));
    assert.deepEqual([...ids(a)].sort(), source.questions.map((q) => q.id).sort());
    assert.deepEqual(a.map((q) => q.order), a.map((_, i) => i + 1));
    assert(a.every((q) => !('correctAnswer' in q) && q.passage === 'Passage' && q.diagram === '/diagram.png'));
    answers.push(...a.map((q) => ({ questionId: q._id, answer: 'Right' })));
  }
  const result = await submit(first.id, answers);
  assert.equal(result.body.attempt.percentage, 100);
  assert.deepEqual(result.body.review.map((q) => q.questionId), Object.values(first.questionsBySet).flat().map((q) => q._id));
  assert.deepEqual(quiz.questionSets, original);
  quiz.multipleAttempts = true;
  const retake = (await start()).body.session;
  assert.notDeepEqual(retake.questionsBySet, first.questionsBySet);
});

test('question permutations depend on the attempt and do not mutate or drop any questions', () => {
  const questions = quiz.questionSets[0].questions;
  const first = orderedQuestions(questions, 'student-one-attempt-one');
  assert.deepEqual(first, orderedQuestions([...questions].reverse(), 'student-one-attempt-one'));
  assert.notDeepEqual(first, orderedQuestions(questions, 'student-two-attempt-one'));
  assert.notDeepEqual(first, orderedQuestions(questions, 'student-one-attempt-two'));
  assert.equal(new Set(first.map((q) => q.id)).size, questions.length);
  assert.deepEqual(orderedQuestions([], 'empty'), []);
  assert.deepEqual(orderedQuestions([questions[0]], 'single'), [questions[0]]);
});

test('changing email on a completed device is blocked through both public APIs, but another device and email may take it', async () => {
  const browser = deviceHeaders('shared-device');
  const first = (await start('first@example.com', undefined, browser)).body.session;
  assert.equal((await submit(first.id, [], browser)).statusCode, 200);
  for (const blocked of [await start('second@example.com', undefined, browser), await legacySubmit('third@example.com', browser)]) {
    assert.equal(blocked.statusCode, 403);
    assert.match(blocked.body.message, /This device has already completed/);
  }
  assert.equal(sessions.length, 1);
  assert.equal(attempts.length, 1);
  assert.equal((await start('first@example.com', undefined, deviceHeaders('other-device'))).statusCode, 403, 'email limit still applies across devices');
  assert.equal((await start('new@example.com', undefined, deviceHeaders('other-device'))).statusCode, 201);
  quiz.multipleAttempts = true;
  const permitted = await start('second@example.com', undefined, browser);
  assert.equal(permitted.statusCode, 201, 'admin can still enable public retakes');
  assert.equal((await submit(permitted.body.session.id, [], browser)).statusCode, 200);
});

test('a legacy attempt reserves its device against later submissions and modern starts with different emails', async () => {
  const browser = deviceHeaders('legacy-device');
  assert.equal((await legacySubmit('legacy@example.com', browser)).statusCode, 200);
  assert.equal((await legacySubmit('changed@example.com', browser)).statusCode, 403);
  assert.equal((await start('changed@example.com', undefined, browser)).statusCode, 403);
  assert.equal(attempts.length, 1);
});

test('another browser cannot resume, submit or replay an attempt bound to the starting browser', async () => {
  const owner = deviceHeaders('owner-device');
  const other = deviceHeaders('intruder-device');
  const first = (await start('owner@example.com', undefined, owner)).body.session;
  assert.equal((await start('owner@example.com', undefined, other)).statusCode, 403);
  assert.equal((await submit(first.id, [], other)).statusCode, 403);
  assert.equal(attempts.length, 0);
  assert.equal((await submit(first.id, [], owner)).statusCode, 200);
  assert.equal((await submit(first.id, [], owner)).statusCode, 200, 'owner retry remains idempotent');
  assert.equal((await submit(first.id, [], other)).statusCode, 403);
});

test('concurrent starts with different emails cannot reserve two attempts on the same device', async () => {
  const browser = deviceHeaders('concurrent-device');
  const responses = await Promise.all([start('first@example.com', undefined, browser), start('second@example.com', undefined, browser)]);
  assert.deepEqual(responses.map((response) => response.statusCode), [201, 403]);
  assert.equal(sessions.length, 1);
  assert.match(responses[1].body.message, /unfinished attempt/);
  assert.equal((await start('first@example.com', undefined, browser)).body.session.id, responses[0].body.session.id);
  const spare = { ...sessions[0], id: uuid(sequence++), email: 'preexisting@example.com' };
  sessions.push(spare);
  const submitted = await Promise.all([submit(sessions[0].id, [], browser), submit(spare.id, [], browser)]);
  assert.deepEqual(submitted.map((response) => response.statusCode), [200, 403]);
  assert.equal(attempts.length, 1);
});

test('device limits apply to each mock separately', async () => {
  const browser = deviceHeaders('multiple-mocks');
  const first = (await start('student@example.com', undefined, browser)).body.session;
  await submit(first.id, [], browser);
  quiz = { ...quiz, id: uuid(2) };
  assert.equal((await start('student@example.com', undefined, browser)).statusCode, 201);
});

test('old sessions bind when resumed or submitted without changing their paper or result', async () => {
  const browser = deviceHeaders('migration-browser');
  const old = { id: uuid(sequence++), quizId: quiz.id, email: 'old@example.com', name: 'Student', deviceHash: null,
    selectedQuestionSetIds: quiz.questionSets.map((set) => set.questionSetId), createdAt: new Date() };
  sessions.push(old);
  const resumed = await start('old@example.com', undefined, browser);
  assert.equal(resumed.body.session.id, old.id);
  assert.equal(old.deviceHash, requirePublicMockDevice({ headers: browser }));
  await submit(old.id, [], browser);
  old.deviceHash = null; // A historical completed result from before this rollout.
  const replay = await submit(old.id, [], browser);
  assert.equal(replay.statusCode, 200);
  assert.equal(attempts.length, 1);
  assert.equal(old.deviceHash, requirePublicMockDevice({ headers: browser }));
  assert.equal((await start('another@example.com', undefined, browser)).statusCode, 403);
});

test('missing device cookies cannot bypass enforcement, and the listing bootstraps a signed cookie', async () => {
  const browser = deviceHeaders('cookie-check');
  assert.equal((await start('student@example.com', undefined, {})).statusCode, 428);
  assert.equal((await legacySubmit('student@example.com', {})).statusCode, 428);
  const first = (await start('student@example.com', undefined, browser)).body.session;
  assert.equal((await submit(first.id, [], {})).statusCode, 428);
  assert.equal(attempts.length, 0);
  const registered = await call(router, 'get', '/question-sets', undefined, {}, {});
  assert.equal(registered.statusCode, 200);
  assert.equal(registered.cookies[0][0], 'bjot_public_mock_device');
});
