const test = require('node:test');
const assert = require('node:assert/strict');

let subjects;
let created;
const questions = Array.from({ length: 6 }, (_, index) => ({
  id: `q${index + 1}`, question: `Question ${index + 1}`, topicId: 'motion',
  type: 'multiple-choice', points: index + 1, orderNum: index + 1, options: ['A', 'B'], correctAnswer: 'A',
}));
const database = {
  questionSet: { findMany: async ({ where }) => subjects.filter((subject) => where.id.in.includes(subject.id)) },
  quiz: { create: async ({ data }) => { created = data; return { id: 'quiz', ...data }; } },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/quiz');

test.beforeEach(() => {
  subjects = [{ id: 'physics', title: 'Physics', questions, topics: [{ id: 'motion', name: 'Motion', isActive: true }] }];
  created = null;
});

async function create(questionFilters, examType = 'single-subject', questionSetCombination = ['physics']) {
  const route = router.stack.find((layer) => layer.route?.path === '/' && layer.route.methods.post).route;
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await route.stack.at(-1).handle({ admin: { id: 'admin' }, body: { settings: { title: 'Range exam', examType }, questionSetCombination, questionFilters } }, res);
  return res;
}

test('exam creation snapshots exactly the chosen topic range and calculates its points', async () => {
  const response = await create([{ topicSelections: [{ topicId: 'motion', questionIds: ['q2', 'q3', 'q4'], questionCount: 3 }] }]);
  assert.equal(response.statusCode, 201);
  const subject = created.questionSets.create[0];
  assert.deepEqual(subject.questions.create.map((question) => question.originalQuestionId), ['q2', 'q3', 'q4']);
  assert.deepEqual(subject.questions.create.map((question) => question.orderNum), [1, 2, 3]);
  assert.equal(created.totalPoints, 9);
  assert.deepEqual(subject.topicSelections.create, [{ topicId: 'motion', topicName: 'Motion', requestedCount: 3, selectedCount: 3 }]);
});

test('subjects without topics support a question range and retain the full pool when no filter is supplied', async () => {
  subjects[0].topics = [];
  assert.equal((await create([{ questionIds: ['q3', 'q4'] }])).statusCode, 201);
  assert.deepEqual(created.questionSets.create[0].questions.create.map((question) => question.originalQuestionId), ['q3', 'q4']);
  assert.equal(created.totalPoints, 7);
  assert.equal((await create([null])).statusCode, 201);
  assert.equal(created.questionSets.create[0].questions.create.length, 6);
});

test('multi-subject exams keep each subject range separate', async () => {
  subjects = Array.from({ length: 4 }, (_, index) => ({
    id: `subject-${index}`, title: `Subject ${index}`, topics: [],
    questions: questions.map((question) => ({ ...question, id: `${index}-${question.id}` })),
  }));
  const response = await create(subjects.map((_, index) => ({ questionIds: [`${index}-q2`, `${index}-q3`] })), 'multi-subject', subjects.map((subject) => subject.id));
  assert.equal(response.statusCode, 201);
  assert.equal(created.totalPoints, 20);
  created.questionSets.create.forEach((subject, index) => {
    assert.deepEqual(subject.questions.create.map((question) => question.originalQuestionId), [`${index}-q2`, `${index}-q3`]);
  });
});
