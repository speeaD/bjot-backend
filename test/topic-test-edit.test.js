const test = require('node:test');
const assert = require('node:assert/strict');

const subjectId = '11111111-1111-4111-8111-111111111111';
const topicId = '22222222-2222-4222-8222-222222222222';
const testId = '33333333-3333-4333-8333-333333333333';
const firstId = '44444444-4444-4444-8444-444444444444';
const secondId = '55555555-5555-4555-8555-555555555555';
let saved = { id: testId, topicId, title: 'Motion test', questionIds: [firstId] };
let availableIds = [secondId];
const database = {
  topicTest: {
    findFirst: async () => saved,
    updateMany: async ({ where, data }) => {
      if (JSON.stringify(where.questionIds.equals) !== JSON.stringify(saved.questionIds)) return { count: 0 };
      saved = { ...saved, ...data };
      return { count: 1 };
    },
    findUnique: async () => saved,
  },
  question: { findMany: async () => availableIds.map((id) => ({ id })) },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/questionset');
const path = '/:id/topics/:topicId/tests/:testId/questions';

async function add(questionIds) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods.post);
  const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await layer.route.stack.at(-1).handle({ params: { id: subjectId, topicId, testId }, body: { questionIds } }, response);
  return response;
}

test('appending questions preserves the published test ID and existing question order', async () => {
  const response = await add([secondId]);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.test.id, testId);
  assert.deepEqual(saved.questionIds, [firstId, secondId]);
});

test('existing and unavailable questions cannot be appended', async () => {
  assert.equal((await add([firstId])).statusCode, 400);
  availableIds = [];
  assert.equal((await add(['66666666-6666-4666-8666-666666666666'])).statusCode, 400);
  assert.deepEqual(saved.questionIds, [firstId, secondId]);
});
