const express = require('express');
const { verifyAdmin } = require('../middleware/auth');
const prisma = require('../utils/database');

const router = express.Router();
const departments = ['Sciences', 'Arts', 'Commercial'];

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function serializeSession(session) {
  return {
    _id: session.id,
    department: session.department,
    questionSet: session.questionSetId,
    questionSetTitle: session.questionSetTitle,
    date: session.date,
    scheduledStartTime: session.scheduledStartTime,
    scheduledEndTime: session.scheduledEndTime,
    attendanceWindow: {
      isOpen: session.windowIsOpen,
      openedAt: session.windowOpenedAt,
      closedAt: session.windowClosedAt,
      openedBy: session.windowOpenedById,
      closedBy: session.windowClosedById,
      durationMinutes: session.windowDurationMinutes,
      bufferMinutes: session.windowBufferMinutes,
    },
    windowHistory: (session.windowHistory || []).map((event) => ({
      action: event.action, timestamp: event.timestamp, admin: event.adminId,
    })),
    status: session.status,
    totalStudents: session.totalStudents,
    presentCount: session.presentCount,
    absentCount: session.absentCount,
    createdBy: session.createdById,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function sendError(res, error, message) {
  console.error(message, error);
  return res.status(500).json({ success: false, message });
}

router.use(verifyAdmin);

router.get('/analytics/department/:department', async (req, res) => {
  const { department } = req.params;
  const startDate = req.query.startDate ? parseDate(req.query.startDate) : null;
  const endDate = req.query.endDate ? parseDate(req.query.endDate) : null;
  if (!departments.includes(department) || (req.query.startDate && !startDate) || (req.query.endDate && !endDate) ||
    (startDate && endDate && startDate > endDate)) {
    return res.status(400).json({ success: false, message: 'Enter a valid department and date range' });
  }
  try {
    const [students, sessions] = await Promise.all([
      prisma.quizTaker.findMany({
        where: { department, isActive: true },
        select: { id: true, name: true, email: true, accountType: true, questionSets: { select: { questionSetId: true } } },
      }),
      prisma.attendanceSession.findMany({
        where: {
          department,
          ...((startDate || endDate) ? { date: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } } : {}),
        },
        select: { id: true, questionSetId: true, records: { select: { studentId: true, status: true, isLate: true } } },
      }),
    ]);
    const rows = students.map((student) => {
      const subjects = new Set(student.questionSets.map((item) => item.questionSetId));
      const eligible = sessions.filter((session) => subjects.has(session.questionSetId));
      const records = eligible.flatMap((session) => session.records.filter((record) => record.studentId === student.id));
      const present = records.filter((record) => record.status === 'present').length;
      const excused = records.filter((record) => record.status === 'excused').length;
      const totalClasses = eligible.length;
      return {
        studentId: student.id, name: student.name || student.email, email: student.email,
        accountType: student.accountType, totalClasses, present, excused,
        absent: Math.max(0, totalClasses - present - excused),
        late: records.filter((record) => record.isLate).length,
        attendanceRate: totalClasses ? Number(((present / totalClasses) * 100).toFixed(1)) : 0,
      };
    });
    const average = rows.length ? rows.reduce((sum, row) => sum + row.attendanceRate, 0) / rows.length : 0;
    return res.json({ success: true, data: {
      department,
      statistics: {
        totalStudents: rows.length,
        averageAttendanceRate: average.toFixed(1),
        atRiskStudents: rows.filter((row) => row.totalClasses && row.attendanceRate < 75).length,
        perfectAttendance: rows.filter((row) => row.totalClasses && row.attendanceRate === 100).length,
      },
      students: rows,
      dateRange: { startDate: startDate ? req.query.startDate : null, endDate: endDate ? req.query.endDate : null },
    } });
  } catch (error) {
    return sendError(res, error, 'Unable to load attendance analytics');
  }
});

router.get('/sessions', async (req, res) => {
  const date = parseDate(req.query.date);
  if (!date) return res.status(400).json({ success: false, message: 'Enter a valid date (YYYY-MM-DD)' });
  try {
    const sessions = await prisma.attendanceSession.findMany({
      where: { date }, orderBy: [{ department: 'asc' }, { scheduledStartTime: 'asc' }],
    });
    const data = Object.fromEntries(departments.map((department) => [department, []]));
    for (const session of sessions) {
      if (data[session.department]) data[session.department].push(serializeSession(session));
    }
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Unable to load attendance sessions');
  }
});

router.post('/sessions/create', async (req, res) => {
  const { department } = req.body || {};
  const date = parseDate(req.body?.date);
  if (!departments.includes(department) || !date) {
    return res.status(400).json({ success: false, message: 'Enter a valid department and date' });
  }

  try {
    const schedule = await prisma.schedule.findUnique({
      where: { department },
      include: { weeklyClasses: true, overrides: { where: { date } } },
    });
    if (!schedule?.isActive) return res.status(404).json({ success: false, message: 'No active schedule for this department' });

    const classes = [
      ...schedule.weeklyClasses.filter((item) => item.isActive && item.dayOfWeek === date.getUTCDay()),
      ...schedule.overrides.filter((item) => item.isActive),
    ];
    if (!classes.length) return res.status(400).json({ success: false, message: 'No classes are scheduled for this department on that date' });
    const existing = await prisma.attendanceSession.findMany({ where: { department, date } });
    const existingKeys = new Set(existing.map((item) => `${item.questionSetId}:${item.scheduledStartTime}:${item.scheduledEndTime}`));
    const created = [];
    for (const item of classes) {
      const key = `${item.questionSetId}:${item.startTime}:${item.endTime}`;
      if (existingKeys.has(key)) continue;
      const totalStudents = await prisma.quizTaker.count({
        where: { department, isActive: true, questionSets: { some: { questionSetId: item.questionSetId } } },
      });
      created.push(await prisma.attendanceSession.create({ data: {
        department, date, questionSetId: item.questionSetId, questionSetTitle: item.questionSetTitle,
        scheduledStartTime: item.startTime, scheduledEndTime: item.endTime,
        totalStudents, absentCount: totalStudents, createdById: req.admin.id,
      } }));
      existingKeys.add(key);
    }
    return res.json({ success: true, data: created.map(serializeSession) });
  } catch (error) {
    return sendError(res, error, 'Unable to create attendance sessions');
  }
});

router.patch('/sessions/:sessionId/:action', async (req, res) => {
  const { sessionId, action } = req.params;
  if (!['open', 'close'].includes(action)) return res.status(404).json({ success: false, message: 'Unknown attendance action' });
  try {
    const session = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const opening = action === 'open';
    if (session.windowIsOpen === opening) return res.json({ success: true, data: serializeSession(session) });
    const durationMinutes = req.body?.durationMinutes;
    const bufferMinutes = req.body?.bufferMinutes;
    if (opening && ((durationMinutes !== undefined && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) ||
      (bufferMinutes !== undefined && (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 1440)))) {
      return res.status(400).json({ success: false, message: 'Invalid attendance window duration' });
    }
    const now = new Date();
    const updated = await prisma.attendanceSession.update({
      where: { id: sessionId },
      data: {
        windowIsOpen: opening,
        ...(opening ? {
          windowOpenedAt: now, windowOpenedById: req.admin.id, status: 'ongoing',
          windowDurationMinutes: durationMinutes ?? session.windowDurationMinutes,
          windowBufferMinutes: bufferMinutes ?? session.windowBufferMinutes,
        } : { windowClosedAt: now, windowClosedById: req.admin.id, status: 'completed' }),
        windowHistory: { create: { action: opening ? 'opened' : 'closed', timestamp: now, adminId: req.admin.id } },
      },
      include: { windowHistory: { orderBy: { timestamp: 'asc' } } },
    });
    return res.json({ success: true, data: serializeSession(updated) });
  } catch (error) {
    return sendError(res, error, 'Unable to update attendance window');
  }
});

router.post('/sessions/:sessionId/students/:studentId/mark', async (req, res) => {
  const { sessionId, studentId } = req.params;
  const { status, notes } = req.body || {};
  if (!['present', 'absent', 'excused'].includes(status) || (notes !== undefined && typeof notes !== 'string')) {
    return res.status(400).json({ success: false, message: 'Enter a valid attendance status' });
  }
  try {
    const session = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
    const student = await prisma.quizTaker.findUnique({ where: { id: studentId } });
    if (!session || !student || student.department !== session.department) {
      return res.status(404).json({ success: false, message: 'Session or student not found' });
    }
    const record = await prisma.attendanceRecord.upsert({
      where: { unique_session_student: { sessionId, studentId } },
      create: {
        sessionId, studentId, studentName: student.name || student.email, studentEmail: student.email,
        department: session.department, status, markedBy: 'admin', adminId: req.admin.id, notes: notes || '',
      },
      update: { status, markedBy: 'admin', adminId: req.admin.id, markedAt: new Date(), notes: notes || '' },
    });
    const presentCount = await prisma.attendanceRecord.count({ where: { sessionId, status: 'present' } });
    await prisma.attendanceSession.update({
      where: { id: sessionId }, data: { presentCount, absentCount: Math.max(0, session.totalStudents - presentCount) },
    });
    return res.json({ success: true, data: { ...record, _id: record.id } });
  } catch (error) {
    return sendError(res, error, 'Unable to mark attendance');
  }
});

router.get('/sessions/:sessionId/attendance', async (req, res) => {
  try {
    const session = await prisma.attendanceSession.findUnique({
      where: { id: req.params.sessionId },
      include: { windowHistory: { orderBy: { timestamp: 'asc' } }, records: { orderBy: { markedAt: 'desc' } } },
    });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const students = await prisma.quizTaker.findMany({
      where: { department: session.department, isActive: true, questionSets: { some: { questionSetId: session.questionSetId } } },
      select: { id: true, name: true, email: true, department: true, accountType: true, isActive: true },
    });
    const marked = new Set(session.records.map((record) => record.studentId));
    const presentRecords = session.records.map((record) => ({
      ...record, _id: record.id, session: record.sessionId, student: record.studentId, admin: record.adminId,
    }));
    const absentStudents = students.filter((student) => !marked.has(student.id)).map((student) => ({ ...student, _id: student.id }));
    const present = session.records.filter((record) => record.status === 'present').length;
    const absent = students.length - present - session.records.filter((record) => record.status === 'excused').length;
    return res.json({ success: true, data: {
      session: serializeSession(session), presentRecords, absentStudents,
      statistics: { total: students.length, present, absent: Math.max(0, absent), percentage: students.length ? ((present / students.length) * 100).toFixed(1) : '0' },
    } });
  } catch (error) {
    return sendError(res, error, 'Unable to load session attendance');
  }
});

module.exports = router;
