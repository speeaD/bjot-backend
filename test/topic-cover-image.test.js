const test = require('node:test');
const assert = require('node:assert/strict');

const subjectId = '11111111-1111-4111-8111-111111111111';
const topicId = '22222222-2222-4222-8222-222222222222';
const studentId = '33333333-3333-4333-8333-333333333333';
const coverImageUrl = 'https://media.example.com/cms/study-hub/images/motion.jpg';
let topic;
let writes;
let subjectQuery;
let topicQuery;
let topicAvailable;

const database = {
  questionSet: {
    findUnique: async () => ({ id: subjectId }),
    findMany: async (query) => {
      subjectQuery = query;
      assert.equal(query.select.topics.select.coverImageUrl, true);
      return [{ id: subjectId, title: 'Physics', topics: [{ ...topic }] }];
    },
  },
  topic: {
    create: async ({ data }) => { writes++; topic = { id: topicId, isActive: true, coverImageUrl: null, ...data }; return topic; },
    findFirst: async (query) => { topicQuery = query; return topicAvailable ? { ...topic, questionSet: { id: subjectId, title: 'Physics' } } : null; },
    update: async ({ data }) => { writes++; topic = { ...topic, ...data }; return topic; },
  },
  studyMaterial: { findMany: async () => [] },
  question: { count: async () => 0 },
  studyAttempt: { findMany: async () => [] },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const adminRouter = require('../routes/questionset');
const studentRouter = require('../routes/study-hub');

test.beforeEach(() => {
  topic = { id: topicId, questionSetId: subjectId, name: 'Motion', isActive: true, coverImageUrl };
  writes = 0;
  topicAvailable = true;
});

async function call(router, method, path, body = {}) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await layer.route.stack.at(-1).handle({ params: { id: path.startsWith('/:id/') ? subjectId : topicId, topicId }, body, quizTaker: { id: studentId, accountType: 'premium' } }, response);
  return response;
}

test('admins can create a topic with an optional cover image', async () => {
  const created = await call(adminRouter, 'post', '/:id/topics', { name: ' Waves ', coverImageUrl: ` ${coverImageUrl} ` });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.topic.name, 'Waves');
  assert.equal(created.body.topic.coverImageUrl, coverImageUrl);
  assert.equal(created.body.topic.questionSetId, subjectId);

  const withoutCover = await call(adminRouter, 'post', '/:id/topics', { name: 'Forces' });
  assert.equal(withoutCover.statusCode, 201);
  assert.equal(withoutCover.body.topic.coverImageUrl, null);
});

test('cover-only updates preserve the topic name and status', async () => {
  const response = await call(adminRouter, 'put', '/:id/topics/:topicId', { coverImageUrl: ' https://media.example.com/new-cover.png ' });
  assert.equal(response.statusCode, 200);
  assert.equal(topic.coverImageUrl, 'https://media.example.com/new-cover.png');
  assert.equal(topic.name, 'Motion');
  assert.equal(topic.isActive, true);
  assert.deepEqual(topicQuery.where, { id: topicId, questionSetId: subjectId });
});

test('renaming and toggling a topic preserve its cover when the field is omitted', async () => {
  assert.equal((await call(adminRouter, 'put', '/:id/topics/:topicId', { name: 'Linear motion' })).statusCode, 200);
  assert.equal(topic.coverImageUrl, coverImageUrl);
  assert.equal((await call(adminRouter, 'put', '/:id/topics/:topicId', { isActive: false })).statusCode, 200);
  assert.equal(topic.coverImageUrl, coverImageUrl);
  assert.equal(topic.name, 'Linear motion');
  assert.equal(topic.isActive, false);
});

test('admins can remove a cover using null or an empty string', async () => {
  for (const value of [null, '', '   ']) {
    topic.coverImageUrl = coverImageUrl;
    const response = await call(adminRouter, 'put', '/:id/topics/:topicId', { coverImageUrl: value });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.topic.coverImageUrl, null);
  }
});

test('invalid URLs, credentials, oversized URLs, and non-string covers are rejected without writes', async () => {
  const invalid = ['javascript:alert(1)', 'data:image/png;base64,a', '/local-image.png', 'not a URL', 'https://user:secret@example.com/image.png', `https://example.com/${'x'.repeat(500)}`, 42, false, {}, []];
  for (const value of invalid) {
    assert.equal((await call(adminRouter, 'post', '/:id/topics', { name: 'Waves', coverImageUrl: value })).statusCode, 400);
    assert.equal((await call(adminRouter, 'put', '/:id/topics/:topicId', { coverImageUrl: value })).statusCode, 400);
  }
  assert.equal(writes, 0);
  assert.equal(topic.coverImageUrl, coverImageUrl);
});

test('student subject lists include covers and keep enrollment and active-topic filters', async () => {
  const response = await call(studentRouter, 'get', '/subjects');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.subjects[0].topics[0].coverImageUrl, coverImageUrl);
  assert.deepEqual(subjectQuery.where, { isActive: true, quizTakerQuestionSets: { some: { quizTakerId: studentId } } });
  assert.deepEqual(subjectQuery.select.topics.where, { isActive: true });
});

test('student topic details expose the cover and support topics without covers', async () => {
  const response = await call(studentRouter, 'get', '/topics/:id');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.topic.coverImageUrl, coverImageUrl);
  assert.equal(topicQuery.where.isActive, true);
  assert.equal(topicQuery.where.questionSet.quizTakerQuestionSets.some.quizTakerId, studentId);
  topic.coverImageUrl = null;
  assert.equal((await call(studentRouter, 'get', '/topics/:id')).body.topic.coverImageUrl, null);
});

test('unavailable topics do not expose their cover or allow updates', async () => {
  topicAvailable = false;
  const studentResponse = await call(studentRouter, 'get', '/topics/:id');
  assert.equal(studentResponse.statusCode, 404);
  assert.equal(studentResponse.body.topic, undefined);
  assert.equal((await call(adminRouter, 'put', '/:id/topics/:topicId', { coverImageUrl: null })).statusCode, 404);
  assert.equal(writes, 0);
});
