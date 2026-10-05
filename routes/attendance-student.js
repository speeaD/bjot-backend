const express = require('express');
const { verifyQuizTaker } = require('../middleware/auth');
const prisma = require('../utils/database');

const router = express.Router();

function lagosToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const value = `${date.year}-${date.month}-${date.day}`;
  return { value, date: new Date(`${value}T00:00:00.000Z`) };
}

function serializeSession(session) {
  return {
    _id: session.id, department: session.department,
    questionSet: session.questionSetId, questionSetTitle: session.questionSetTitle,
    date: session.date, scheduledStartTime: session.scheduledStartTime,
    scheduledEndTime: session.scheduledEndTime,
    attendanceWindow: {
      isOpen: session.windowIsOpen, openedAt: session.windowOpenedAt,
      closedAt: session.windowClosedAt, durationMinutes: session.windowDurationMinutes,
      bufferMinutes: session.windowBufferMinutes,
    },
    status: session.status, totalStudents: session.totalStudents,
    presentCount: session.presentCount, absentCount: session.absentCount,
    createdBy: session.createdById, createdAt: session.createdAt, updatedAt: session.updatedAt,
    windowHistory: [],
  };
}

async function studentContext(id) {
  const student = await prisma.quizTaker.findUnique({
    where: { id },
    select: { id: true, department: true, questionSets: { select: { questionSetId: true } } },
  });
  return student && { ...student, subjectIds: student.questionSets.map((item) => item.questionSetId) };
}

function sendError(res, error, message) {
  console.error(message, error);
  return res.status(500).json({ success: false, message });
}

router.use(verifyQuizTaker);
router.use((req, res, next) => {
  if (req.quizTaker.accountType !== 'premium') {
    return res.status(403).json({ success: false, message: 'Premium access is required for class attendance' });
  }
  next();
});

router.get('/schedule/weekly', async (req, res) => {
  try {
    const student = await studentContext(req.quizTaker.id);
    if (!student?.department || !student.subjectIds.length) return res.json({ success: true, data: [] });
    const schedule = await prisma.schedule.findUnique({
      where: { department: student.department }, include: { weeklyClasses: true },
    });
    if (!schedule?.isActive) return res.json({ success: true, data: [] });
    const subjects = new Set(student.subjectIds);
    const classes = schedule.weeklyClasses
      .filter((item) => item.isActive && subjects.has(item.questionSetId))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
      .map((item) => ({
        _id: item.id, dayOfWeek: item.dayOfWeek, dayName: item.dayName,
        questionSet: item.questionSetId, questionSetTitle: item.questionSetTitle,
        startTime: item.startTime, endTime: item.endTime, isActive: item.isActive,
      }));
    return res.json({ success: true, data: classes });
  } catch (error) {
    return sendError(res, error, 'Unable to load weekly schedule');
  }
});

router.get('/classes/today', async (req, res) => {
  try {
    const student = await studentContext(req.quizTaker.id);
    if (!student?.department || !student.subjectIds.length) return res.json({ success: true, data: { classes: [] } });
    const { value, date } = lagosToday();
    const [sessions, schedule] = await Promise.all([
      prisma.attendanceSession.findMany({
        where: { date, department: student.department, questionSetId: { in: student.subjectIds } },
        include: { records: { where: { studentId: student.id } } },
        orderBy: { scheduledStartTime: 'asc' },
      }),
      prisma.schedule.findUnique({
        where: { department: student.department },
        include: { weeklyClasses: true, overrides: { where: { date } } },
      }),
    ]);
    const classes = sessions.map((session) => {
      const record = session.records[0];
      return {
        ...serializeSession(session),
        attendanceMarked: Boolean(record), attendanceStatus: record?.status || null,
        markedAt: record?.markedAt || null, isLate: record?.isLate || false,
      };
    });
    if (schedule?.isActive) {
      const subjects = new Set(student.subjectIds);
      const scheduled = [
        ...schedule.weeklyClasses.filter((item) => item.isActive && item.dayOfWeek === date.getUTCDay()),
        ...schedule.overrides.filter((item) => item.isActive),
      ];
      for (const item of scheduled) {
        if (!subjects.has(item.questionSetId) || classes.some((session) =>
          session.questionSet === item.questionSetId && session.scheduledStartTime === item.startTime && session.scheduledEndTime === item.endTime)) continue;
        classes.push({
          _id: `schedule-${item.id}-${value}`, department: student.department,
          questionSet: item.questionSetId, questionSetTitle: item.questionSetTitle,
          date, scheduledStartTime: item.startTime, scheduledEndTime: item.endTime,
          attendanceWindow: { isOpen: false, durationMinutes: 30, bufferMinutes: 15 },
          windowHistory: [], status: 'scheduled', totalStudents: 0, presentCount: 0, absentCount: 0,
          createdBy: schedule.createdById, createdAt: schedule.createdAt, updatedAt: schedule.updatedAt,
          attendanceMarked: false, attendanceStatus: null, markedAt: null, isLate: false,
        });
      }
      classes.sort((a, b) => a.scheduledStartTime.localeCompare(b.scheduledStartTime));
    }
    return res.json({ success: true, data: { classes } });
  } catch (error) {
    return sendError(res, error, "Unable to load today's classes");
  }
});

