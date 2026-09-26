const express = require('express');
const { randomInt } = require('node:crypto');
const prisma = require('../utils/database');
const { verifyAdmin, verifyQuizTaker } = require('../middleware/auth');
const { AUTO_GRADED_TYPES, publicQuestion, gradeQuestions, validateAnswers } = require('../utils/public-exam');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types = new Set(['text', 'passage', 'image', 'youtube']);
const eligibleQuestions = { isArchived: false, type: { in: [...AUTO_GRADED_TYPES] } };
const failure = (res, error) => { console.error('Study hub error:', error); return res.status(500).json({ success: false, message: 'Unable to complete study hub request' }); };

function mediaUrl(value, type) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (type === 'image') return url.href;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    }
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch { return null; }
}

function materialInput(body) {
  const type = typeof body?.type === 'string' ? body.type.trim() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const raw = typeof body?.content === 'string' ? body.content.trim() : '';
  const altText = typeof body?.altText === 'string' ? body.altText.trim() : '';
  const content = ['image', 'youtube'].includes(type) ? mediaUrl(raw, type) : raw;
  const displayOrder = body?.displayOrder === undefined ? 0 : Number(body.displayOrder);
  if (!types.has(type) || !title || title.length > 255 || !content || raw.length > 50000 || altText.length > 500 ||
    (type === 'image' && !altText) || !Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 100000 ||
    (body?.isPublished !== undefined && typeof body.isPublished !== 'boolean')) return null;
  return { type, title, content, altText, displayOrder, isPublished: body.isPublished ?? false };
}

async function studentTopic(id, studentId) {
  return prisma.topic.findFirst({ where: { id, isActive: true, questionSet: {
    isActive: true, quizTakerQuestionSets: { some: { quizTakerId: studentId } },
  } }, include: { questionSet: { select: { id: true, title: true } } } });
}

function premium(req, res, next) {
  if (req.quizTaker.accountType !== 'premium') return res.status(403).json({ success: false, message: 'Study Hub is available to premium students' });
  next();
}

router.get('/admin/topics/:topicId/materials', verifyAdmin, async (req, res) => {
  try {
    if (!UUID.test(req.params.topicId)) return res.status(400).json({ success: false, message: 'Invalid topic ID' });
    const topic = await prisma.topic.findUnique({ where: { id: req.params.topicId } });
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });
    const materials = await prisma.studyMaterial.findMany({ where: { topicId: topic.id }, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] });
    res.json({ success: true, materials });
  } catch (error) { failure(res, error); }
});

router.post('/admin/topics/:topicId/materials', verifyAdmin, async (req, res) => {
  try {
    if (!UUID.test(req.params.topicId)) return res.status(400).json({ success: false, message: 'Invalid topic ID' });
    const input = materialInput(req.body);
    if (!input) return res.status(400).json({ success: false, message: 'Enter a title and valid text, passage, image URL with alt text, or YouTube URL' });
    const topic = await prisma.topic.findUnique({ where: { id: req.params.topicId } });
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });
    const material = await prisma.studyMaterial.create({ data: { ...input, topicId: topic.id } });
    res.status(201).json({ success: true, material });
  } catch (error) { failure(res, error); }
});

router.put('/admin/materials/:id', verifyAdmin, async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid material ID' });
    const current = await prisma.studyMaterial.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ success: false, message: 'Material not found' });
    const input = materialInput({ ...current, ...req.body });
    if (!input) return res.status(400).json({ success: false, message: 'Enter valid material details' });
    const material = await prisma.studyMaterial.update({ where: { id: current.id }, data: input });
    res.json({ success: true, material });
  } catch (error) { failure(res, error); }
});

router.delete('/admin/materials/:id', verifyAdmin, async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid material ID' });
    const deleted = await prisma.studyMaterial.deleteMany({ where: { id: req.params.id } });
    if (!deleted.count) return res.status(404).json({ success: false, message: 'Material not found' });
    res.json({ success: true });
  } catch (error) { failure(res, error); }
});

router.use(verifyQuizTaker, premium);

router.get('/subjects', async (req, res) => {
  try {
    const subjects = await prisma.questionSet.findMany({ where: { isActive: true, quizTakerQuestionSets: { some: { quizTakerId: req.quizTaker.id } } },
      select: { id: true, title: true, topics: { where: { isActive: true }, orderBy: { name: 'asc' },
        select: { id: true, name: true, _count: { select: { studyMaterials: { where: { isPublished: true } }, questions: { where: eligibleQuestions } } } } } }, orderBy: { title: 'asc' } });
    res.json({ success: true, subjects });
  } catch (error) { failure(res, error); }
});

