const test = require('node:test');
const assert = require('node:assert/strict');
const { listAdminSubmissions } = require('../utils/admin-submissions');
const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const quiz = { id: uuid(1), title: 'Free public mock', isActive: true, isOpenQuiz: true, viewResults: true,
  multipleAttempts: true,
  viewAnswer: true, examType: 'multi-subject', durationHours: 0, durationMinutes: 30, durationSeconds: 0,
  questionSets: Array.from({ length: 4 }, (_, i) => ({ questionSetId: uuid(i + 10), title: `Subject ${i + 1}`,
    orderNum: i + 1, totalPoints: 1, questions: [{ id: uuid(i + 20), type: 'multiple-choice', question: 'Pick the right option',
      options: ['Wrong', 'Right'], correctAnswer: 'B', points: 1 }] })) };
let assigned;
let sessions;
let attempts;
let grades;
let sequence;
const sorted = (rows) => [...rows].sort((a, b) => b.submittedAt - a.submittedAt || b.id.localeCompare(a.id));
const selected = (where) => assigned.filter((row) => !where?.quizTaker || row.quizTaker.accountType === where.quizTaker.accountType);
const database = {
  $queryRaw: async (parts, id) => { assert.match(parts.join(''), /FROM quizzes[\s\S]*FOR UPDATE/); return [{ id }]; },
  $transaction: async (run) => run(database),
  quiz: { findMany: async () => [quiz], findUnique: async () => quiz },
  questionSet: { count: async () => 4 },
  quizSubmission: {
    count: async ({ where }) => selected(where).length,
    findMany: async ({ where, take, include }) => {
      assert(include.questionSetSubmissions);
      return sorted(selected(where)).slice(0, take);
    },
    findUnique: async ({ where }) => assigned.find((row) => row.id === where.id) || null,
  },
  publicMockSession: {
    findFirst: async ({ where }) => {
      const row = sessions.filter((item) => item.quizId === where.quizId && item.email === where.email)
        .findLast((item) => !where.attempt || attempts.some((attempt) => attempt.sessionId === item.id));
      return row ? { ...row, attempt: attempts.find((item) => item.sessionId === row.id) || null } : null;
    },
    create: async ({ data }) => { const row = { id: uuid(sequence++), createdAt: new Date(), ...data, quiz }; sessions.push(row); return row; },
    findUnique: async ({ where }) => {
      const row = sessions.find((item) => item.id === where.id);
      return row ? { ...row, attempt: attempts.find((item) => item.sessionId === row.id) || null } : null;
    },
  },
  publicMockAttempt: {
    count: async () => attempts.length,
    findMany: async ({ take, where, select }) => sorted(attempts)
      .filter((row) => !where?.id || where.id.in.includes(row.id)).slice(0, take ?? attempts.length)
      .map((row) => select ? { id: row.id, submittedAt: row.submittedAt } : row),
    findUnique: async ({ where }) => attempts.find((row) => where.id ? row.id === where.id : row.sessionId === where.sessionId) || null,
    create: async ({ data }) => {
      const row = { id: uuid(sequence++), submittedAt: new Date(), ...data, session: sessions.find((item) => item.id === data.sessionId) };
      attempts.push(row);
      return row;
    },
  },
  publicMockGrade: {
    upsert: async ({ create }) => {
      let grade = grades.find((row) => row.quizId === create.quizId && row.email === create.email);
      if (!grade) { grade = create; grades.push(grade); }
      return grade;
    },
    findMany: async ({ where }) => grades.filter((row) => where.attemptId.in.includes(row.attemptId)),
    findUnique: async ({ where }) => grades.find((row) => row.attemptId === where.attemptId) || null,
  },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const adminRouter = require('../routes/admin');
const publicRouter = require('../routes/public-exams');
const legacyPublicRouter = require('../routes/public');
const { verifyAdmin } = require('../middleware/auth');

test.beforeEach(() => {
  sequence = 100; sessions = []; attempts = []; grades = [];
  assigned = ['premium', 'regular'].map((accountType, i) => ({ id: uuid(50 + i), quizId: quiz.id,
    quiz: { id: quiz.id, title: quiz.title, isOpenQuiz: true }, quizTakerId: uuid(60 + i),
    quizTaker: { id: uuid(60 + i), name: 'Enrolled student', email: 'student@example.com', accountType, accessCode: 'ABC123456' },
    status: 'auto-graded', score: 3, totalPoints: 4, percentage: 75, submittedAt: new Date(`2026-11-0${i + 1}T10:00:00Z`),
    questionSetSubmissions: [{ questionSetOrder: 1, score: 1, totalPoints: 1, percentage: 100 }] }));
});

async function call(router, method, path, { body = {}, query = {}, params = {} } = {}) {
  const route = router.stack.find((row) => row.route?.path === path && row.route.methods[method]).route;
  const response = { statusCode: 200, headers: {}, status(value) { this.statusCode = value; return this; },
    set(key, value) { this.headers[key] = value; return this; }, json(value) { this.body = value; return this; } };
  await route.stack.at(-1).handle({ body, query, params }, response);
  return response;
}
const list = (query = {}) => call(adminRouter, 'get', '/submissions', { query });
const examAnswers = (answer) => quiz.questionSets.map((set) => ({ questionId: set.questions[0].id, answer }));
async function submitPublic(answer = 'Right', email = ' Student@Example.com ') {
  const started = await call(publicRouter, 'post', '/mock/sessions', { body: {
    name: 'Public student', email, quizId: quiz.id, questionSetIds: quiz.questionSets.map((set) => set.questionSetId),
  } });
  assert.equal(started.statusCode, 201);
  const submitted = await call(publicRouter, 'post', '/mock/sessions/:id/submit', {
    params: { id: started.body.session.id }, body: { answers: examAnswers(answer) },
  });
  assert.equal(submitted.statusCode, 200);
  return attempts.at(-1);
}

test('a free public submission appears immediately in admin records with student and subject scores', async () => {
  const attempt = await submitPublic();
  const response = await list();
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.body.total, 3);
  const row = response.body.submissions.find((item) => item.id === attempt.id);
  assert.equal(row.source, 'public');
  assert.equal(row.quiz.title, quiz.title);
  assert.equal(row.quizTaker.name, 'Public student');
  assert.equal(row.quizTaker.email, 'student@example.com');
  assert.equal(row.quizTakerId, 'public:student@example.com');
  assert.notEqual(row.quizTakerId, assigned[0].quizTakerId);
  assert.equal(row.score, 4);
  assert.equal(row.percentage, 100);
  assert.equal(row.countsForGrade, true);
  assert.deepEqual(row.questionSetSubmissions.map((set) => [set.questionSetOrder, set.score]), [[1, 1], [2, 1], [3, 1], [4, 1]]);
  assert.equal('answers' in row, false);
});

