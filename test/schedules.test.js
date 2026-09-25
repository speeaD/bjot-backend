const { test } = require('node:test');
const assert = require('node:assert/strict');

const subjectId = '11111111-1111-4111-8111-111111111111';
const record = {
  id: 'schedule-id', department: 'Sciences', createdById: 'admin-id', isActive: true,
  weeklyClasses: [{ id: 'class-id', questionSetId: subjectId, questionSetTitle: 'Physics', dayOfWeek: 1, dayName: 'Monday', startTime: '19:00', endTime: '21:00', isActive: true }],
  overrides: [],
};
let saved;
const database = {
  schedule: {
    findMany: async () => [record],
    findUnique: async ({ where }) => where.department === 'Sciences' ? record : null,
    upsert: async (args) => { saved = args; return record; },
  },
  questionSet: { findMany: async () => [{ id: subjectId, title: 'Physics' }] },
};
// Isolate route tests from production credentials and database writes.
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/schedules');

async function call(method, path, request = {}) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await layer.route.stack[0].handle({ params: {}, admin: { id: 'admin-id' }, ...request }, response);
  return response;
}

test('schedule reads expose the fields the existing frontend expects', async () => {
  const response = await call('get', '/');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data[0]._id, record.id);
  assert.equal(response.body.data[0].weeklySchedule[0].questionSet, subjectId);
  assert.equal(response.body.data[0].weeklySchedule[0]._id, 'class-id');
});
test('a department with no saved schedule returns null, not an error', async () => {
  const response = await call('get', '/:department', { params: { department: 'Arts' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data, null);
});
test('unknown departments are rejected', async () => {
  assert.equal((await call('get', '/:department', { params: { department: 'Unknown' } })).statusCode, 400);
});
test('invalid class times are rejected before saving', async () => {
  saved = undefined;
  const response = await call('post', '/', { body: { department: 'Sciences', weeklySchedule: [{ dayOfWeek: 1, questionSet: subjectId, startTime: '21:00', endTime: '19:00' }] } });
  assert.equal(response.statusCode, 400);
  assert.equal(saved, undefined);
});
test('saving derives subject names and replaces weekly classes atomically without changing overrides', async () => {
  const response = await call('post', '/', { body: { department: 'Sciences', weeklySchedule: [{ dayOfWeek: 1, dayName: 'Friday', questionSet: subjectId, questionSetTitle: 'Wrong', startTime: '19:00', endTime: '21:00' }] } });
  assert.equal(response.statusCode, 200);
  assert.equal(saved.update.weeklyClasses.create[0].dayName, 'Monday');
  assert.equal(saved.update.weeklyClasses.create[0].questionSetTitle, 'Physics');
  assert.deepEqual(Object.keys(saved.update), ['weeklyClasses']);
  assert.equal(saved.create.createdById, 'admin-id');
});
test('the router requires authentication', async () => {
  const response = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  await router.stack[0].handle({ header: () => undefined }, response, () => assert.fail('Unauthenticated request was allowed'));
  assert.equal(response.statusCode, 401);
});
