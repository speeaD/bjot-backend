const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const subjects = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Literature in English', 'English Language'].map((title, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, title, isActive: true,
}));
let available;
let writes;
let savedCombination;
let createdData;
let loginCode;
const database = {
  quizTaker: { findFirst: async () => null, findUnique: async ({ where }) => {
    loginCode = where.accessCode;
    return where.accessCode === 'ABC234XYZ' ? { id: 'student', email: 'test@example.com', accessCode: where.accessCode, accountType: 'regular', isActive: true } : null;
  } },
  questionSet: {
    findMany: async ({ where }) => {
      assert.equal(where.isActive, true);
      return available.filter((subject) => subject.isActive && where.id.in.includes(subject.id));
    },
  },
  $transaction: async (callback) => {
    writes++;
    return callback({
      quizTaker: { create: async ({ data }) => { createdData = data; return { id: 'student', ...data }; } },
      quizTakerQuestionSet: { createMany: async ({ data }) => { savedCombination = data; } },
    });
  },
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/auth');
const register = router.stack.find((layer) => layer.route?.path === '/quiztaker/register').route.stack[0].handle;
const login = router.stack.find((layer) => layer.route?.path === '/quiztaker/login').route.stack[0].handle;

beforeEach(() => { available = subjects.map((subject) => ({ ...subject })); writes = 0; savedCombination = undefined; createdData = undefined; loginCode = undefined; });

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
  assert.equal(createdData.accountType, 'regular');
  assert.equal(createdData.isActive, true);
  assert.equal(createdData.accessCode.length, 9);
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

test('student login requires the access code, never the email', async () => {
  process.env.JWT_SECRET = 'test-secret';
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const emailAttempt = response();
  await login({ body: { email: 'test@example.com' } }, emailAttempt);
  assert.equal(emailAttempt.statusCode, 400);
  const codeAttempt = response();
  await login({ body: { accessCode: 'abc234xyz' } }, codeAttempt);
  assert.equal(loginCode, 'ABC234XYZ');
  assert.equal(codeAttempt.body.quizTaker.accountType, 'regular');
  assert.equal('accessCode' in codeAttempt.body.quizTaker, false);
});
