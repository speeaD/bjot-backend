const express = require('express');
const XLSX = require('xlsx');
const Papa = require('papaparse');
const router = express.Router();
const { verifyAdmin } = require('../middleware/auth');
const prisma = require('../utils/database');

const TYPES = new Set(['multiple-choice', 'essay', 'true-false', 'fill-in-the-blanks']);
const INCLUDE = {
  createdBy: { select: { id: true, email: true } },
  batches: { include: { questions: { orderBy: { orderNum: 'asc' } } }, orderBy: { batchNumber: 'asc' } },
  questions: { orderBy: { orderNum: 'asc' } },
};

const parseQuestion = (source, index) => {
  const row = Object.fromEntries(Object.entries(source).map(([key, value]) => [key.trim().toLowerCase(), value]));
  const type = String(row.type || '').trim().toLowerCase();
  const question = String(row.question || '').trim();
  if (!TYPES.has(type) || !question) return null;
  const answer = row.correctanswer ?? row['correct answer'];
  const result = { type, question, passage: String(row.passage || '').trim(), diagram: row.diagram ? String(row.diagram).trim() : null, diagramAlt: String(row.diagramalt ?? row['diagram alt'] ?? '').trim(), points: Number.parseInt(row.points, 10) || 1, orderNum: index + 1 };
  if (type === 'multiple-choice') {
    const options = String(row.options || '').split('|').map((item) => item.trim()).filter(Boolean);
    if (!options.length || answer === undefined || String(answer).trim() === '') return null;
    result.options = options; result.correctAnswer = String(answer).trim();
  } else if (type === 'true-false') {
    const value = String(answer || '').trim().toLowerCase();
    if (['true', 't', '1'].includes(value)) result.correctAnswer = true;
    else if (['false', 'f', '0'].includes(value)) result.correctAnswer = false;
    else return null;
  } else result.correctAnswer = String(answer || '').trim();
  return result;
};

function parseUpload(file) {
  let rows;
  if (file.mimetype === 'text/csv') {
    const parsed = Papa.parse(file.buffer.toString('utf8'), { header: true, skipEmptyLines: true });
    if (parsed.errors.length) throw new Error('Error parsing CSV file');
    rows = parsed.data;
  } else {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  }
  return rows.map(parseQuestion).filter(Boolean);
}

function normalizeQuestions(questions, start, attrs = {}) {
  return questions.map((input, index) => ({
    type: input.type, question: input.question, passage: input.passage || '', diagram: input.diagram || null,
    diagramAlt: input.diagramAlt || '', options: input.options || null, correctAnswer: input.correctAnswer ?? null,
    points: Number(input.points) || 1, orderNum: start + index + 1, tags: input.tags || [], ...attrs,
  }));
}

async function refreshTotals(tx, questionSetId) {
  const questions = await tx.question.findMany({ where: { questionSetId, isArchived: false }, select: { points: true, batchId: true } });
  await tx.questionSet.update({ where: { id: questionSetId }, data: { questionCount: questions.length, totalPoints: questions.reduce((sum, item) => sum + item.points, 0) } });
  const batches = await tx.batch.findMany({ where: { questionSetId }, select: { id: true } });
  await Promise.all(batches.map(({ id }) => {
    const items = questions.filter((item) => item.batchId === id);
    return tx.batch.update({ where: { id }, data: { questionCount: items.length, totalPoints: items.reduce((sum, item) => sum + item.points, 0) } });
  }));
}

const getSet = (id, include = INCLUDE) => prisma.questionSet.findUnique({ where: { id }, include });

// Production-compatible creation route. It accepts the existing CSV/XLSX upload format.
router.post('/bulk-upload', verifyAdmin, async (req, res) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, async (uploadError) => {
    if (uploadError) return res.status(400).json({ success: false, message: uploadError.message });
    if (!req.file) return res.status(400).json({ success: false, message: 'Please upload a CSV or Excel file' });
    try {
      const title = req.body.title?.trim();
      const questions = parseUpload(req.file);
      if (!title) return res.status(400).json({ success: false, message: 'Question set title is required' });
      if (!questions.length) return res.status(400).json({ success: false, message: 'No valid questions found in file' });
      const usesBatches = req.body.usesBatches === 'true';
      const batchNumber = Number.parseInt(req.body.batchNumber, 10) || 1;
      const questionSet = await prisma.$transaction(async (tx) => {
        const created = await tx.questionSet.create({ data: { title, createdById: req.admin.id, usesBatches } });
        const batch = usesBatches ? await tx.batch.create({ data: { questionSetId: created.id, batchNumber, name: req.body.batchName?.trim() || `Batch ${batchNumber}` } }) : null;
        await tx.question.createMany({ data: normalizeQuestions(questions, 0, { questionSetId: created.id, batchId: batch?.id || null, batchNumber: batch?.batchNumber || null }) });
        await refreshTotals(tx, created.id);
        return tx.questionSet.findUnique({ where: { id: created.id }, include: INCLUDE });
      });
      res.status(201).json({ success: true, message: `Question set created successfully with ${questions.length} questions`, questionSet });
    } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
  });
});

