const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const subjects = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Literature in English', 'English Language'].map((title, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, title, isActive: true,
}));
let available;
let writes;
let savedCombination;
const database = {
  quizTaker: { findFirst: async () => null, findUnique: async () => null },
  questionSet: {
    findMany: async ({ where }) => {
      assert.equal(where.isActive, true);
      return available.filter((subject) => subject.isActive && where.id.in.includes(subject.id));
    },
  },
  $transaction: async (callback) => {
    writes++;
    return callback({
      quizTaker: { create: async ({ data }) => ({ id: 'student', ...data }) },
      quizTakerQuestionSet: { createMany: async ({ data }) => { savedCombination = data; } },
    });
  },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/auth');
const register = router.stack.find((layer) => layer.route?.path === '/quiztaker/register').route.stack[0].handle;

beforeEach(() => { available = subjects.map((subject) => ({ ...subject })); writes = 0; savedCombination = undefined; });

async function call(ids) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await register({ body: { accountType: 'premium', firstname: 'Test', lastname: 'Student', email: 'test@example.com', questionSetCombination: ids } }, response);
  return response;
}
const ids = (indices) => indices.map((index) => subjects[index].id);

test('registration saves English plus three different subjects', async () => {
  const selected = ids([0, 1, 2, 3]);
  assert.equal((await call(selected)).statusCode, 201);
  assert.equal(writes, 1);
  assert.deepEqual(savedCombination.map((item) => item.questionSetId), selected);
});

test('registration rejects invalid combinations without creating an account', async () => {
  for (const selected of [ids([0, 1, 2]), ids([0, 1, 2, 3, 4]), ids([1, 2, 3, 4]), ids([5, 1, 2, 3]), ids([0, 0, 1, 2]), ids([0, 6, 1, 2]), [null, ...ids([1, 2, 3])], ['invalid-id', ...ids([1, 2, 3])], '1234']) {
    assert.equal((await call(selected)).statusCode, 400);
    assert.equal(writes, 0);
  }
});

test('registration rejects inactive and missing subjects', async () => {
  available[0].isActive = false;
  assert.equal((await call(ids([0, 1, 2, 3]))).statusCode, 400);
  available = subjects.filter((subject) => subject.id !== subjects[3].id);
  assert.equal((await call(ids([0, 1, 2, 3]))).statusCode, 400);
  assert.equal(writes, 0);
});

test('English naming variants work without treating Literature in English as compulsory English', async () => {
  for (const title of ['English', 'English Language', '  USE   OF ENGLISH  ']) {
    available[0].title = title;
    assert.equal((await call(ids([0, 1, 2, 5]))).statusCode, 201);
  }
});
