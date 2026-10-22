const test = require('node:test');
const assert = require('node:assert/strict');

const topicId = '11111111-1111-4111-8111-111111111111';
let created;
const database = {
  topic: { findUnique: async () => ({ id: topicId }) },
  studyMaterial: { create: async ({ data }) => { created = data; return data; } },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/study-hub');

async function createMaterial(body) {
  const layer = router.stack.find((item) => item.route?.path === '/admin/topics/:topicId/materials' && item.route.methods.post);
  const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await layer.route.stack.at(-1).handle({ params: { topicId }, body }, response);
  return response;
}

test('text material stores an attached diagram and description', async () => {
  const response = await createMaterial({ type: 'text', title: 'Forces', content: 'Study the graph.', diagramUrl: 'https://media.example.com/force.png', diagramAlt: 'Force plotted against time' });
  assert.equal(response.statusCode, 201);
  assert.equal(created.diagramUrl, 'https://media.example.com/force.png');
  assert.equal(created.diagramAlt, 'Force plotted against time');
});

test('attached diagrams need descriptive text and a valid URL', async () => {
  const missingAlt = await createMaterial({ type: 'passage', title: 'Motion', content: 'Read this.', diagramUrl: 'https://media.example.com/motion.png' });
  assert.equal(missingAlt.statusCode, 400);
  const invalidUrl = await createMaterial({ type: 'text', title: 'Motion', content: 'Read this.', diagramUrl: 'javascript:alert(1)', diagramAlt: 'Motion chart' });
  assert.equal(invalidUrl.statusCode, 400);
});

test('existing standalone image materials remain valid', async () => {
  const response = await createMaterial({ type: 'image', title: 'Motion diagram', content: 'https://media.example.com/motion.png', altText: 'Distance against time' });
  assert.equal(response.statusCode, 201);
  assert.equal(created.diagramUrl, null);
});