// Add a batch from either multipart file input or the production JSON-string body input.
router.post('/:id/batches', verifyAdmin, async (req, res) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, async (uploadError) => {
    if (uploadError) return res.status(400).json({ success: false, message: uploadError.message });
    try {
      const batchNumber = Number.parseInt(req.body.batchNumber, 10);
      const name = req.body.name?.trim();
      let questions = req.file ? parseUpload(req.file) : (req.body.questions ? JSON.parse(req.body.questions) : []);
      if (!Number.isInteger(batchNumber) || batchNumber < 1) return res.status(400).json({ success: false, message: 'Valid batchNumber (positive integer) is required' });
      if (!name) return res.status(400).json({ success: false, message: 'Batch name is required' });
      if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ success: false, message: 'Either a file upload or a questions array in the body is required' });
      const questionSet = await prisma.$transaction(async (tx) => {
        const set = await tx.questionSet.findUnique({ where: { id: req.params.id }, include: { questions: true } });
        if (!set) return null;
        const batch = await tx.batch.create({ data: { questionSetId: set.id, batchNumber, name } });
        const last = set.questions.reduce((max, item) => Math.max(max, item.orderNum), 0);
        await tx.question.createMany({ data: normalizeQuestions(questions, last, { questionSetId: set.id, batchId: batch.id, batchNumber }) });
        await tx.questionSet.update({ where: { id: set.id }, data: { usesBatches: true } });
        await refreshTotals(tx, set.id);
        return tx.questionSet.findUnique({ where: { id: set.id }, include: INCLUDE });
      });
      if (!questionSet) return res.status(404).json({ success: false, message: 'Question set not found' });
      res.status(201).json({ success: true, message: `Batch added successfully with ${questions.length} questions`, questionSet });
    } catch (error) { res.status(500).json({ success: false, message: 'Server error while adding batch', error: error.message }); }
  });
});