router.get('/attendance/history', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const skip = Math.max(0, Number.parseInt(req.query.skip, 10) || 0);
  try {
    const student = await studentContext(req.quizTaker.id);
    const [records, total, totalClasses, present] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { studentId: req.quizTaker.id }, include: { session: true },
        orderBy: { markedAt: 'desc' }, take: limit, skip,
      }),
      prisma.attendanceRecord.count({ where: { studentId: req.quizTaker.id } }),
      student?.department && student.subjectIds.length ? prisma.attendanceSession.count({
        where: { department: student.department, questionSetId: { in: student.subjectIds } },
      }) : 0,
      prisma.attendanceRecord.count({ where: { studentId: req.quizTaker.id, status: 'present' } }),
    ]);
    return res.json({ success: true, data: {
      records: records.map((record) => ({
        ...record, _id: record.id, student: record.studentId,
        session: serializeSession(record.session), admin: record.adminId,
      })),
      pagination: { total, limit, skip },
      statistics: {
        totalClasses, present,
        attendancePercentage: totalClasses ? ((present / totalClasses) * 100).toFixed(1) : '0',
      },
    } });
  } catch (error) {
    return sendError(res, error, 'Unable to load attendance history');
  }
});

router.post('/sessions/:sessionId/mark', async (req, res) => {
  try {
    const student = await studentContext(req.quizTaker.id);
    const session = await prisma.attendanceSession.findUnique({ where: { id: req.params.sessionId } });
    if (!student || !session || student.department !== session.department || !student.subjectIds.includes(session.questionSetId)) {
      return res.status(404).json({ success: false, message: 'Class session not found' });
    }
    if (session.date.toISOString().slice(0, 10) !== lagosToday().value || !session.windowIsOpen || !session.windowOpenedAt) {
      return res.status(409).json({ success: false, message: 'The attendance window is closed' });
    }
    const now = new Date();
    const minutesElapsed = (now.getTime() - session.windowOpenedAt.getTime()) / 60000;
    if (minutesElapsed > session.windowDurationMinutes) {
      return res.status(409).json({ success: false, message: 'The attendance window has expired' });
    }
    const existing = await prisma.attendanceRecord.findUnique({
      where: { unique_session_student: { sessionId: session.id, studentId: student.id } },
    });
    if (existing) return res.status(409).json({ success: false, message: 'Attendance has already been marked' });

    const identity = await prisma.quizTaker.findUnique({ where: { id: student.id }, select: { name: true, email: true } });
    const record = await prisma.attendanceRecord.create({ data: {
      sessionId: session.id, studentId: student.id, studentName: identity.name || identity.email,
      studentEmail: identity.email, department: session.department, status: 'present',
      markedBy: 'student', markedAt: now, isLate: minutesElapsed > session.windowBufferMinutes,
      minutesLate: Math.max(0, Math.floor(minutesElapsed - session.windowBufferMinutes)),
    } });
    const presentCount = await prisma.attendanceRecord.count({ where: { sessionId: session.id, status: 'present' } });
    await prisma.attendanceSession.update({
      where: { id: session.id }, data: { presentCount, absentCount: Math.max(0, session.totalStudents - presentCount) },
    });
    return res.json({ success: true, data: { ...record, _id: record.id } });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ success: false, message: 'Attendance has already been marked' });
    return sendError(res, error, 'Unable to mark attendance');
  }
});

module.exports = router;
