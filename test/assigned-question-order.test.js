const test = require('node:test');
const assert = require('node:assert/strict');
let student = { id: 'assignment-one', startedAt: new Date('2026-11-08T10:00:00Z') };
const questions = Array.from({ length: 20 }, (_, i) => ({ id: `question-${i}`, question: `Question ${i}`, orderNum: i + 1,
  type: 'multiple-choice', options: ['Wrong', 'Right'], correctAnswer: 'Right', points: 1, passage: 'Passage' }));
const db = {
  assignedQuiz: { findFirst: async () => student },
  quiz: { findUnique: async () => ({ questionSets: [{ id: 'set', orderNum: 1, title: 'English', totalPoints: questions.length, questions }] }) },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
const router = require('../routes/quiztaker');

async function delivered() {
  const route = router.stack.find((layer) => layer.route?.path === '/quiz/:quizId/question-set/:questionSetOrder' && layer.route.methods.get).route;
  const res = { status() { return this; }, json(body) { this.body = body; return this; } };
  await route.stack.at(-1).handle({ params: { quizId: 'quiz', questionSetOrder: '1' }, quizTaker: { id: student.id } }, res);
  return res.body.questionSet.questions;
}

test('assigned exams shuffle per student and attempt, preserve refresh order, and hide answers', async () => {
  const first = await delivered();
  assert.deepEqual(await delivered(), first);
  assert.notDeepEqual(first.map((q) => q.id), questions.map((q) => q.id));
  assert.deepEqual(first.map((q) => q.order), questions.map((_, i) => i + 1));
  assert(first.every((q) => !('correctAnswer' in q) && q.passage === 'Passage'));
  student = { ...student, id: 'assignment-two' };
  assert.notDeepEqual(await delivered(), first);
  student = { id: 'assignment-one', startedAt: new Date('2026-11-08T11:00:00Z') };
  assert.notDeepEqual(await delivered(), first);
  assert.deepEqual(questions.map((q) => q.orderNum), questions.map((_, i) => i + 1));
});
