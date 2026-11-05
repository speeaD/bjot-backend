const test = require('node:test');
const assert = require('node:assert/strict');

const studentId = '11111111-1111-4111-8111-111111111111';
const quizId = '22222222-2222-4222-8222-222222222222';
let quiz;
let assignment;
let order;
let progress;
let submissions;
let answers;
let setSubmissions;
let history;
let locks;
let dashboardQuery;
let sequence;
const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
const database = {
  quiz: { findUnique: async () => quiz },
  quizTaker: { findUnique: async (query) => {
    dashboardQuery = query;
    return { id: studentId, assignedQuizzes: [{ ...assignment, quiz, submissions }] };
  } },
  assignedQuiz: {
    findFirst: async ({ where }) => assignment && matches(assignment, where)
      ? { ...assignment, questionSetOrder: [...order], questionSetProgress: [...progress] } : null,
    update: async ({ data }) => { Object.assign(assignment, data); return assignment; },
  },
  questionSetOrder: { findMany: async () => order },
  questionSetProgress: {
    createMany: async ({ data }) => {
      for (const row of data) {
        if (!progress.some((item) => item.questionSetOrder === row.questionSetOrder)) {
          progress.push({ id: `progress-${sequence++}`, ...row });
        }
      }
    },
    deleteMany: async () => { progress = []; },
    findMany: async () => progress,
    findFirst: async ({ where }) => progress.find((row) => matches(row, where)),
    count: async ({ where }) => progress.filter((row) => matches(row, where)).length,
    create: async ({ data }) => { const row = { id: `progress-${sequence++}`, ...data }; progress.push(row); return row; },
    update: async ({ where, data }) => Object.assign(progress.find((row) => row.id === where.id), data),
  },
  quizSubmission: {
    findFirst: async ({ where }) => submissions.find((row) => matches(row, where)) || null,
    create: async ({ data }) => {
      const row = { id: `submission-${sequence++}`, ...data, answers: [] };
      submissions.push(row);
      return row;
    },
    update: async ({ where, data }) => Object.assign(submissions.find((row) => row.id === where.id), data),
  },
  submissionAnswer: {
    findFirst: async ({ where }) => answers.find((row) => matches(row, where)),
    findMany: async ({ where }) => answers.filter((row) => matches(row, where)),
    create: async ({ data }) => { const row = { id: `answer-${sequence++}`, ...data }; answers.push(row); return row; },
    update: async ({ where, data }) => Object.assign(answers.find((row) => row.id === where.id), data),
  },
  questionSetSubmission: { upsert: async ({ create }) => { setSubmissions.push(create); } },
  quizTakenHistory: { create: async ({ data }) => { history.push(data); } },
  $queryRaw: async (parts, owner, id) => {
    assert.match(parts.join(''), /assigned_quizzes[\s\S]*FOR UPDATE/);
    assert.equal(owner, studentId);
    assert.equal(id, quizId);
    locks++;
    return assignment ? [{ id: assignment.id }] : [];
  },
  $transaction: async (fn) => fn(database),
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/quiztaker');

test.beforeEach(() => {
  quiz = { id: quizId, title: 'Assigned mock', examType: 'single-subject', isActive: true,
    multipleAttempts: true, looseFocus: false, totalPoints: 2, questionSets: [{ id: 'set-1', title: 'English',
      orderNum: 1, totalPoints: 2, questions: [{ id: 'question-1', type: 'multiple-choice', correctAnswer: 'Right', points: 2 }] }] };
  assignment = { id: 'assignment', quizTakerId: studentId, quizId, status: 'pending', startedAt: null, completedAt: null };
  order = []; progress = []; submissions = []; answers = []; setSubmissions = []; history = [];
  locks = 0; dashboardQuery = null; sequence = 1;
});

async function call(method, path, body = {}) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await layer.route.stack.at(-1).handle({ params: { quizId }, quizTaker: { id: studentId, accountType: 'premium' }, body }, response);
  return response;
}
const start = () => call('post', '/quiz/:quizId/start');
const submit = (questionSetOrder = 1, isFinalSubmission = true, answer = 'Right') => call('post', '/quiz/:quizId/submit', {
  questionSetOrder, isFinalSubmission, answers: [{ questionId: `question-${questionSetOrder}`, answer }],
});

