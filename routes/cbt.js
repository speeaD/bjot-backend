const express = require('express');
const { randomInt } = require('node:crypto');
const prisma = require('../utils/database');
const { verifyQuizTaker } = require('../middleware/auth');
const { AUTO_GRADED_TYPES, publicQuestion, gradeQuestions, validateAnswers } = require('../utils/public-exam');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Topic questions share the subject's questionSetId. Keep legacy questions usable
// while excluding archived questions and questions from inactive topics.
const eligible = {
  isArchived: false,
  type: { in: [...AUTO_GRADED_TYPES] },
  OR: [{ topicId: null }, { topic: { isActive: true } }],
};
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    if (!error.status) console.error('CBT request failed:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Unable to complete the exam request. Please try again.' });
  }
};
const summary = (set) => ({
  _id: set.id, title: set.title, questionCount: set.questions.length,
  totalPoints: set.questions.reduce((sum, question) => sum + question.points, 0),
});
const result = (submission) => ({
  id: submission.id, score: submission.score, totalPoints: submission.totalPoints,
  percentage: Number(submission.percentage), timeTaken: submission.timeTaken, submittedAt: submission.submittedAt,
});
function sample(questions, limit) {
  const shuffled = [...questions];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled.slice(0, limit);
}

router.use(verifyQuizTaker);

router.get('/question-sets', handle(async (_req, res) => {
  const sets = await prisma.questionSet.findMany({ where: { isActive: true }, orderBy: { title: 'asc' },
    include: { questions: { where: eligible, select: { points: true } } } });
  const questionSets = sets.filter((set) => set.questions.length).map(summary);
  res.json({ success: true, count: questionSets.length, questionSets });
}));

router.get('/question-set/:id/questions', handle(async (req, res) => {
  if (!UUID.test(req.params.id)) fail(400, 'Invalid subject');
  const set = await prisma.questionSet.findFirst({ where: { id: req.params.id, isActive: true },
    include: { questions: { where: eligible, orderBy: { orderNum: 'asc' } } } });
  if (!set || !set.questions.length) fail(404, 'This subject has no available questions');
  res.json({ success: true, questionSet: { ...summary(set), questions: set.questions.map(publicQuestion) } });
}));

function start(singleSubject) {
  return handle(async (req, res) => {
    const ids = singleSubject ? [req.body?.questionSetId] : req.body?.questionSetIds;
    const count = singleSubject ? 1 : 4;
    if (!Array.isArray(ids) || ids.length !== count || new Set(ids).size !== count ||
        !ids.every((id) => typeof id === 'string' && UUID.test(id))) {
      fail(400, singleSubject ? 'Please select a subject' : 'Please select exactly four different subjects');
    }
    const sets = await prisma.questionSet.findMany({ where: { id: { in: ids }, isActive: true },
      include: { questions: { where: eligible } } });
    if (sets.length !== count) fail(400, 'One or more selected subjects are unavailable');
    const selected = ids.map((id) => sets.find((set) => set.id === id)).map((set) => {
      if (!set.questions.length) fail(400, `${set.title} has no available questions`);
      const limit = !singleSubject && set.title.toLowerCase().includes('english') ? 60 : 40;
      return { ...set, questions: sample(set.questions, limit) };
    });
    // Persist the sampled IDs before returning questions. Unanswered questions
    // remain part of the denominator, and the client cannot choose its own paper.
    const session = await prisma.cbtSubmission.create({ data: {
      quizTakerId: req.quizTaker.id, startedAt: new Date(),
      totalPoints: selected.reduce((sum, set) => sum + summary(set).totalPoints, 0),
      questionSets: { create: selected.map((set, index) => ({ questionSetId: set.id, title: set.title, orderNum: index + 1 })) },
      answers: { createMany: { data: selected.flatMap((set) => set.questions.map((question) => ({
        questionId: question.id, questionSetId: set.id, pointsPossible: question.points,
      }))) } },
    } });
    res.json({ success: true, session: {
      sessionId: session.id, quizTakerId: session.quizTakerId, startedAt: session.startedAt,
      durationSeconds: singleSubject ? 3600 : 7200,
      questionSets: selected.map(summary),
      questionsBySet: Object.fromEntries(selected.map((set) => [set.id, set.questions.map(publicQuestion)])),
    } });
  });
}
router.post('/start-session', start(false));
router.post('/start-single-subject', start(true));

function submit(singleSubject) {
  return handle(async (req, res) => {
    const sessionId = req.body?.sessionId;
    if (typeof sessionId !== 'string' || !UUID.test(sessionId)) fail(400, 'Invalid exam session');
    const submission = await prisma.$transaction(async (db) => {
      // Serialize retries so the result is written only once.
      const rows = await db.$queryRaw`SELECT id FROM cbt_submissions WHERE id = ${sessionId}::uuid AND quiz_taker_id = ${req.quizTaker.id}::uuid FOR UPDATE`;
      if (!rows.length) fail(404, 'Exam session not found');
      const session = await db.cbtSubmission.findUnique({ where: { id: sessionId }, include: {
        questionSets: { orderBy: { orderNum: 'asc' } }, answers: { include: { question: true } },
      } });
      if (session.questionSets.length !== (singleSubject ? 1 : 4)) fail(400, 'Incorrect exam type');
      if (session.submittedAt) return session;
      if (session.answers.some((answer) => !answer.question)) fail(409, 'An exam question is no longer available. Please start a new exam.');
      const questions = session.answers.map((answer) => ({ ...answer.question, points: answer.pointsPossible }));
      if (!validateAnswers(req.body?.answers, new Set(questions.map((question) => question.id)))) {
        fail(400, 'Answers contain invalid question IDs or values');
      }
      const grade = gradeQuestions(questions, req.body.answers);
      const submittedAt = new Date();
      const timeTaken = Math.max(0, Math.floor((submittedAt - session.startedAt) / 1000));
      const byId = new Map(req.body.answers.map((answer) => [answer.questionId, answer.answer]));
      const saved = await db.cbtSubmission.update({ where: { id: sessionId }, data: {
        ...grade, submittedAt, timeTaken,
        answers: { deleteMany: {}, createMany: { data: session.answers.map((row, index) => {
          const answer = byId.get(row.questionId) ?? '';
          const marked = gradeQuestions([questions[index]], [{ questionId: row.questionId, answer }]);
          return { questionId: row.questionId, questionSetId: row.questionSetId, pointsPossible: row.pointsPossible,
            answer, isCorrect: marked.percentage === 100, pointsAwarded: marked.score };
        }) } },
      } });
      // Analytics reads CBT submissions directly; a quiz-history copy would
      // count this attempt twice.
      return saved;
    });
    res.json({ success: true, submission: result(submission) });
  });
}
router.post('/submit', submit(false));
router.post('/submit-single-subject', submit(true));

module.exports = router;
