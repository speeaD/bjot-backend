const express = require('express');
const prisma = require('../utils/database');
const { verifyQuizTaker } = require('../middleware/auth');
const { publicQuestion, gradeQuestions } = require('../utils/public-exam');
const { GAME_IDS, TIME_ATTACK_SECONDS, weeklyWindow, scoreAnswer, buildLeaderboard } = require('../utils/games');
const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eligible = { type: 'multiple-choice', isArchived: false };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const handle = fn => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    if (!error.status) console.error('Game request failed:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Unable to complete game request. Please try again.' });
  }
};

router.use(verifyQuizTaker);

async function nextQuestion(db, session) {
  return db.question.findFirst({
    where: { ...eligible, questionSetId: session.questionSetId, gameUsedQuestions: { none: { gameSessionId: session.id } } },
    orderBy: [{ orderNum: 'asc' }, { id: 'asc' }],
  });
}

function expiresAt(session) {
  return session.gameType === 'time-attack' ? new Date(session.startedAt.getTime() + TIME_ATTACK_SECONDS * 1000) : null;
}

// Used by history/leaderboard as well, so abandoned timed rounds still finish at
// their actual deadline, even when the browser is closed or crosses a week boundary.
async function finishExpired() {
  await prisma.$executeRaw`UPDATE game_sessions SET status = 'completed',
    completed_at = started_at + interval '120 seconds', duration = 120, updated_at = NOW()
    WHERE game_type = 'time-attack' AND status = 'active'
      AND started_at + interval '120 seconds' <= NOW()`;
}

async function finish(db, session, status, at = new Date()) {
  return db.gameSession.update({ where: { id: session.id }, data: {
    status, completedAt: at, duration: Math.max(0, Math.floor((at - session.startedAt) / 1000)),
  } });
}

async function payload(db, original) {
  let session = original;
  const deadline = expiresAt(session);
  if (session.status === 'active' && deadline && deadline <= new Date()) session = await finish(db, session, 'completed', deadline);
  let question = session.status === 'active' ? await nextQuestion(db, session) : null;
  if (session.status === 'active' && !question) session = await finish(db, session, 'completed');
  return { session: {
    id: session.id, gameType: session.gameType, subject: session.subject,
    currentScore: session.currentScore, goalScore: session.goalScore, status: session.status,
    questionsAnswered: session.questionsAnswered, correctAnswers: session.correctAnswers,
    startedAt: session.startedAt, completedAt: session.completedAt, expiresAt: deadline,
    question: question ? publicQuestion(question) : null,
  }, serverTime: new Date().toISOString() };
}

// Lock before reading state: simultaneous answers, quits, and deadline checks
// cannot score the same question twice or overwrite an already completed round.
async function withSession(req, action) {
  if (!UUID.test(req.params.id)) fail(400, 'Invalid session ID');
  return prisma.$transaction(async db => {
    const rows = await db.$queryRaw`SELECT id FROM game_sessions WHERE id = ${req.params.id}::uuid AND user_id = ${req.quizTaker.id}::uuid FOR UPDATE`;
    if (!rows.length) fail(404, 'Game session not found');
    const session = await db.gameSession.findUnique({ where: { id: req.params.id } });
    if (!GAME_IDS.includes(session.gameType)) fail(404, 'Game session not found');
    return action(db, session);
  });
}

router.get('/subjects', handle(async (_req, res) => {
  const subjects = await prisma.questionSet.findMany({
    where: { isActive: true, questions: { some: eligible } },
    select: { id: true, title: true, _count: { select: { questions: { where: eligible } } } }, orderBy: { title: 'asc' },
  });
  res.json({ subjects: subjects.map(s => ({ id: s.id, name: s.title, questionCount: s._count.questions })) });
}));

