const express = require('express');
const prisma = require('../utils/database');
const { verifyAdmin, verifyQuizTaker } = require('../middleware/auth');
const { parseQuestionCsv, validateQuestion, publicQuestion, grade, fingerprint } = require('../utils/past-questions');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENGLISH = /^(?:use of english|english(?: language)?)$/;
const EXAM = 'JAMB';
const DURATION_SECONDS = 2 * 60 * 60; // Current four-subject CBT rule.
const fail = (status, message, errors) => { throw Object.assign(new Error(message), { status, errors }); };
const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    if (!error.status && error.code !== 'P2002') console.error('Past questions request failed:', error);
    res.status(error.status || (error.code === 'P2002' ? 409 : 500)).json({ success: false,
      message: error.status ? error.message : error.code === 'P2002' ? 'This paper was changed by another administrator. Refresh and retry.' : 'Unable to complete the request.',
      ...(error.errors && { errors: error.errors }) });
  }
};
const isEnglish = (title) => ENGLISH.test(title.trim().toLowerCase().replace(/\s+/g, ' '));
const yearValue = (value) => Number.isInteger(value) && value >= 1970 && value <= new Date().getUTCFullYear() ? value : null;
const paperSummary = (paper) => ({ id: paper.id, sourceExam: paper.sourceExam, year: paper.year, subjectId: paper.subjectId,
  subjectTitle: paper.subjectTitle, version: paper.version, isPublished: paper.isPublished,
  questionCount: paper.questionCount, durationSeconds: paper.durationSeconds,
  availableQuestions: paper._count?.questions, createdAt: paper.createdAt });
const result = (attempt) => {
  const questions = attempt.questionSnapshot;
  const marked = grade(questions, attempt.answers);
  return { id: attempt.id, year: attempt.year, papers: attempt.paperSnapshot,
    score: attempt.score, totalPoints: attempt.totalPoints,
    percentage: marked.percentage, timeTaken: Math.max(0, Math.floor((attempt.submittedAt - attempt.startedAt) / 1000)),
    submittedAt: attempt.submittedAt, review: marked.review };
};
const attemptView = (attempt) => ({ id: attempt.id, year: attempt.year, papers: attempt.paperSnapshot,
  startedAt: attempt.startedAt, expiresAt: new Date(attempt.startedAt.getTime() + attempt.durationSeconds * 1000),
  durationSeconds: attempt.durationSeconds, totalQuestions: attempt.totalPoints,
  answers: attempt.answers, questionsBySet: Object.fromEntries(attempt.paperSnapshot.map((paper) =>
    [paper.subjectId, attempt.questionSnapshot.filter((question) => question.paperId === paper.id).map(publicQuestion)])) });
const lockAttempt = async (db, id, owner) => {
  const rows = await db.$queryRaw`SELECT id FROM past_attempts WHERE id = ${id}::uuid AND quiz_taker_id = ${owner}::uuid FOR UPDATE`;
  if (!rows.length) fail(404, 'Practice attempt not found');
  return db.pastAttempt.findUnique({ where: { id } });
};
const expired = (attempt) => Date.now() >= attempt.startedAt.getTime() + attempt.durationSeconds * 1000;
const validAnswers = (value, questions) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length <= questions.length && Object.entries(value).every(([id, answer]) => {
    const question = questions.find((item) => item.id === id);
    return question && typeof answer === 'string' && (answer === '' || question.options.includes(answer));
  });
async function finish(db, attempt, answers) {
  const marked = grade(attempt.questionSnapshot, answers);
  return db.pastAttempt.update({ where: { id: attempt.id }, data: { answers, score: marked.score,
    submittedAt: new Date() } });
}

router.get('/availability', verifyQuizTaker, handle(async (req, res) => {
  const [subjects, papers] = await Promise.all([
    prisma.questionSet.findMany({ where: { isActive: true }, select: { id: true, title: true }, orderBy: { title: 'asc' } }),
    prisma.pastPaper.findMany({ where: { sourceExam: EXAM, isPublished: true, questionCount: { gt: 0 }, questions: { some: {} } },
      select: { id: true, year: true, subjectId: true, subjectTitle: true, questionCount: true, durationSeconds: true }, orderBy: { year: 'desc' } }),
  ]);
  const active = new Set(subjects.map((item) => item.id));
  res.json({ success: true, accountType: req.quizTaker.accountType,
    subjects: subjects.map((item) => ({ _id: item.id, title: item.title })),
    years: [...new Set(papers.filter((item) => active.has(item.subjectId)).map((item) => item.year))],
    papers: papers.filter((item) => active.has(item.subjectId)).map((item) => ({ ...item,
      questionCount: req.quizTaker.accountType === 'premium' ? item.questionCount : Math.min(10, item.questionCount) })) });
}));