router.get('/topics/:id', async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid topic ID' });
    const topic = await studentTopic(req.params.id, req.quizTaker.id);
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });
    const [materials, questionCount, attempts] = await Promise.all([
      prisma.studyMaterial.findMany({ where: { topicId: topic.id, isPublished: true }, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] }),
      prisma.question.count({ where: { topicId: topic.id, ...eligibleQuestions } }),
      prisma.studyAttempt.findMany({ where: { topicId: topic.id, studentId: req.quizTaker.id, submittedAt: { not: null } }, orderBy: { startedAt: 'desc' }, take: 5,
        select: { id: true, score: true, totalPoints: true, startedAt: true, submittedAt: true } }),
    ]);
    res.json({ success: true, topic: { id: topic.id, name: topic.name, subject: topic.questionSet }, materials, questionCount, canTakeTest: questionCount >= 30 && materials.length > 0, attempts });
  } catch (error) { failure(res, error); }
});

router.post('/topics/:id/start', async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid topic ID' });
    const topic = await studentTopic(req.params.id, req.quizTaker.id);
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });
    const published = await prisma.studyMaterial.count({ where: { topicId: topic.id, isPublished: true } });
    if (!published) return res.status(409).json({ success: false, message: 'This topic needs published study materials before a test can start' });
    const questions = await prisma.question.findMany({ where: { topicId: topic.id, ...eligibleQuestions },
      select: { id: true, type: true, question: true, passage: true, diagram: true, diagramAlt: true, options: true, correctAnswer: true, points: true, orderNum: true } });
    if (questions.length < 30) return res.status(409).json({ success: false, message: 'This topic needs at least 30 eligible questions before a test can start' });
    const count = Math.min(40, questions.length);
    for (let i = 0; i < count; i++) {
      const j = i + randomInt(questions.length - i);
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
    const selected = questions.slice(0, count);
    const attempt = await prisma.studyAttempt.create({ data: { topicId: topic.id, studentId: req.quizTaker.id,
      questionIds: selected.map((question) => question.id), questionSnapshot: selected } });
    res.status(201).json({ success: true, attempt: { id: attempt.id, questionCount: count } });
  } catch (error) { failure(res, error); }
});

router.get('/attempts/:id', async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid attempt ID' });
    const attempt = await prisma.studyAttempt.findFirst({ where: { id: req.params.id, studentId: req.quizTaker.id }, include: { topic: { select: { name: true, questionSet: { select: { title: true } } } } } });
    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
    if (attempt.submittedAt) return res.json({ success: true, attempt: { id: attempt.id, submittedAt: attempt.submittedAt, score: attempt.score, totalPoints: attempt.totalPoints, percentage: attempt.totalPoints ? Math.round(attempt.score / attempt.totalPoints * 10000) / 100 : 0 } });
    res.json({ success: true, attempt: { id: attempt.id, topic: attempt.topic.name, subject: attempt.topic.questionSet.title,
      startedAt: attempt.startedAt, questions: attempt.questionSnapshot.map(publicQuestion) } });
  } catch (error) { failure(res, error); }
});

router.post('/attempts/:id/submit', async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid attempt ID' });
    const attempt = await prisma.studyAttempt.findFirst({ where: { id: req.params.id, studentId: req.quizTaker.id } });
    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
    if (attempt.submittedAt) return res.status(409).json({ success: false, message: 'This attempt has already been submitted' });
    if (!validateAnswers(req.body?.answers, new Set(attempt.questionIds))) return res.status(400).json({ success: false, message: 'Answers contain invalid question IDs or values' });
    const result = gradeQuestions(attempt.questionSnapshot, req.body.answers);
    const saved = await prisma.studyAttempt.updateMany({ where: { id: attempt.id, studentId: req.quizTaker.id, submittedAt: null },
      data: { answers: req.body.answers, score: result.score, totalPoints: result.totalPoints, submittedAt: new Date() } });
    if (!saved.count) return res.status(409).json({ success: false, message: 'This attempt has already been submitted' });
    res.json({ success: true, result });
  } catch (error) { failure(res, error); }
});

module.exports = router;
