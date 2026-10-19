const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuestionCsv, grade } = require('../utils/past-questions');

const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const studentId = uuid(9000);
const subjectIds = [1, 2, 3, 4].map(uuid);
const subjects = ['Use of English', 'Physics', 'Mathematics', 'Literature in English'].map((title, index) => ({ id: subjectIds[index], title }));
const makePaper = (year, index) => ({ id: uuid(year * 10 + index), sourceExam: 'JAMB', year,
  subjectId: subjectIds[index], subjectTitle: subjects[index].title, version: 1, isPublished: true,
  questionCount: 2, durationSeconds: 7200,
  questions: [0, 1].map((number) => ({ id: uuid(year * 100 + index * 2 + number), orderNum: number + 1,
    question: `Fictional ${year} ${index} ${number}`, passage: '', options: ['Wrong', 'Right'],
    correctAnswer: 'Right', explanation: 'Example explanation', mediaUrl: null, mediaAlt: '' })) });
const papers = subjects.map((_, index) => makePaper(2024, index));
papers.push(makePaper(2025, 0));
let attempt;
let writes;
const database = {
  questionSet: { findMany: async ({ where }) => subjects.filter((subject) => !where?.id || where.id.in.includes(subject.id)) },
  pastPaper: { findMany: async ({ where }) => papers.filter((paper) => paper.year === where.year && where.subjectId.in.includes(paper.subjectId) && paper.isPublished) },
  pastAttempt: {
    create: async ({ data }) => { attempt = { id: uuid(9999), ...data, answers: {}, score: null,
      startedAt: new Date(), submittedAt: null }; return attempt; },
    findFirst: async ({ where }) => attempt?.id === where.id && attempt?.quizTakerId === where.quizTakerId ? attempt : null,
    findUnique: async ({ where }) => attempt?.id === where.id ? attempt : null,
    update: async ({ data }) => { writes++; attempt = { ...attempt, ...data }; return attempt; },
  },
  $queryRaw: async (_parts, id, owner) => attempt?.id === id && attempt?.quizTakerId === owner ? [{ id }] : [],
  $transaction: async (callback) => callback(database),
};
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };
const router = require('../routes/past-questions');
const { verifyAdmin, verifyQuizTaker } = require('../middleware/auth');

test.beforeEach(() => { attempt = null; writes = 0; });
async function call(method, path, body = {}, params = {}, owner = studentId, accountType = 'premium') {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await layer.route.stack.at(-1).handle({ body, params, quizTaker: { id: owner, accountType } }, response);
  return response;
}
const start = (year = 2024) => call('post', '/attempts', { year, subjectIds });

test('CSV import validates every row, answer text, and duplicate questions', () => {
  const header = 'Passage,Question,Option A,Option B,Option C,Option D,Option E,Correct Answer,Explanation';
  const row = ',Fictional question,Wrong,Right,,,,"B — Right",Invented explanation';
  const parsed = parseQuestionCsv(Buffer.from(`${header}\n${row}\n${row}\n,Other question,Wrong,Right,,,,"B — Mismatch",`));
  assert.equal(parsed.questions.length, 3);
  assert(parsed.errors.some((item) => item.row === 3 && item.message.includes('Duplicate')));
  assert(parsed.errors.some((item) => item.row === 4 && item.message.includes('does not match')));
  assert.equal(parseQuestionCsv(Buffer.from(`${header}\n${row}`)).errors.length, 0);
});

test('student and admin routes keep their separate authorization guards', () => {
  const student = router.stack.find((item) => item.route?.path === '/availability');
  assert.equal(student.route.stack[0].handle, verifyQuizTaker);
  assert(router.stack.some((item) => item.handle === verifyAdmin));
});

test('start uses only the selected year and saves exact IDs without exposing answers', async () => {
  const response = await start();
  assert.equal(response.statusCode, 201);
  assert.equal(attempt.year, 2024);
  assert.equal(attempt.questionSnapshot.length, 8);
  assert(attempt.questionSnapshot.every((question) => question.question.includes('2024')));
  assert.deepEqual(attempt.paperSnapshot.map((paper) => paper.subjectId), subjectIds);
  assert.equal('correctAnswer' in response.body.attempt.questionsBySet[subjectIds[0]][0], false);
  assert.equal((await start(2025)).statusCode, 409);
});

test('regular accounts receive no more than ten questions from the same paper', async () => {
  const english = papers[0];
  const original = { questions: english.questions, questionCount: english.questionCount };
  try {
    english.questions = Array.from({ length: 12 }, (_, index) => ({ ...original.questions[0], id: uuid(70000 + index), orderNum: index + 1 }));
    english.questionCount = 12;
    const response = await call('post', '/attempts', { year: 2024, subjectIds }, {}, studentId, 'regular');
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.attempt.questionsBySet[subjectIds[0]].length, 10);
    assert.equal(attempt.paperSnapshot[0].questionCount, 10);
    assert.equal(attempt.durationSeconds, 7200);
  } finally { Object.assign(english, original); }
});

test('attempt ownership is enforced on resume and submission', async () => {
  await start();
  const other = uuid(1234);
  assert.equal((await call('get', '/attempts/:id', {}, { id: attempt.id }, other)).statusCode, 404);
  assert.equal((await call('post', '/attempts/:id/submit', {}, { id: attempt.id }, other)).statusCode, 404);
  assert.equal(writes, 0);
});

test('saved answers survive resume, grade on the server, and duplicate submit is idempotent', async () => {
  await start();
  const questionId = attempt.questionSnapshot[0].id;
  const saved = await call('patch', '/attempts/:id/answers', { answers: { [questionId]: 'Right' } }, { id: attempt.id });
  assert.equal(saved.statusCode, 200);
  const resumed = await call('get', '/attempts/:id', {}, { id: attempt.id });
  assert.equal(resumed.body.attempt.answers[questionId], 'Right');
  const first = await call('post', '/attempts/:id/submit', {}, { id: attempt.id });
  assert.equal(first.body.result.score, 1);
  assert.equal(first.body.result.totalPoints, 8);
  assert.equal(first.body.result.review[0].correctAnswer, 'Right');
  const count = writes;
  const second = await call('post', '/attempts/:id/submit', { answers: { [questionId]: 'Wrong' } }, { id: attempt.id });
  assert.equal(writes, count);
  assert.deepEqual(second.body.result, first.body.result);
  assert.equal(grade(attempt.questionSnapshot, attempt.answers).score, 1);
});

test('expired attempts submit only saved answers and reject late changes', async () => {
  await start();
  const questionId = attempt.questionSnapshot[0].id;
  attempt.answers = { [questionId]: 'Right' };
  attempt.startedAt = new Date(Date.now() - 7201 * 1000);
  const late = await call('patch', '/attempts/:id/answers', { answers: { [questionId]: 'Wrong' } }, { id: attempt.id });
  assert.equal(late.statusCode, 409);
  assert.equal(attempt.score, 1);
  const result = await call('get', '/attempts/:id/result', {}, { id: attempt.id });
  assert.equal(result.body.result.score, 1);
});