router.get('/attempts/active', verifyQuizTaker, handle(async (req, res) => {
  const attempts = await prisma.pastAttempt.findMany({ where: { quizTakerId: req.quizTaker.id, submittedAt: null },
    select: { id: true, year: true, startedAt: true, durationSeconds: true }, orderBy: { startedAt: 'desc' }, take: 10 });
  res.json({ success: true, attempts: attempts.map((item) => ({ ...item,
    expiresAt: new Date(item.startedAt.getTime() + item.durationSeconds * 1000) })) });
}));

router.post('/attempts', verifyQuizTaker, handle(async (req, res) => {
  const year = yearValue(req.body?.year);
  const ids = req.body?.subjectIds;
  if (!year || !Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4 || !ids.every((id) => typeof id === 'string' && UUID.test(id)))
    fail(400, 'Select a year and exactly four different subjects');
  const subjects = await prisma.questionSet.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, title: true } });
  if (subjects.length !== 4 || subjects.filter((item) => isEnglish(item.title)).length !== 1)
    fail(400, 'Select Use of English and exactly three other active subjects');
  const papers = await prisma.pastPaper.findMany({ where: { sourceExam: EXAM, year, subjectId: { in: ids }, isPublished: true },
    include: { questions: { orderBy: { orderNum: 'asc' } } } });
  if (papers.length !== 4 || papers.some((paper) => !paper.questions.length || paper.questionCount > paper.questions.length))
    fail(409, 'One or more selected subjects do not have a usable published paper for this year');
  if (new Set(papers.map((paper) => paper.durationSeconds)).size !== 1) fail(409, 'These papers have different time limits');
  const ordered = ids.map((id) => papers.find((paper) => paper.subjectId === id));
  const snapshots = ordered.flatMap((paper) => {
    const count = req.quizTaker.accountType === 'premium' ? paper.questionCount : Math.min(10, paper.questionCount);
    return paper.questions.slice(0, count).map((question) => ({ id: question.id, paperId: paper.id,
      subjectId: paper.subjectId, orderNum: question.orderNum, question: question.question,
      passage: question.passage, options: question.options, correctAnswer: question.correctAnswer,
      explanation: question.explanation, mediaUrl: question.mediaUrl, mediaAlt: question.mediaAlt }));
  });
  const attempt = await prisma.pastAttempt.create({ data: { quizTakerId: req.quizTaker.id, year,
    paperSnapshot: ordered.map((paper) => ({ id: paper.id, sourceExam: paper.sourceExam, version: paper.version, year: paper.year,
      subjectId: paper.subjectId, subjectTitle: paper.subjectTitle, durationSeconds: paper.durationSeconds,
      questionCount: req.quizTaker.accountType === 'premium' ? paper.questionCount : Math.min(10, paper.questionCount) })),
    questionSnapshot: snapshots, totalPoints: snapshots.length, durationSeconds: ordered[0].durationSeconds } });
  res.status(201).json({ success: true, attempt: attemptView(attempt) });
}));

router.get('/attempts/:id', verifyQuizTaker, handle(async (req, res) => {
  if (!UUID.test(req.params.id)) fail(400, 'Invalid attempt ID');
  let attempt = await prisma.pastAttempt.findFirst({ where: { id: req.params.id, quizTakerId: req.quizTaker.id } });
  if (!attempt) fail(404, 'Practice attempt not found');
  if (!attempt.submittedAt && expired(attempt)) attempt = await prisma.$transaction(async (db) => {
    const locked = await lockAttempt(db, attempt.id, req.quizTaker.id);
    return locked.submittedAt ? locked : finish(db, locked, locked.answers);
  });
  res.json(attempt.submittedAt ? { success: true, result: result(attempt) } : { success: true, attempt: attemptView(attempt) });
}));