test('public retakes are visible while only the first attempt counts for rankings', async () => {
  const first = await submitPublic('Wrong');
  const second = await submitPublic('Right');
  const rows = (await list({ accountType: 'public' })).body.submissions;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.id === first.id).countsForGrade, true);
  assert.equal(rows.find((row) => row.id === second.id).countsForGrade, false);
  assert.equal(rows.find((row) => row.id === first.id).score, 0);
  assert.equal(rows.find((row) => row.id === second.id).score, 4);
  assert.equal(new Set(rows.map((row) => row.quizTakerId)).size, 1);
  assert.equal(grades.length, 1);
});

test('legacy public quiz submissions are reflected without resubmission or backfill', async () => {
  const submitted = await call(legacyPublicRouter, 'post', '/:quizId/submit', { params: { quizId: quiz.id }, body: {
    name: 'Legacy public student', email: 'legacy@example.com',
    questionSetCombination: quiz.questionSets.map((set) => set.questionSetId), answers: examAnswers('Right'),
  } });
  assert.equal(submitted.statusCode, 200);
  const response = await list();
  assert.equal(response.body.submissions.some((row) => row.id === submitted.body.submission.id && row.source === 'public'), true);
  assert.equal(attempts.length, 1);
});

test('combined pagination sorts both sources together without dropping or duplicating submissions', async () => {
  const first = await submitPublic('Right', 'first@example.com');
  const second = await submitPublic('Right', 'second@example.com');
  first.submittedAt = new Date('2026-11-01T12:00:00Z');
  second.submittedAt = new Date('2026-10-31T12:00:00Z');
  const page1 = (await list({ page: '1', limit: '2' })).body;
  const page2 = (await list({ page: '2', limit: '2' })).body;
  assert.equal(page1.total, 4);
  assert.equal(page1.pages, 2);
  assert.deepEqual([...page1.submissions, ...page2.submissions].map((row) => row.id),
    [assigned[1].id, first.id, assigned[0].id, second.id]);
  assert.deepEqual((await list({ page: '3', limit: '2' })).body.submissions, []);
});

test('account filters distinguish public candidates from registered regular and premium students', async () => {
  await submitPublic();
  for (const accountType of ['premium', 'regular', 'public']) {
    const response = await list({ accountType });
    assert.equal(response.body.total, 1);
    assert.equal(response.body.submissions[0].quizTaker.accountType, accountType);
  }
});

test('public submission details are available through the authenticated admin detail endpoint', async () => {
  const attempt = await submitPublic();
  const response = await call(adminRouter, 'get', '/submission/:id', { params: { id: attempt.id } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.submission.source, 'public');
  assert.equal(response.body.submission.countsForGrade, true);
  assert.equal(response.body.submission.answers.length, 4);
  assert.equal(response.body.submission.answers.every((answer) => answer.isCorrect && answer.pointsAwarded === 1), true);
  assert.equal((await call(adminRouter, 'get', '/submission/:id', { params: { id: uuid(999) } })).statusCode, 404);
});

test('admin submission list and detail routes retain the admin authorization guard', () => {
  for (const path of ['/submissions', '/submission/:id']) {
    const route = adminRouter.stack.find((row) => row.route?.path === path).route;
    assert.equal(route.stack[0].handle, verifyAdmin);
  }
});

test('invalid pagination and filters are rejected', async () => {
  for (const query of [{ page: 0 }, { page: 'not-a-page' }, { limit: 0 }, { limit: 201 }, { accountType: 'unknown' }]) {
    await assert.rejects(listAdminSubmissions(database, query), { statusCode: 400 });
  }
});
