const express = require('express');
const router = express.Router();
const prisma = require('../utils/database');
const { AUTO_GRADED_TYPES, publicQuestion, gradeQuestions, reviewQuestions, validateAnswers, selectedTestQuestions } = require('../utils/public-exam');
const { isEnglishSubject, matchesSubjects } = require('../utils/mock-subjects');
const { lockQuiz } = require('../utils/quiz-editing');
const { assertPublicMockRetakeAllowed, publicMockSubjects } = require('../utils/public-mock');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const quizInclude = { questionSets: { orderBy: { orderNum: 'asc' }, include: { questions: { orderBy: { orderNum: 'asc' } } } } };

function sendError(res, error) {
  console.error('Public exam error:', error);
  return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to complete exam request' });
}

function eligibleQuiz(quiz) {
  const validPool = quiz.studentSelectsSubjects
    ? quiz.questionSets.length >= 4 && quiz.questionSets.filter((set) => isEnglishSubject(set.title)).length === 1
    : quiz.questionSets.length === 4;
  return quiz.viewResults && validPool && quiz.questionSets.every((set) =>
    set.questions.length > 0 && set.questions.every((question) => AUTO_GRADED_TYPES.has(question.type)));
}

function publicResult(attempt) {
  return { score: attempt.score, totalPoints: attempt.totalPoints, percentage: Number(attempt.percentage) };
}

async function findOpenQuizzes() {
  const quizzes = await prisma.quiz.findMany({ where: { isActive: true, isOpenQuiz: true, examType: 'multi-subject' }, include: quizInclude, orderBy: { createdAt: 'desc' } });
  return quizzes.filter(eligibleQuiz);
}

router.get('/question-sets', async (_req, res) => {
  try {
    const quizzes = await findOpenQuizzes();
    const ids = [...new Set(quizzes.flatMap((quiz) => quiz.questionSets.map((set) => set.questionSetId)))];
    const sets = await prisma.questionSet.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, title: true } });
    const byId = new Map(sets.map((set) => [set.id, set]));
    const setStats = new Map(quizzes.flatMap((quiz) => quiz.questionSets.map((set) => [set.questionSetId, { questionCount: set.questions.length, totalPoints: set.totalPoints }])));
    const available = quizzes.filter((quiz) => quiz.questionSets.every((set) => byId.has(set.questionSetId)));
    res.json({ success: true, questionSets: ids.filter((id) => byId.has(id)).map((id) => ({ _id: id, title: byId.get(id).title, ...setStats.get(id) })),
      availableCombinations: available.filter((quiz) => !quiz.studentSelectsSubjects).map((quiz) => quiz.questionSets.map((set) => set.questionSetId)),
      mocks: available.map((quiz) => ({ id: quiz.id, title: quiz.title,
        multipleAttempts: quiz.multipleAttempts === true, looseFocus: quiz.looseFocus === true,
        studentSelectsSubjects: quiz.studentSelectsSubjects === true,
        compulsoryQuestionSetId: quiz.studentSelectsSubjects ? quiz.questionSets.find((set) => isEnglishSubject(set.title))?.questionSetId : undefined,
        questionSetIds: quiz.questionSets.map((set) => set.questionSetId),
        questionCount: quiz.questionSets.reduce((sum, set) => sum + set.questions.length, 0),
        durationSeconds: quiz.durationHours * 3600 + quiz.durationMinutes * 60 + quiz.durationSeconds })) });
  } catch (error) { sendError(res, error); }
});

router.post('/mock/sessions', async (req, res) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const ids = body.questionSetIds;
    if (!name || name.length > 255 || !EMAIL.test(email) || email.length > 255 || !Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4 || !ids.every((id) => typeof id === 'string' && UUID.test(id))) {
      return res.status(400).json({ success: false, message: 'Enter your name, a valid email, and four different subjects' });
    }
    if (body.quizId !== undefined && (typeof body.quizId !== 'string' || !UUID.test(body.quizId))) {
      return res.status(400).json({ success: false, message: 'Choose a valid free mock' });
    }
    const quizzes = await findOpenQuizzes();
    const quiz = quizzes.find((item) => (!body.quizId || item.id === body.quizId) && matchesSubjects(item, ids));
    if (!quiz) return res.status(404).json({ success: false, message: 'No free mock is available for this subject combination' });
    const activeSets = await prisma.questionSet.count({ where: { id: { in: ids }, isActive: true } });
    if (activeSets !== 4) return res.status(404).json({ success: false, message: 'One or more subjects are unavailable' });
    const session = await prisma.$transaction(async (tx) => {
      await lockQuiz(tx, quiz.id);
      const current = await tx.quiz.findUnique({ where: { id: quiz.id }, include: quizInclude });
      if (!current?.isActive || !current.isOpenQuiz || !eligibleQuiz(current) || !matchesSubjects(current, ids)) {
        throw Object.assign(new Error('This mock has changed. Choose your subjects again.'), { statusCode: 409 });
      }
      await assertPublicMockRetakeAllowed(tx, current, email);
      const latest = await tx.publicMockSession.findFirst({ where: { quizId: current.id, email },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { attempt: true } });
      const saved = latest && !latest.attempt ? latest : await tx.publicMockSession.create({
        data: { quizId: current.id, name, email, selectedQuestionSetIds: ids } });
      const chosenSets = publicMockSubjects({ ...saved, quiz: current });
      const durationSeconds = current.durationHours * 3600 + current.durationMinutes * 60 + current.durationSeconds;
      return { id: saved.id, quizId: current.id, title: current.title,
        multipleAttempts: current.multipleAttempts === true, looseFocus: current.looseFocus === true,
        durationSeconds, remainingSeconds: Math.max(0, durationSeconds - Math.max(0, Math.floor((Date.now() - saved.createdAt.getTime()) / 1000))),
        questionSetIds: chosenSets.map((set) => set.questionSetId),
        questionsBySet: Object.fromEntries(chosenSets.map((set) => [set.questionSetId,
          set.questions.map((question, index) => ({ ...publicQuestion(question), order: index + 1 }))])) };
    });
    res.status(201).json({ success: true, session });
  } catch (error) { sendError(res, error); }
});