router.patch('/attempts/:id/answers', verifyQuizTaker, handle(async (req, res) => {
  if (!UUID.test(req.params.id)) fail(400, 'Invalid attempt ID');
  const outcome = await prisma.$transaction(async (db) => {
    const attempt = await lockAttempt(db, req.params.id, req.quizTaker.id);
    if (attempt.submittedAt) fail(409, 'Attempt already submitted');
    if (expired(attempt)) return { expired: true, attempt: await finish(db, attempt, attempt.answers) };
    const answers = req.body?.answers;
    if (!validAnswers(answers, attempt.questionSnapshot)) fail(400, 'Answers contain unknown questions or invalid options');
    return { expired: false, attempt: await db.pastAttempt.update({ where: { id: attempt.id }, data: { answers: { ...attempt.answers, ...answers } } }) };
  });
  if (outcome.expired) fail(409, 'Time expired; your saved answers were submitted');
  res.json({ success: true, answers: outcome.attempt.answers });
}));

router.post('/attempts/:id/submit', verifyQuizTaker, handle(async (req, res) => {
  if (!UUID.test(req.params.id)) fail(400, 'Invalid attempt ID');
  const attempt = await prisma.$transaction(async (db) => {
    const locked = await lockAttempt(db, req.params.id, req.quizTaker.id);
    if (locked.submittedAt) return locked;
    const incoming = req.body?.answers;
    if (!expired(locked) && incoming !== undefined && !validAnswers(incoming, locked.questionSnapshot))
      fail(400, 'Answers contain unknown questions or invalid options');
    return finish(db, locked, expired(locked) ? locked.answers : { ...locked.answers, ...(incoming || {}) });
  });
  res.json({ success: true, result: result(attempt) });
}));

router.get('/attempts/:id/result', verifyQuizTaker, handle(async (req, res) => {
  if (!UUID.test(req.params.id)) fail(400, 'Invalid attempt ID');
  const attempt = await prisma.pastAttempt.findFirst({ where: { id: req.params.id, quizTakerId: req.quizTaker.id } });
  if (!attempt) fail(404, 'Practice attempt not found');
  if (!attempt.submittedAt) fail(409, 'Attempt has not been submitted');
  res.json({ success: true, result: result(attempt) });
}));

// Admin paper management. Every import is a new unpublished version; previous
// versions and student snapshots are retained for review and audit.
router.use('/admin', verifyAdmin, (req, res, next) => req.admin?.role === 'admin'
  ? next() : res.status(403).json({ success: false, message: 'Administrator access required' }));

router.get('/admin/papers', handle(async (req, res) => {
  const papers = await prisma.pastPaper.findMany({ where: { sourceExam: EXAM }, include: { _count: { select: { questions: true } } },
    orderBy: [{ year: 'desc' }, { subjectTitle: 'asc' }, { version: 'desc' }] });
  res.json({ success: true, papers: papers.map(paperSummary) });
}));

router.get('/admin/papers/:id', handle(async (req, res) => {
  if (!UUID.test(req.params.id)) fail(400, 'Invalid paper ID');
  const paper = await prisma.pastPaper.findUnique({ where: { id: req.params.id }, include: { questions: { orderBy: { orderNum: 'asc' } }, _count: { select: { questions: true } } } });
  if (!paper) fail(404, 'Paper not found');
  res.json({ success: true, paper: { ...paperSummary(paper), questions: paper.questions } });
}));

function uploadCsv(req, res, next) {
  req.app.get('upload').single('file')(req, res, (error) => error ? res.status(400).json({ success: false, message: error.message }) : next());
}
function parseUpload(req) {
  if (!req.file || !/\.csv$/i.test(req.file.originalname)) fail(400, 'Upload a .csv question file');
  const parsed = parseQuestionCsv(req.file.buffer);
  return parsed;
}
async function uploadTarget(req) {
  const year = yearValue(Number(req.body?.year));
  const subjectId = req.body?.subjectId;
  if (!year || typeof subjectId !== 'string' || !UUID.test(subjectId)) fail(400, 'Select a valid year and subject');
  const subject = await prisma.questionSet.findFirst({ where: { id: subjectId, isActive: true }, select: { id: true, title: true } });
  if (!subject) fail(400, 'Select an active subject from the question bank');
  return { year, subjectId, subject };
}
router.post('/admin/preview', uploadCsv, handle(async (req, res) => {
  await uploadTarget(req);
  const parsed = parseUpload(req);
  res.json({ success: true, valid: !parsed.errors.length, rowCount: parsed.questions.length,
    errors: parsed.errors, preview: parsed.questions.slice(0, 5) });
}));

