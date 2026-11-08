const test = require('node:test');
const assert = require('node:assert/strict');
const { selectedSubjects, sessionSubjects, matchesSubjects, isEnglishSubject } = require('../utils/mock-subjects');
const { deviceHeaders } = require('./helpers/public-device');

const ids = Array.from({ length: 6 }, (_, index) => `00000000-0000-4000-8000-00000000000${index + 1}`);
const quiz = { id: '10000000-0000-4000-8000-000000000001', title: 'All-subject mock', isActive: true, isOpenQuiz: true,
  examType: 'multi-subject', studentSelectsSubjects: true, viewResults: true, durationHours: 2, durationMinutes: 0, durationSeconds: 0,
  multipleAttempts: true,
  questionSets: ['Use of English', 'Physics', 'Biology', 'Chemistry', 'Mathematics', 'Economics'].map((title, index) => ({
    questionSetId: ids[index], title, orderNum: index + 1, totalPoints: index + 1,
    questions: [{ id: `question-${index + 1}`, type: 'multiple-choice', question: 'Question?', options: ['A', 'B'], correctAnswer: 'A', points: index + 1 }],
  })),
};

test('subject selection supports English aliases, enforces membership, and preserves fixed legacy exams', () => {
  assert.equal(isEnglishSubject('  USE  OF ENGLISH '), true);
  assert.equal(isEnglishSubject('English Literature'), false);
  assert.equal(matchesSubjects(quiz, ids.slice(0, 4)), true);
  assert.equal(matchesSubjects(quiz, ids.slice(1, 5)), false);
  assert.equal(matchesSubjects(quiz, [ids[0], ids[1], ids[2], ids[2]]), false);
  assert.equal(matchesSubjects(quiz, [...ids.slice(0, 3), 'unknown']), false);
  const legacy = { questionSets: quiz.questionSets.slice(1, 5) };
  assert.equal(matchesSubjects(legacy, ids.slice(1, 5)), true, 'old exams need not introduce English retroactively');
  assert.equal(matchesSubjects(legacy, ids.slice(0, 4)), false);
  assert.deepEqual(sessionSubjects({ quiz: legacy }), legacy.questionSets);
  assert.deepEqual(selectedSubjects(quiz, [1, 3, 5, 6], 'orderNum').map((set) => set.questionSetId), [ids[0], ids[2], ids[4], ids[5]]);
});

let session;
let attempt;
let grade;
const db = {
  quiz: { findMany: async () => [quiz], findUnique: async () => quiz },
  questionSet: { findMany: async () => quiz.questionSets.map((set) => ({ id: set.questionSetId, title: set.title })), count: async () => 4 },
  publicMockSession: {
    findFirst: async ({ where }) => session && (!where.attempt || ('isNot' in where.attempt ? !!attempt : !attempt)) ? { ...session, attempt } : null,
    create: async ({ data }) => { session = { id: '30000000-0000-4000-8000-000000000001', createdAt: new Date(), ...data, quiz }; attempt = null; return session; },
    findUnique: async () => ({ ...session, attempt }),
  },
  publicMockAttempt: { create: async ({ data }) => { attempt = { id: `attempt-${++attemptSequence}`, ...data }; return attempt; } },
  publicMockGrade: { upsert: async ({ create }) => { grade ||= create; return grade; } },
  $queryRaw: async () => [{ id: quiz.id }],
  $transaction: async (run) => run(db),
};
let attemptSequence = 0;
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
const router = require('../routes/public-exams');
async function invoke(method, path, body = {}, params = {}) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await route.stack.at(-1).handle({ body, params, headers: deviceHeaders() }, res);
  return res;
}

test('public pool mocks save the chosen subjects and grade/review only that paper, including unanswered questions', async () => {
  const listed = await invoke('get', '/question-sets');
  assert.equal(listed.body.mocks[0].studentSelectsSubjects, true);
  assert.equal(listed.body.mocks[0].compulsoryQuestionSetId, ids[0]);
  assert.deepEqual(listed.body.availableCombinations, [], 'a subject pool is not a fixed six-subject combination');
  const selected = [ids[0], ids[2], ids[4], ids[5]];
  const started = await invoke('post', '/mock/sessions', { quizId: quiz.id, name: 'Student', email: 'STUDENT@example.com', questionSetIds: selected });
  assert.equal(started.statusCode, 201);
  assert.deepEqual(session.selectedQuestionSetIds, selected);
  assert.deepEqual(Object.keys(started.body.session.questionsBySet), selected);
  const submitted = await invoke('post', '/mock/sessions/:id/submit', { answers: [{ questionId: 'question-1', answer: 'A' }] }, { id: session.id });
  assert.equal(submitted.statusCode, 200);
  assert.equal(submitted.body.attempt.totalPoints, 15);
  assert.equal(submitted.body.attempt.score, 1);
  assert.equal(submitted.body.review.length, 4, 'includes unanswered questions from chosen subjects only');
  assert.equal(submitted.body.countsForGrade, true);
  const invalid = await invoke('post', '/mock/sessions/:id/submit', { answers: [{ questionId: 'question-2', answer: 'A' }] }, { id: session.id });
  assert.equal(invalid.statusCode, 400, 'reject questions from a subject outside the saved choices');
  const originalGrade = grade;
  await invoke('post', '/mock/sessions', { quizId: quiz.id, name: 'Student', email: 'student@example.com', questionSetIds: ids.slice(0, 4) });
  const retake = await invoke('post', '/mock/sessions/:id/submit', { answers: [] }, { id: session.id });
  assert.equal(retake.body.attempt.totalPoints, 10);
  assert.equal(retake.body.countsForGrade, false);
  assert.equal(grade, originalGrade, 'changing subjects on a retake cannot replace the first graded result');
});

test('public admin records use the saved paper and preserve only its subject totals', () => {
  const { publicSubmission } = require('../utils/admin-submissions');
  const result = publicSubmission({ id: 'attempt', answers: [], score: 0, totalPoints: 15, percentage: 0,
    submittedAt: new Date(), session: { quizId: quiz.id, quiz, name: 'Student', email: 'student@example.com', createdAt: new Date(), selectedQuestionSetIds: [ids[0], ids[2], ids[4], ids[5]] } }, true, true);
  assert.deepEqual(result.questionSetSubmissions.map((set) => set.questionSetOrder), [1, 3, 5, 6]);
  assert.equal(result.answers.length, 4);
  assert.equal(result.questionSetSubmissions.reduce((sum, set) => sum + set.totalPoints, 0), 15);
});