router.post('/start', handle(async (req, res) => {
  const { gameType, questionSetId } = req.body || {};
  if (!GAME_IDS.includes(gameType) || !UUID.test(questionSetId || '')) fail(400, 'Choose a valid game and subject');
  const subject = await prisma.questionSet.findFirst({ where: { id: questionSetId, isActive: true, questions: { some: eligible } } });
  if (!subject) fail(404, 'This subject has no available multiple-choice questions');
  await finishExpired();
  const result = await prisma.$transaction(async db => {
    // Serialize starts for a player, including requests from multiple browser tabs.
    await db.$queryRaw`SELECT id FROM quiz_takers WHERE id = ${req.quizTaker.id}::uuid FOR UPDATE`;
    let session = await db.gameSession.findFirst({ where: { userId: req.quizTaker.id, gameType, status: 'active' }, orderBy: { startedAt: 'desc' } });
    const resumed = !!session;
    if (!session) session = await db.gameSession.create({ data: {
      userId: req.quizTaker.id, gameType, questionSetId, subject: subject.title,
      currentScore: gameType === 'scholars-wager' ? 100 : 0, goalScore: 1000,
    } });
    return { session: { id: session.id }, resumed };
  });
  res.status(result.resumed ? 200 : 201).json(result);
}));

router.get('/sessions/:id', handle(async (req, res) => {
  res.json(await withSession(req, (db, session) => payload(db, session)));
}));

router.post('/sessions/:id/answer', handle(async (req, res) => {
  const result = await withSession(req, async (db, session) => {
    const deadline = expiresAt(session);
    if (session.status !== 'active' || (deadline && deadline <= new Date())) return payload(db, session);
    const question = await nextQuestion(db, session);
    if (!question) return payload(db, session);
    const { questionId, answer, wager } = req.body || {};
    if (questionId !== question.id) fail(409, 'This question has already been answered. Reload the round to continue.');
    if (typeof answer !== 'string' || answer.length > 500 || !publicQuestion(question).options.includes(answer)) fail(400, 'Choose one of the available answers');
    const correct = gradeQuestions([{ ...question, points: 1 }], [{ questionId, answer }]).score === 1;
    const scored = scoreAnswer(session, correct, wager);
    await db.gameUsedQuestion.create({ data: { gameSessionId: session.id, questionId } });
    await db.gameHistory.create({ data: { gameSessionId: session.id, questionId, question: question.question,
      selectedAnswer: answer, correctAnswer: question.correctAnswer, wager: session.gameType === 'scholars-wager' ? wager : 0,
      isCorrect: correct, pointsChange: scored.change } });
    const updated = await db.gameSession.update({ where: { id: session.id }, data: {
      currentScore: scored.currentScore, status: scored.status,
      questionsAnswered: { increment: 1 }, correctAnswers: { increment: correct ? 1 : 0 },
      ...(scored.status !== 'active' ? { completedAt: new Date(), duration: Math.floor((Date.now() - session.startedAt.getTime()) / 1000) } : {}),
    } });
    return { ...await payload(db, updated), feedback: { correct, pointsChange: scored.change } };
  });
  res.json(result);
}));

router.post('/sessions/:id/quit', handle(async (req, res) => {
  res.json(await withSession(req, async (db, session) => {
    const deadline = expiresAt(session);
    if (session.status === 'active') session = deadline && deadline <= new Date()
      ? await finish(db, session, 'completed', deadline) : await finish(db, session, 'quit');
    return payload(db, session);
  }));
}));

router.get('/history', handle(async (req, res) => {
  await finishExpired();
  const sessions = await prisma.gameSession.findMany({ where: { userId: req.quizTaker.id, gameType: { in: GAME_IDS } },
    orderBy: { startedAt: 'desc' }, take: 50,
    select: { id: true, gameType: true, subject: true, currentScore: true, status: true, startedAt: true, completedAt: true } });
  res.json({ sessions });
}));

router.get('/leaderboard', handle(async (req, res) => {
  const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'Limit must be between 1 and 100');
  await finishExpired();
  const now = new Date();
  const { start, end } = weeklyWindow(now);
  const sessions = await prisma.gameSession.findMany({
    where: { gameType: { in: GAME_IDS }, status: { in: ['won', 'lost', 'completed'] },
      completedAt: { gte: start, lt: end }, questionsAnswered: { gt: 0 }, user: { isActive: true } },
    select: { userId: true, gameType: true, currentScore: true, status: true, questionsAnswered: true, completedAt: true, user: { select: { name: true } } },
  });
  res.set('Cache-Control', 'no-store').json(buildLeaderboard(sessions, limit, now));
}));

module.exports = router;