router.post('/admin/papers/import', uploadCsv, handle(async (req, res) => {
  const { year, subjectId, subject } = await uploadTarget(req);
  const parsed = parseUpload(req);
  if (parsed.errors.length) fail(400, 'Correct every row before importing', parsed.errors);
  const created = await prisma.$transaction(async (db) => {
    const previous = await db.pastPaper.aggregate({ where: { sourceExam: EXAM, year, subjectId }, _max: { version: true } });
    const paper = await db.pastPaper.create({ data: { sourceExam: EXAM, year, subjectId,
      subjectTitle: subject.title, version: (previous._max.version || 0) + 1, createdById: req.admin.id,
      questionCount: Math.min(parsed.questions.length, isEnglish(subject.title) ? 60 : 40), durationSeconds: DURATION_SECONDS } });
    await db.pastQuestion.createMany({ data: parsed.questions.map((item, index) => ({ ...item,
      paperId: paper.id, orderNum: index + 1 })) });
    return paper;
  });
  res.status(201).json({ success: true, paper: paperSummary(created), message: 'Draft imported. Review and publish it when ready.' });
}));

router.patch('/admin/papers/:id/questions/:questionId', handle(async (req, res) => {
  if (!UUID.test(req.params.id) || !UUID.test(req.params.questionId)) fail(400, 'Invalid paper or question ID');
  const paper = await prisma.pastPaper.findUnique({ where: { id: req.params.id } });
  if (!paper) fail(404, 'Paper not found');
  if (paper.isPublished) fail(409, 'Unpublish this paper before editing questions');
  const current = await prisma.pastQuestion.findFirst({ where: { id: req.params.questionId, paperId: paper.id } });
  if (!current) fail(404, 'Question not found');
  const input = req.body || {};
  const candidate = { question: input.question ?? current.question, passage: input.passage ?? current.passage,
    explanation: input.explanation ?? current.explanation, options: input.options ?? current.options,
    correctAnswer: input.correctAnswer ?? current.correctAnswer,
    mediaUrl: input.mediaUrl ?? current.mediaUrl, mediaAlt: input.mediaAlt ?? current.mediaAlt };
  const checked = validateQuestion(candidate, current.sourceRow);
  if (checked.errors.length) fail(400, 'Invalid question', checked.errors);
  const others = await prisma.pastQuestion.findMany({ where: { paperId: paper.id, id: { not: current.id } }, select: { question: true, passage: true, options: true } });
  if (others.some((item) => fingerprint(item) === fingerprint(checked.question)))
    fail(409, 'This question duplicates another row in the paper');
  const question = await prisma.pastQuestion.update({ where: { id: current.id }, data: {
    question: checked.question.question, passage: checked.question.passage, options: checked.question.options,
    correctAnswer: checked.question.correctAnswer, explanation: checked.question.explanation,
    mediaUrl: checked.question.mediaUrl, mediaAlt: checked.question.mediaAlt } });
  res.json({ success: true, question });
}));

router.patch('/admin/papers/:id/publication', handle(async (req, res) => {
  if (!UUID.test(req.params.id) || typeof req.body?.isPublished !== 'boolean') fail(400, 'Invalid publication request');
  const paper = await prisma.$transaction(async (db) => {
    const current = await db.pastPaper.findUnique({ where: { id: req.params.id }, include: { questions: true } });
    if (!current) fail(404, 'Paper not found');
    if (req.body.isPublished) {
      if (!current.questions.length || current.questionCount > current.questions.length) fail(400, 'Paper does not have enough usable questions');
      const seen = new Set();
      for (const item of current.questions) {
        const check = validateQuestion(item, item.sourceRow);
        if (check.errors.length) fail(400, 'Correct invalid questions before publishing', check.errors);
        const k = fingerprint(item);
        if (seen.has(k)) fail(400, `Duplicate question at row ${item.sourceRow}`);
        seen.add(k);
      }
      await db.pastPaper.updateMany({ where: { sourceExam: EXAM, year: current.year,
        subjectId: current.subjectId, isPublished: true, id: { not: current.id } }, data: { isPublished: false } });
    }
    return db.pastPaper.update({ where: { id: current.id }, data: { isPublished: req.body.isPublished } });
  });
  res.json({ success: true, paper: paperSummary(paper) });
}));

module.exports = router;
