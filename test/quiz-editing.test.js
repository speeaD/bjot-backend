const test = require('node:test');
const assert = require('node:assert/strict');

let quiz, subjects, guards, events, savedSets, savedQuestions, updated;
const database = {
  quiz: {
    findUnique: async () => quiz,
    update: async ({ data }) => { events.push('update'); updated = data; return { ...quiz, ...data }; },
  },
  questionSet: { findMany: async ({ where }) => subjects.filter((set) => where.id.in.includes(set.id)) },
  assignedQuiz: { count: async () => { events.push('guard'); return guards.started; } },
  quizSubmission: { count: async () => guards.submissions },
  publicMockSession: { count: async () => guards.publicSessions },
  questionSetOrder: { count: async () => guards.choices },
  quizQuestionSet: {
    deleteMany: async () => { events.push('replace'); },
    createMany: async ({ data }) => { savedSets = data.map((set, index) => ({ ...set, id: `snapshot-${index}` })); },
    findMany: async () => savedSets,
  },
  quizQuestionSetTopic: { createMany: async () => {} },
  quizQuestion: { createMany: async ({ data }) => { savedQuestions.push(...data); } },
  $queryRaw: async (parts, id) => { assert.match(parts.join(''), /FROM quizzes[\s\S]*FOR UPDATE/); assert.equal(id, 'quiz'); events.push('lock'); return [{ id }]; },
  $transaction: async (run) => run(database),
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/quiz');

test.beforeEach(() => {
  subjects = ['English', 'Physics', 'Chemistry', 'Biology', 'Mathematics', 'Economics'].map((title, index) => ({
    id: `subject-${index}`, title, topics: [{ id: `topic-${index}`, name: 'Topic', isActive: true }],
    questions: [1, 2, 3].map((number) => ({ id: `q-${index}-${number}`, topicId: `topic-${index}`, orderNum: number * 5,
      question: 'Question', points: number, type: 'multiple-choice', options: ['A', 'B'], correctAnswer: 'A' })),
  }));
  quiz = { id: 'quiz', studentSelectsSubjects: true, examType: 'multi-subject', durationHours: 2, durationMinutes: 30, durationSeconds: 0,
    questionSets: subjects.map((set, index) => ({ questionSetId: set.id, title: set.title, orderNum: index + 1, questions: [], topicSelections: [] })) };
  guards = { started: 0, submissions: 0, publicSessions: 0, choices: 0 };
  events = []; savedSets = []; savedQuestions = []; updated = undefined;
});
async function invoke(method, path, body = {}) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await route.stack.at(-1).handle({ params: { id: 'quiz' }, body }, res);
  return res;
}
function payload() {
  return { settings: { title: 'Edited mock', duration: { hours: 2, minutes: 0, seconds: 0 }, permitLoseFocus: false },
    questionSetIds: subjects.map((set) => set.id),
    questionFilters: subjects.map((set) => ({ topicSelections: [{ topicId: set.topics[0].id, questionIds: [set.questions[1].id, set.questions[2].id] }] })) };
}

test('an unused pool mock can edit topics and settings together without changing its subject-selection mode', async () => {
  const response = await invoke('put', '/:id/question-sets', payload());
  assert.equal(response.statusCode, 200);
  assert.equal(savedSets.length, 6);
  assert.equal(savedQuestions.length, 12);
  assert.deepEqual(savedQuestions.slice(0, 2).map((question) => [question.originalQuestionId, question.orderNum]), [['q-0-2', 1], ['q-0-3', 2]]);
  assert.equal(updated.totalPoints, 30);
  assert.equal(updated.title, 'Edited mock');
  assert.equal(updated.durationMinutes, 0);
  assert.equal(updated.looseFocus, false);
  assert.equal(updated.studentSelectsSubjects, undefined, 'mode cannot be changed by an edit');
  assert.ok(events.indexOf('lock') < events.indexOf('guard'));
  assert.ok(events.indexOf('guard') < events.indexOf('replace'));
});

test('selected, started and submitted papers reject question replacement while settings stay editable', async () => {
  for (const reason of Object.keys(guards)) {
    guards[reason] = 1;
    const response = await invoke('put', '/:id/question-sets', payload());
    assert.equal(response.statusCode, 409, reason);
    assert.equal(events.includes('replace'), false);
    guards[reason] = 0;
  }
  guards.started = 1;
  assert.equal((await invoke('put', '/:id', { settings: { multipleAttempts: true, duration: { minutes: 0 } } })).statusCode, 200);
  assert.equal(updated.durationHours, 2);
  assert.equal(updated.durationMinutes, 0);
  assert.equal(updated.multipleAttempts, true);
});

test('editing validates all topic selections and reports whether the paper can be changed', async () => {
  const invalid = payload();
  invalid.questionFilters[0] = null;
  assert.equal((await invoke('put', '/:id/question-sets', invalid)).statusCode, 400);
  assert.equal(events.includes('replace'), false);
  assert.equal((await invoke('get', '/:id')).body.quiz.canEditQuestions, true);
  guards.publicSessions = 1;
  assert.equal((await invoke('get', '/:id')).body.quiz.canEditQuestions, false);
});
