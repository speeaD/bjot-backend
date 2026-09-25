const express = require('express');
const { verifyAdmin } = require('../middleware/auth');
const prisma = require('../utils/database');
const router = express.Router();
const departments = ['Sciences', 'Arts', 'Commercial'];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const include = { weeklyClasses: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] }, overrides: true };

function serialize(schedule) {
  if (!schedule) return null;
  const classSession = (item) => ({ ...item, _id: item.id, questionSet: item.questionSetId });
  return {
    _id: schedule.id, department: schedule.department, createdBy: schedule.createdById,
    isActive: schedule.isActive, createdAt: schedule.createdAt, updatedAt: schedule.updatedAt,
    weeklySchedule: schedule.weeklyClasses.map(classSession),
    overrides: schedule.overrides.map((item) => ({
      _id: item.id, date: item.date, reason: item.reason,
      classSession: classSession({ ...item, dayOfWeek: new Date(item.date).getUTCDay(), dayName: days[new Date(item.date).getUTCDay()] }),
    })),
  };
}

router.use(verifyAdmin);
router.get('/', async (_req, res) => {
  try {
    const schedules = await prisma.schedule.findMany({ include, orderBy: { department: 'asc' } });
    res.json({ success: true, data: schedules.map(serialize) });
  } catch (error) {
    console.error('Get schedules error:', error);
    res.status(500).json({ success: false, message: 'Unable to load schedules' });
  }
});

router.get('/:department', async (req, res) => {
  if (!departments.includes(req.params.department)) return res.status(400).json({ message: 'Invalid department' });
  try {
    const schedule = await prisma.schedule.findUnique({ where: { department: req.params.department }, include });
    res.json({ success: true, data: serialize(schedule) });
  } catch (error) {
    console.error('Get department schedule error:', error);
    res.status(500).json({ success: false, message: 'Unable to load department schedule' });
  }
});

router.post('/', async (req, res) => {
  const { department, weeklySchedule } = req.body || {};
  if (!departments.includes(department) || !Array.isArray(weeklySchedule) || weeklySchedule.length > 100) {
    return res.status(400).json({ message: 'Provide a valid department and up to 100 weekly classes' });
  }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (weeklySchedule.some((item) => !item || !Number.isInteger(item.dayOfWeek) || item.dayOfWeek < 0 || item.dayOfWeek > 6 ||
    typeof item.questionSet !== 'string' || !uuid.test(item.questionSet) ||
    typeof item.startTime !== 'string' || typeof item.endTime !== 'string' ||
    !time.test(item.startTime) || !time.test(item.endTime) || item.endTime <= item.startTime ||
    (item.isActive !== undefined && typeof item.isActive !== 'boolean'))) {
    return res.status(400).json({ message: 'Each class needs a valid day, subject, and start/end time (end after start)' });
  }
  try {
    const subjects = await prisma.questionSet.findMany({ where: { id: { in: [...new Set(weeklySchedule.map((item) => item.questionSet))] } }, select: { id: true, title: true } });
    const titles = new Map(subjects.map((subject) => [subject.id, subject.title]));
    if (weeklySchedule.some((item) => !titles.has(item.questionSet))) return res.status(400).json({ message: 'One or more subjects no longer exist' });
    const classes = weeklySchedule.map((item) => ({
      dayOfWeek: item.dayOfWeek, dayName: days[item.dayOfWeek], questionSetId: item.questionSet,
      questionSetTitle: titles.get(item.questionSet), startTime: item.startTime, endTime: item.endTime,
      isActive: item.isActive ?? true,
    }));
    // The nested replacement is atomic; existing overrides and the creator are preserved.
    const schedule = await prisma.schedule.upsert({
      where: { department },
      create: { department, createdById: req.admin.id, weeklyClasses: { create: classes } },
      update: { weeklyClasses: { deleteMany: {}, create: classes } },
      include,
    });
    res.json({ success: true, data: serialize(schedule) });
  } catch (error) {
    console.error('Save schedule error:', error);
    res.status(500).json({ success: false, message: 'Unable to save schedule' });
  }
});

module.exports = router;
