const test = require('node:test');
const assert = require('node:assert/strict');
let saved;
const existing = { id: 'quiz', durationHours: 2, durationMinutes: 30, durationSeconds: 0 };
const database = {
  questionSet: { findMany: async () => [{ id: 'english', title: 'English', questions: [{ id: 'question', question: 'Question', type: 'multiple-choice', points: 1 }] }] },
  quiz: {
    create: async ({ data }) => { saved = data; return { id: 'quiz', ...data }; },
    findUnique: async () => existing,
    update: async ({ data }) => { saved = data; return { ...existing, ...data }; },
  },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/quiz');
async function invoke(method, path, body) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await route.stack.at(-1).handle({ params: { id: 'quiz' }, admin: { id: 'admin' }, body }, response);
  return response;
}

test('creating an exam preserves its exact selected duration instead of silently adding thirty minutes', async () => {
  for (const duration of [{ hours: 2, minutes: 0, seconds: 0 }, { hours: 1, minutes: 0, seconds: 15 }, { hours: 0, minutes: 45, seconds: 0 }]) {
    const result = await invoke('post', '/', { settings: { title: 'Timed exam', examType: 'single-subject', duration }, questionSetCombination: ['english'] });
    assert.equal(result.statusCode, 201);
    assert.deepEqual([saved.durationHours, saved.durationMinutes, saved.durationSeconds], [duration.hours, duration.minutes, duration.seconds]);
  }
});

test('editing a previously saved 150-minute exam can explicitly reset minutes to zero', async () => {
  const response = await invoke('put', '/:id', { settings: { duration: { minutes: 0 } } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual([saved.durationHours, saved.durationMinutes, saved.durationSeconds], [2, 0, 0]);
  assert.equal(existing.durationMinutes, 30, 'unrelated existing exams are not automatically rewritten');
  assert.equal((await invoke('put', '/:id', { settings: { duration: { hours: 0, minutes: 0, seconds: 0 } } })).statusCode, 400);
});