test('retakes allow a third attempt, reset progress and timing, and keep all previous results', async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await start();
    assert.equal(response.statusCode, 200);
    assert.equal(assignment.status, 'in-progress');
    assert.equal(assignment.completedAt, null);
    assert.equal(progress.length, 1);
    assert.equal(progress[0].status, 'not-started');
    assert.equal(progress[0].score, 0);
    assert.equal(progress[0].completedAt, undefined);
    assert.equal(history.length, attempt);
    const startedAt = new Date(Date.now() - 60_000);
    assignment.startedAt = startedAt;
    assert.equal((await submit(1, true, attempt === 1 ? 'Wrong' : 'Right')).statusCode, 200);
    assert.equal(submissions[attempt].startedAt, startedAt);
    assert.equal(submissions[attempt].timeTaken >= 60, true);
    assert.equal(assignment.status, 'completed');
    const details = await call('get', '/quiz/:quizId');
    assert.equal(details.statusCode, 200);
    assert.equal(details.body.quiz.multipleAttempts, true);
    assert.equal(assignment.status, 'completed', 'viewing details must not start/reset an attempt');
  }
  assert.deepEqual(submissions.map((row) => row.score), [2, 0, 2]);
  assert.deepEqual(history.map((row) => row.score), [2, 0, 2]);
  assert.equal(new Set(submissions.map((row) => row.id)).size, 3);
  assert.equal(answers.length, 3);
  assert.equal(locks, 6);
});

test('single-attempt mocks stay blocked until an admin enables retakes', async () => {
  quiz.multipleAttempts = false;
  await start();
  await submit();
  assert.equal((await call('get', '/quiz/:quizId')).statusCode, 400);
  assert.equal((await start()).statusCode, 400);
  assert.equal(submissions.length, 1);
  quiz.multipleAttempts = true;
  assert.equal((await call('get', '/quiz/:quizId')).statusCode, 200);
  assert.equal((await start()).statusCode, 200);
  assert.equal(progress[0].status, 'not-started');
  assert.equal(history.length, 1);
});

test('multi-subject retakes preserve the selected order and reset every subject', async () => {
  quiz.examType = 'multi-subject';
  quiz.questionSets = Array.from({ length: 4 }, (_, i) => ({ id: `set-${i + 1}`, title: `Subject ${i + 1}`,
    orderNum: i + 1, totalPoints: 2, questions: [{ id: `question-${i + 1}`, type: 'multiple-choice', correctAnswer: 'Right', points: 2 }] }));
  quiz.totalPoints = 8;
  order = [3, 1, 4, 2].map((orderValue, position) => ({ assignedQuizId: assignment.id, position, orderValue }));
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await start()).statusCode, 200);
    assert.deepEqual(progress.map((row) => row.questionSetOrder), [3, 1, 4, 2]);
    assert.equal(progress.every((row) => row.status === 'not-started'), true);
    assert.equal(assignment.currentQuestionSetOrder, 3);
    for (const [index, setOrder] of [3, 1, 4, 2].entries()) {
      assert.equal((await submit(setOrder, index === 3)).statusCode, 200);
    }
  }
  assert.deepEqual(history.map((row) => row.score), [8, 8]);
  assert.equal(setSubmissions.length, 8);
  assert.deepEqual(order.map((row) => row.orderValue), [3, 1, 4, 2]);
});

test('resuming an active mock preserves its start time and completed subject progress', async () => {
  await start();
  const startedAt = assignment.startedAt;
  progress[0].status = 'completed';
  progress[0].score = 2;
  const response = await start();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.startedAt, startedAt);
  assert.equal(progress[0].status, 'completed');
  assert.equal(progress[0].score, 2);
});

test('completed legacy mocks without a saved order can start a fresh attempt', async () => {
  assignment.status = 'completed';
  const details = await call('get', '/quiz/:quizId');
  assert.deepEqual(details.body.selectedQuestionSetOrder, [1]);
  assert.equal((await start()).statusCode, 200);
  assert.equal(assignment.status, 'in-progress');
});

test('quiz details preserve the admin focus permission in both states', async () => {
  for (const allowed of [true, false]) {
    quiz.looseFocus = allowed;
    assert.equal((await call('get', '/quiz/:quizId')).body.quiz.looseFocus, allowed);
  }
});

test('a repeated final submission cannot create a new attempt, even with retakes enabled', async () => {
  await start();
  await submit();
  assert.equal((await submit()).statusCode, 400);
  assert.equal(submissions.length, 1);
  assert.equal(history.length, 1);
  assert.equal(assignment.status, 'completed');
});

test('inactive and unassigned mocks cannot be started or retaken', async () => {
  quiz.isActive = false;
  for (const status of ['pending', 'in-progress', 'completed']) {
    assignment.status = status;
    assert.equal((await start()).statusCode, 400);
    assert.equal((await call('get', '/quiz/:quizId')).statusCode, 400);
    assert.equal(progress.length, 0);
  }
  assignment = null;
  assert.equal((await start()).statusCode, 403);
  assert.equal((await call('get', '/quiz/:quizId')).statusCode, 403);
});

test('dashboard includes the current retake setting for the student action', async () => {
  assert.equal((await call('get', '/dashboard')).statusCode, 200);
  assert.equal(dashboardQuery.include.assignedQuizzes.include.quiz.select.multipleAttempts, true);
  assert.equal(dashboardQuery.include.assignedQuizzes.include.quiz.select.isActive, true);
});