router.post('/mock/sessions/:id/submit', async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid session' });
    const session = await prisma.publicMockSession.findUnique({ where: { id: req.params.id }, select: { id: true, quizId: true } });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    const result = await prisma.$transaction(async (tx) => {
      await lockQuiz(tx, session.quizId);
      // Re-read after locking: concurrent submissions and starts share this lock.
      const current = await tx.publicMockSession.findUnique({ where: { id: session.id }, include: { attempt: true, quiz: { include: quizInclude } } });
      if (!current) throw Object.assign(new Error('Session not found'), { statusCode: 404 });
      const questions = publicMockSubjects(current).flatMap((set) => set.questions);
      const ids = new Set(questions.map((question) => question.id));
      if (!validateAnswers(req.body?.answers, ids)) throw Object.assign(new Error('Answers contain invalid question IDs or values'), { statusCode: 400 });
      let attempt = current.attempt;
      if (!attempt) {
        await assertPublicMockRetakeAllowed(tx, current.quiz, current.email);
        const result = gradeQuestions(questions, req.body.answers);
        attempt = await tx.publicMockAttempt.create({ data: { sessionId: current.id, ...result, answers: req.body.answers } });
      }
      const grade = await tx.publicMockGrade.upsert({ where: { quizId_email: { quizId: current.quizId, email: current.email } },
        create: { quizId: current.quizId, email: current.email, attemptId: attempt.id,
          score: attempt.score, totalPoints: attempt.totalPoints, percentage: attempt.percentage }, update: {} });
      return { success: true, attempt: publicResult(attempt), gradedResult: publicResult(grade), countsForGrade: grade.attemptId === attempt.id,
        review: current.quiz.viewAnswer === false ? [] : reviewQuestions(questions, attempt.answers) };
    });
    res.json(result);
  } catch (error) { sendError(res, error); }
});

async function findTopic(query) {
  if (typeof query.topicId === 'string' && UUID.test(query.topicId)) {
    const test = await prisma.topicTest.findUnique({ where: { id: query.topicId }, include: {
      topic: { include: { questionSet: { select: { id: true, title: true, isActive: true } } } },
    } });
    if (test) {
      if (!test.topic.isActive || !test.topic.questionSet.isActive) return null;
      if (!Array.isArray(test.questionIds) || !test.questionIds.length) return null;
      const available = await prisma.question.findMany({ where: { id: { in: test.questionIds }, topicId: test.topicId,
        isArchived: false, type: { in: [...AUTO_GRADED_TYPES] } } });
      const questions = selectedTestQuestions(test.questionIds, available);
      if (!questions) return null;
      return { id: test.id, name: test.title, questionSet: test.topic.questionSet, questions };
    }
    return prisma.topic.findFirst({ where: { id: query.topicId, isActive: true, questionSet: { isActive: true } },
      include: { questionSet: { select: { id: true, title: true } }, questions: { where: { isArchived: false, type: { in: [...AUTO_GRADED_TYPES] } }, orderBy: { orderNum: 'asc' } } } });
  }
  if (typeof query.questionSetId === 'string' && UUID.test(query.questionSetId) && typeof query.topic === 'string' && query.topic.trim()) {
    return prisma.topic.findFirst({ where: { questionSetId: query.questionSetId, name: { equals: query.topic.trim(), mode: 'insensitive' }, isActive: true, questionSet: { isActive: true } },
      include: { questionSet: { select: { id: true, title: true } }, questions: { where: { isArchived: false, type: { in: [...AUTO_GRADED_TYPES] } }, orderBy: { orderNum: 'asc' } } } });
  }
  return null;
}

router.get('/topic/questions', async (req, res) => {
  try {
    const topic = await findTopic(req.query);
    if (!topic || !topic.questions.length) return res.status(404).json({ success: false, message: 'Topic test is unavailable' });
    res.json({ success: true, topic: { id: topic.id, name: topic.name },
      questionSet: { _id: topic.questionSet.id, title: topic.questionSet.title, questionCount: topic.questions.length,
        totalPoints: topic.questions.reduce((sum, question) => sum + question.points, 0) }, questions: topic.questions.map(publicQuestion) });
  } catch (error) { sendError(res, error); }
});

router.post('/topic/submit', async (req, res) => {
  try {
    const topic = await findTopic(req.body || {});
    if (!topic || !topic.questions.length) return res.status(404).json({ success: false, message: 'Topic test is unavailable' });
    const ids = new Set(topic.questions.map((question) => question.id));
    if (!validateAnswers(req.body?.answers, ids)) return res.status(400).json({ success: false, message: 'Answers contain invalid question IDs or values' });
    res.json({ success: true, result: gradeQuestions(topic.questions, req.body.answers), review: reviewQuestions(topic.questions, req.body.answers) });
  } catch (error) { sendError(res, error); }
});

module.exports = router;
