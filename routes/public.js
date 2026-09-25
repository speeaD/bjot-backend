const express = require('express');
const router = express.Router();
const prisma = require('../utils/database');
const { AUTO_GRADED_TYPES, publicQuestion, gradeQuestions, validateAnswers } = require('../utils/public-exam');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const include = { questionSets: { orderBy: { orderNum: 'asc' }, include: { questions: { orderBy: { orderNum: 'asc' } } } } };
const fail = (res, error) => { console.error('Public quiz error:', error); return res.status(500).json({ success: false, message: 'Unable to complete quiz request' }); };
const available = (quiz) => quiz.isActive && quiz.isOpenQuiz && quiz.viewResults && quiz.questionSets.length === 4 && quiz.questionSets.every((set) => set.questions.length && set.questions.every((question) => AUTO_GRADED_TYPES.has(question.type)));
const combination = (quiz) => quiz.questionSets.map((set) => set.questionSetId).sort().join(',');

router.post('/available', async (req, res) => {
  try {
    const ids = req.body?.questionSetCombination;
    if (!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4 || !ids.every((id) => typeof id === 'string' && UUID.test(id))) {
      return res.status(400).json({ success: false, message: 'Provide four different question set IDs' });
    }
    const quizzes = await prisma.quiz.findMany({ where: { isActive: true, isOpenQuiz: true }, include, orderBy: { createdAt: 'desc' } });
    const matches = quizzes.filter((quiz) => available(quiz) && combination(quiz) === [...ids].sort().join(','));
    res.json({ success: true, count: matches.length, quizzes: matches.map((quiz) => ({
      _id: quiz.id, settings: { title: quiz.title, description: quiz.description, coverImage: quiz.coverImage, duration: { hours: quiz.durationHours, minutes: quiz.durationMinutes, seconds: quiz.durationSeconds } },
      totalPoints: quiz.totalPoints, questionSetCombination: quiz.questionSets.map((set) => ({ _id: set.questionSetId, title: set.title })),
    })) });
  } catch (error) { fail(res, error); }
});

router.get('/submission/:id', async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid submission ID' });
    const attempt = await prisma.publicMockAttempt.findUnique({ where: { id: req.params.id }, include: { session: { include: { quiz: { include } } } } });
    if (!attempt) return res.status(404).json({ success: false, message: 'Submission not found' });
    if (!attempt.session.quiz.viewResults) return res.status(403).json({ success: false, message: 'Results viewing is not allowed for this quiz' });
    const submission = { id: attempt.id, score: attempt.score, totalPoints: attempt.totalPoints,
      percentage: Number(attempt.percentage), submittedAt: attempt.submittedAt, status: 'auto-graded',
      studentName: attempt.session.name, studentEmail: attempt.session.email };
    if (attempt.session.quiz.viewAnswer) {
      const answers = new Map(attempt.answers.map((item) => [item.questionId, item.answer]));
      submission.answersByQuestionSet = attempt.session.quiz.questionSets.map((set) => ({ questionSetTitle: set.title, order: set.orderNum,
        answers: set.questions.map((question) => ({ question: question.question, type: question.type,
          yourAnswer: answers.get(question.id) ?? null, correctAnswer: question.correctAnswer,
          isCorrect: gradeQuestions([question], [{ questionId: question.id, answer: answers.get(question.id) ?? '' }]).score === question.points,
          pointsPossible: question.points, pointsAwarded: gradeQuestions([question], [{ questionId: question.id, answer: answers.get(question.id) ?? '' }]).score })) }));
    }
    res.json({ success: true, submission });
  } catch (error) { fail(res, error); }
});

router.get('/:quizId', async (req, res) => {
  try {
    if (!UUID.test(req.params.quizId)) return res.status(400).json({ success: false, message: 'Invalid quiz ID' });
    const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quizId }, include });
    if (!quiz || !available(quiz)) return res.status(404).json({ success: false, message: 'Open quiz not found' });
    res.json({ success: true, quiz: { _id: quiz.id, settings: { title: quiz.title, description: quiz.description,
      duration: { hours: quiz.durationHours, minutes: quiz.durationMinutes, seconds: quiz.durationSeconds },
      viewResults: quiz.viewResults, viewAnswer: quiz.viewAnswer }, totalPoints: quiz.totalPoints,
      questionSetCombination: quiz.questionSets.map((set) => ({ _id: set.questionSetId, title: set.title })),
      questionSets: quiz.questionSets.map((set) => ({ _id: set.id, questionSetId: set.questionSetId,
        title: set.title, order: set.orderNum, totalPoints: set.totalPoints, questionCount: set.questions.length })) } });
  } catch (error) { fail(res, error); }
});

router.get('/:quizId/question-set/:order', async (req, res) => {
  try {
    if (!UUID.test(req.params.quizId)) return res.status(400).json({ success: false, message: 'Invalid quiz ID' });
    const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quizId }, include });
    if (!quiz || !available(quiz)) return res.status(404).json({ success: false, message: 'Open quiz not found' });
    const set = quiz.questionSets.find((item) => item.orderNum === Number(req.params.order));
    if (!set) return res.status(404).json({ success: false, message: 'Question set not found' });
    res.json({ success: true, questionSet: { _id: set.id, title: set.title, order: set.orderNum,
      totalPoints: set.totalPoints, questions: set.questions.map(publicQuestion) } });
  } catch (error) { fail(res, error); }
});

router.post('/:quizId/submit', async (req, res) => {
  try {
    const { name, email, questionSetCombination, answers } = req.body || {};
    if (!UUID.test(req.params.quizId) || typeof name !== 'string' || !name.trim() || name.length > 255 ||
      typeof email !== 'string' || !EMAIL.test(email.trim()) || email.length > 255 || !Array.isArray(questionSetCombination) ||
      questionSetCombination.length !== 4 || new Set(questionSetCombination).size !== 4) {
      return res.status(400).json({ success: false, message: 'Enter a name, valid email, and four different subjects' });
    }
    const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quizId }, include });
    if (!quiz || !available(quiz)) return res.status(404).json({ success: false, message: 'Open quiz not found' });
    if (combination(quiz) !== [...questionSetCombination].sort().join(',')) return res.status(400).json({ success: false, message: 'Question set combination does not match this quiz' });
    const questions = quiz.questionSets.flatMap((set) => set.questions);
    if (!validateAnswers(answers, new Set(questions.map((question) => question.id)))) return res.status(400).json({ success: false, message: 'Invalid answers' });
    const result = gradeQuestions(questions, answers);
    const normalizedEmail = email.trim().toLowerCase();
    const session = await prisma.publicMockSession.create({ data: { quizId: quiz.id, name: name.trim(), email: normalizedEmail } });
    const attempt = await prisma.publicMockAttempt.create({ data: { sessionId: session.id, ...result, answers } });
    const grade = await prisma.publicMockGrade.upsert({ where: { quizId_email: { quizId: quiz.id, email: normalizedEmail } },
      create: { quizId: quiz.id, email: normalizedEmail, attemptId: attempt.id, ...result }, update: {} });
    res.json({ success: true, message: 'Quiz submitted successfully', submission: { id: attempt.id, ...result,
      status: 'auto-graded', questionsAnswered: answers.length, totalQuestions: questions.length,
      countsForGrade: grade.attemptId === attempt.id, gradedScore: grade.score } });
  } catch (error) { fail(res, error); }
});

module.exports = router;