router.put('/:id/batches/:batchId', verifyAdmin, async (req, res) => {
  try {
    const batch = await prisma.batch.findFirst({ where: { id: req.params.batchId, questionSetId: req.params.id } });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    await prisma.batch.update({ where: { id: batch.id }, data: { ...(req.body.name !== undefined && { name: req.body.name }), ...(req.body.isActive !== undefined && { isActive: req.body.isActive }) } });
    res.json({ success: true, message: 'Batch updated successfully', questionSet: await getSet(req.params.id) });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.delete('/:id/batches/:batchId', verifyAdmin, async (req, res) => {
  try {
    const batch = await prisma.batch.findFirst({ where: { id: req.params.batchId, questionSetId: req.params.id } });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    const inUse = await prisma.quizQuestionSet.count({ where: { questionSetId: req.params.id, batchId: batch.id } });
    if (inUse) return res.status(400).json({ success: false, message: `Cannot delete batch. It is being used in ${inUse} quiz(zes).` });
    await prisma.$transaction(async (tx) => { await tx.batch.delete({ where: { id: batch.id } }); await refreshTotals(tx, req.params.id); });
    res.json({ success: true, message: 'Batch deleted successfully' });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.patch('/:id/batches/:batchId/toggle-active', verifyAdmin, async (req, res) => {
  try {
    const batch = await prisma.batch.findFirst({ where: { id: req.params.batchId, questionSetId: req.params.id } });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    const updated = await prisma.batch.update({ where: { id: batch.id }, data: { isActive: !batch.isActive } });
    res.json({ success: true, message: `Batch ${updated.isActive ? 'activated' : 'deactivated'} successfully`, batch: updated });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.post('/:id/convert-to-batches', verifyAdmin, async (req, res) => {
  try {
    const set = await getSet(req.params.id);
    if (!set) return res.status(404).json({ success: false, message: 'Question set not found' });
    if (set.usesBatches) return res.status(400).json({ success: false, message: 'Question set already uses batches' });
    const questionSet = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.create({ data: { questionSetId: set.id, batchNumber: 1, name: 'Batch 1 (Legacy Questions)' } });
      await tx.question.updateMany({ where: { questionSetId: set.id }, data: { batchId: batch.id, batchNumber: 1 } });
      await tx.questionSet.update({ where: { id: set.id }, data: { usesBatches: true } });
      await refreshTotals(tx, set.id);
      return tx.questionSet.findUnique({ where: { id: set.id }, include: INCLUDE });
    });
    res.json({ success: true, message: 'Question set converted to batches successfully', questionSet });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.get('/', async (req, res) => {
  try {
    const where = { ...(req.query.isActive !== undefined && { isActive: req.query.isActive === 'true' }), ...(req.query.search && { title: { contains: req.query.search, mode: 'insensitive' } }) };
    const questionSets = await prisma.questionSet.findMany({ where, include: { createdBy: { select: { id: true, email: true } }, _count: { select: { questions: true } } }, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, count: questionSets.length, questionSets });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.get('/template/download', verifyAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename=questionset-template.csv');
  res.send('type,question,options,correctanswer,points\nmultiple-choice,What is 2+2?,1|2|3|4,4,1\ntrue-false,JavaScript is a programming language,,true,1\nessay,Explain the concept of closures in JavaScript,,,5\nfill-in-the-blanks,The capital of France is ____,,Paris,1');
});

router.get('/:id', verifyAdmin, async (req, res) => {
  try { const questionSet = await getSet(req.params.id); if (!questionSet) return res.status(404).json({ success: false, message: 'Question set not found' }); res.json({ success: true, questionSet }); }
  catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.put('/:id', verifyAdmin, async (req, res) => {
  try {
    const set = await prisma.questionSet.findUnique({ where: { id: req.params.id } }); if (!set) return res.status(404).json({ success: false, message: 'Question set not found' });
    const questionSet = await prisma.questionSet.update({ where: { id: set.id }, data: { ...(req.body.title !== undefined && { title: req.body.title }), ...(req.body.isActive !== undefined && { isActive: req.body.isActive }) }, include: INCLUDE });
    res.json({ success: true, message: 'Question set updated successfully', questionSet });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const set = await prisma.questionSet.findUnique({ where: { id: req.params.id } }); if (!set) return res.status(404).json({ success: false, message: 'Question set not found' });
    const inUse = await prisma.quizQuestionSet.count({ where: { questionSetId: set.id } });
    if (inUse) return res.status(400).json({ success: false, message: `Cannot delete question set. It is being used in ${inUse} quiz(zes). Please remove it from those quizzes first or deactivate it instead.` });
    await prisma.questionSet.delete({ where: { id: set.id } }); res.json({ success: true, message: 'Question set deleted successfully' });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.patch('/:id/toggle-active', verifyAdmin, async (req, res) => {
  try { const set = await prisma.questionSet.findUnique({ where: { id: req.params.id } }); if (!set) return res.status(404).json({ success: false, message: 'Question set not found' }); const questionSet = await prisma.questionSet.update({ where: { id: set.id }, data: { isActive: !set.isActive }, include: INCLUDE }); res.json({ success: true, message: `Question set ${questionSet.isActive ? 'activated' : 'deactivated'} successfully`, questionSet }); }
  catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.post('/:id/questions', verifyAdmin, async (req, res) => {
  try {
    if (!Array.isArray(req.body.questions) || !req.body.questions.length) return res.status(400).json({ success: false, message: 'Questions array is required' });
    const questionSet = await prisma.$transaction(async (tx) => {
      const set = await tx.questionSet.findUnique({ where: { id: req.params.id }, include: { questions: true } }); if (!set) return null;
      if (set.usesBatches) throw new Error('This question set uses batches; add questions to a batch instead');
      await tx.question.createMany({ data: normalizeQuestions(req.body.questions, set.questions.reduce((max, item) => Math.max(max, item.orderNum), 0), { questionSetId: set.id }) }); await refreshTotals(tx, set.id);
      return tx.questionSet.findUnique({ where: { id: set.id }, include: INCLUDE });
    });
    if (!questionSet) return res.status(404).json({ success: false, message: 'Question set not found' }); res.json({ success: true, message: 'Questions added successfully', questionSet });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.put('/:id/questions/:questionId', verifyAdmin, async (req, res) => {
  try {
    const original = await prisma.question.findFirst({ where: { id: req.params.questionId, questionSetId: req.params.id } }); if (!original) return res.status(404).json({ success: false, message: 'Question not found' });
    const allowed = ['type', 'question', 'passage', 'diagram', 'diagramAlt', 'options', 'correctAnswer', 'points', 'orderNum', 'tags', 'version', 'metadata'];
    const data = Object.fromEntries(allowed.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
    await prisma.$transaction(async (tx) => { await tx.question.update({ where: { id: original.id }, data }); await refreshTotals(tx, req.params.id); });
    res.json({ success: true, message: 'Question updated successfully', questionSet: await getSet(req.params.id) });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.delete('/:id/questions/:questionId', verifyAdmin, async (req, res) => {
  try {
    const question = await prisma.question.findFirst({ where: { id: req.params.questionId, questionSetId: req.params.id } }); if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    await prisma.$transaction(async (tx) => { await tx.question.delete({ where: { id: question.id } }); await refreshTotals(tx, req.params.id); });
    res.json({ success: true, message: 'Question deleted successfully', questionSet: await getSet(req.params.id) });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

// Metadata endpoints introduced on main during the PostgreSQL migration.
router.post('/:id/questions/batch', verifyAdmin, async (req, res) => {
  try {
    const questions = req.body.questions; if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ success: false, message: 'Questions array is required' });
    const set = await getSet(req.params.id); if (!set) return res.status(404).json({ success: false, message: 'Question set not found' });
    const metadata = req.body.metadata || {}; const max = await prisma.batch.aggregate({ where: { questionSetId: set.id }, _max: { batchNumber: true } }); const batchNumber = metadata.batchNumber || (max._max.batchNumber || 0) + 1;
    const questionSet = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.create({ data: { questionSetId: set.id, batchNumber, name: metadata.name || `Batch ${batchNumber}` } });
      await tx.question.createMany({ data: normalizeQuestions(questions, set.questions.reduce((largest, item) => Math.max(largest, item.orderNum), 0), { questionSetId: set.id, batchId: batch.id, batchNumber, version: metadata.version || `v${batchNumber}.0`, tags: metadata.tags || ['new'], metadata: metadata.additionalData || null }) });
      await tx.questionSet.update({ where: { id: set.id }, data: { usesBatches: true } }); await refreshTotals(tx, set.id); return tx.questionSet.findUnique({ where: { id: set.id }, include: INCLUDE });
    });
    res.status(201).json({ success: true, message: `Added ${questions.length} questions to batch ${batchNumber}`, batchNumber, questionSet });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.get('/:id/questions/filter', verifyAdmin, async (req, res) => {
  try {
    const where = { questionSetId: req.params.id };
    if (req.query.batch) where.batchNumber = Number.parseInt(req.query.batch, 10); if (req.query.version) where.version = req.query.version; if (req.query.archived !== undefined) where.isArchived = req.query.archived === 'true';
    if (req.query.dateFrom || req.query.dateTo) where.addedDate = { ...(req.query.dateFrom && { gte: new Date(req.query.dateFrom) }), ...(req.query.dateTo && { lte: new Date(req.query.dateTo) }) };
    if (req.query.tags) where.tags = { array_contains: req.query.tags.split(',').map((tag) => tag.trim()) };
    const questions = await prisma.question.findMany({ where, orderBy: { orderNum: 'asc' } }); res.json({ success: true, count: questions.length, filters: req.query, questions });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.patch('/:id/questions/:questionId/archive', verifyAdmin, async (req, res) => {
  try {
    const question = await prisma.question.findFirst({ where: { id: req.params.questionId, questionSetId: req.params.id } }); if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    const updated = await prisma.$transaction(async (tx) => { const result = await tx.question.update({ where: { id: question.id }, data: { isArchived: req.body.archive === true } }); await refreshTotals(tx, req.params.id); return result; });
    res.json({ success: true, message: `Question ${req.body.archive ? 'archived' : 'unarchived'} successfully`, question: updated });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

router.put('/:id/questions/:questionId/metadata', verifyAdmin, async (req, res) => {
  try {
    const question = await prisma.question.findFirst({ where: { id: req.params.questionId, questionSetId: req.params.id } }); if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    const { tags, batchNumber, version, metadata } = req.body; const updated = await prisma.question.update({ where: { id: question.id }, data: { ...(tags !== undefined && { tags }), ...(batchNumber !== undefined && { batchNumber }), ...(version !== undefined && { version }), ...(metadata !== undefined && { metadata }) } });
    res.json({ success: true, message: 'Question metadata updated successfully', question: updated });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error', error: error.message }); }
});

module.exports = router;
