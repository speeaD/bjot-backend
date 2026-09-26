const test = require('node:test');
const assert = require('node:assert/strict');
const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const studentId = uuid(9000);
const sessionId = uuid(9001);
const sets = ['English', 'Physics', 'Chemistry', 'Biology'].map((title, index) => ({
  id: uuid(index + 1), title, questions: Array.from({ length: 75 }, (_, questionIndex) => ({
    id: uuid(100 + index * 100 + questionIndex), questionSetId: uuid(index + 1),
    topicId: uuid(1000 + index * 10 + questionIndex % 3),
    question: `Question ${questionIndex}`, type: 'multiple-choice', options: ['Wrong', 'Right'],
    correctAnswer: 'B', passage: 'A passage', diagram: 'https://example.com/diagram.png', diagramAlt: 'Diagram',
    points: 2, orderNum: questionIndex + 1,
  })),
}));
let session;
let available;
let queries;
let history;
const database = {
  questionSet: {
    findMany: async (query) => {
      queries.push(query);
      return available.filter((set) => !query.where.id || query.where.id.in.includes(set.id));
    },
    findFirst: async (query) => { queries.push(query); return available.find((set) => set.id === query.where.id) || null; },
  },
  cbtSubmission: {
    create: async ({ data }) => {
      session = { ...data, id: sessionId, submittedAt: null,
        questionSets: data.questionSets.create,
        answers: data.answers.createMany.data.map((row, index) => ({ ...row, id: uuid(2000 + index),
          question: sets.flatMap((set) => set.questions).find((question) => question.id === row.questionId) })),
      };
      return session;
    },
    findUnique: async () => session,
    update: async ({ data }) => { const { answers, ...result } = data; history.push(data); session = { ...session, ...result }; return session; },
  },
  $queryRaw: async (_parts, id, owner) => session?.id === id && session?.quizTakerId === owner ? [{ id }] : [],
  $transaction: async (fn) => fn(database),
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/cbt');
const { verifyQuizTaker } = require('../middleware/auth');

test.beforeEach(() => { session = null; available = sets; queries = []; history = []; });
async function call(method, path, body = {}, params = {}, owner = studentId) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
  const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await route.route.stack.at(-1).handle({ body, params, quizTaker: { id: owner } }, response);
  return response;
}
const startSingle = () => call('post', '/start-single-subject', { questionSetId: sets[1].id });

test('CBT routes require the authenticated student', () => {
  assert.equal(router.stack[0].handle, verifyQuizTaker);
});

test('subject listing uses eligible topic questions instead of stale subject totals', async () => {
  available = [...sets, { id: uuid(88), title: 'Empty', questions: [] }];
  const response = await call('get', '/question-sets');
  assert.equal(response.body.questionSets.length, 4);
  assert.equal(response.body.questionSets[0].questionCount, 75);
  assert.equal(response.body.questionSets[0].totalPoints, 150);
  const filter = queries[0].include.questions.where;
  assert.equal(filter.isArchived, false);
  assert.deepEqual(filter.OR, [{ topicId: null }, { topic: { isActive: true } }]);
  assert.equal(filter.type.in.includes('essay'), false);
});

test('multi-subject CBT loads a fixed 180-question paper across topics without answer keys', async () => {
  const ids = [sets[2].id, sets[0].id, sets[3].id, sets[1].id];
  const response = await call('post', '/start-session', { questionSetIds: ids, quizTakerId: uuid(9999) });
  assert.equal(response.statusCode, 200);
  const paper = response.body.session;
  assert.deepEqual(paper.questionSets.map((set) => set._id), ids);
  assert.equal(paper.questionsBySet[sets[0].id].length, 60);
  assert.equal(paper.questionsBySet[sets[1].id].length, 40);
  assert.equal(session.answers.length, 180);
  assert.equal(new Set(session.answers.map((row) => row.questionId)).size, 180);
  assert.equal(session.quizTakerId, studentId);
  assert.equal(paper.durationSeconds, 7200);
  for (const question of Object.values(paper.questionsBySet).flat()) {
    assert.equal('correctAnswer' in question, false);
    assert.equal(question.passage, 'A passage');
    assert.equal(question.diagramAlt, 'Diagram');
  }
});

test('subject CBT selects up to 40 questions and rejects empty or duplicate subjects', async () => {
  const response = await startSingle();
  assert.equal(response.body.session.questionsBySet[sets[1].id].length, 40);
  assert.equal(response.body.session.durationSeconds, 3600);
  available = [{ ...sets[1], questions: sets[1].questions.slice(0, 3) }];
  assert.equal((await startSingle()).body.session.questionsBySet[sets[1].id].length, 3);
  available = [{ ...sets[1], questions: [] }];
  assert.equal((await startSingle()).statusCode, 400);
  assert.equal((await call('post', '/start-session', { questionSetIds: Array(4).fill(sets[0].id) })).statusCode, 400);
});

test('grading counts only the saved paper, includes unanswered questions, and retries once', async () => {
  await startSingle();
  const answers = session.answers.slice(0, 20).map((row) => ({ questionId: row.questionId, answer: 'Right' }));
  const response = await call('post', '/submit-single-subject', { sessionId, answers, startedAt: '2099-01-01' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.submission.score, 40);
  assert.equal(response.body.submission.totalPoints, 80);
  assert.equal(response.body.submission.percentage, 50);
  assert.equal(history.length, 1);
  assert.equal(history[0].answers.createMany.data.length, 40);
  const retry = await call('post', '/submit-single-subject', { sessionId, answers: [] });
  assert.deepEqual(retry.body.submission, response.body.submission);
  assert.equal(history.length, 1);
});

test('multi-subject submission can score 100 percent against its sampled questions', async () => {
  await call('post', '/start-session', { questionSetIds: sets.map((set) => set.id) });
  const answers = session.answers.map((row) => ({ questionId: row.questionId, answer: 'Right' }));
  const response = await call('post', '/submit', { sessionId, answers });
  assert.equal(response.body.submission.totalPoints, 360);
  assert.equal(response.body.submission.percentage, 100);
  assert.equal(history[0].answers.createMany.data.length, 180);
});

test('rejects foreign questions, duplicate answers, other students, and wrong exam modes', async () => {
  await startSingle();
  assert.equal((await call('post', '/submit-single-subject', { sessionId, answers: [{ questionId: sets[0].questions[0].id, answer: 'Right' }] })).statusCode, 400);
  const answer = { questionId: session.answers[0].questionId, answer: 'Right' };
  assert.equal((await call('post', '/submit-single-subject', { sessionId, answers: [answer, answer] })).statusCode, 400);
  assert.equal((await call('post', '/submit-single-subject', { sessionId, answers: [] }, {}, uuid(9999))).statusCode, 404);
  assert.equal((await call('post', '/submit', { sessionId, answers: [] })).statusCode, 400);
  assert.equal(history.length, 0);
});
