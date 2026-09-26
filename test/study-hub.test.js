const test = require('node:test');
const assert = require('node:assert/strict');

const topicId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const studentId = '33333333-3333-4333-8333-333333333333';
const pool = Array.from({ length: 45 }, (_, index) => ({
  id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
  type: 'multiple-choice', question: `Question ${index}`, options: ['Wrong', 'Right'],
  correctAnswer: 'Right', passage: '', diagram: null, diagramAlt: '', points: 1, orderNum: index + 1,
}));
let saved;
const database = {
  topic: { findFirst: async () => ({ id: topicId, questionSet: { id: 'subject', title: 'Physics' } }) },
  studyMaterial: { count: async () => 1 },
  question: { findMany: async () => pool },
  studyAttempt: {
    create: async ({ data }) => { saved = { id: attemptId, ...data, startedAt: new Date() }; return saved; },
    findFirst: async () => ({ ...saved, topic: { name: 'Motion', questionSet: { title: 'Physics' } } }),
    updateMany: async ({ data }) => { saved = { ...saved, ...data }; return { count: 1 }; },
  },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/study-hub');

test('regular students cannot enter the study hub', () => {
  const guard = router.stack.find((layer) => layer.name === 'premium');
  const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  guard.handle({ quizTaker: { accountType: 'regular' } }, response, () => assert.fail('Regular student was allowed'));
  assert.equal(response.statusCode, 403);
});

async function call(method, path, params, body) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await layer.route.stack.at(-1).handle({ params, body, quizTaker: { id: studentId, accountType: 'premium' } }, response);
  return response;
}

test('study attempt samples 40 distinct topic questions and stores the answer snapshot', async () => {
  const response = await call('post', '/topics/:id/start', { id: topicId });
  assert.equal(response.statusCode, 201);
  assert.equal(saved.questionIds.length, 40);
  assert.equal(new Set(saved.questionIds).size, 40);
  assert.deepEqual(saved.questionSnapshot.map((question) => question.id), saved.questionIds);
  assert.equal(saved.questionSnapshot[0].correctAnswer, 'Right');
});

test('attempt response hides correct answers and submission grades the saved snapshot', async () => {
  const response = await call('get', '/attempts/:id', { id: attemptId });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.attempt.questions.length, 40);
  assert.equal('correctAnswer' in response.body.attempt.questions[0], false);
  const answers = saved.questionIds.map((questionId) => ({ questionId, answer: 'Right' }));
  const submitted = await call('post', '/attempts/:id/submit', { id: attemptId }, { answers });
  assert.equal(submitted.statusCode, 200);
  assert.deepEqual(submitted.body.result, { score: 40, totalPoints: 40, percentage: 100 });
  assert.equal(saved.answers.length, 40);
});

test('submitted attempts cannot be graded twice', async () => {
  const response = await call('post', '/attempts/:id/submit', { id: attemptId }, { answers: [] });
  assert.equal(response.statusCode, 409);
});
