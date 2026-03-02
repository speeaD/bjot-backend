const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const studentAttendanceController = require('../controllers/studentAttendanceController');
const { verifyAdmin, verifyQuizTaker } = require('../middleware/auth');

// ============ ADMIN ROUTES ============

// Schedule management
router.post('/admin/schedules', verifyAdmin, attendanceController.createOrUpdateSchedule);
router.get('/admin/schedules', verifyAdmin, attendanceController.getAllSchedules);
router.get('/admin/schedules/:department', verifyAdmin, attendanceController.getDepartmentSchedule);
router.post('/admin/schedules/override', verifyAdmin, attendanceController.addScheduleOverride);

// Session management
router.get('/admin/sessions', verifyAdmin, attendanceController.getSessionsForDate);
router.post('/admin/sessions/create', verifyAdmin, attendanceController.createSessionsFromSchedule);
router.patch('/admin/sessions/:sessionId/open', verifyAdmin, attendanceController.openAttendanceWindow);
router.patch('/admin/sessions/:sessionId/close', verifyAdmin, attendanceController.closeAttendanceWindow);

// Attendance records
router.get('/admin/sessions/:sessionId/attendance', verifyAdmin, attendanceController.getSessionAttendance);
router.post('/admin/sessions/:sessionId/students/:studentId/mark', verifyAdmin, attendanceController.manuallyMarkAttendance);

// Reports
router.get('/admin/students/:studentId/attendance-report', verifyAdmin, attendanceController.getStudentAttendanceReport);
router.get('/admin/departments/:department/summary', verifyAdmin, attendanceController.getDepartmentAttendanceSummary);

// ============ STUDENT ANALYTICS ROUTES (NEW) ============

// Department-wide student analytics
router.get('/admin/analytics/department/:department', verifyAdmin, attendanceController.getDepartmentStudentAnalytics);

// Individual student detailed analytics
router.get('/admin/analytics/student/:studentId', verifyAdmin, attendanceController.getStudentDetailedAnalytics);


// ============ STUDENT ROUTES ============

router.get('/student/classes/today', verifyQuizTaker, studentAttendanceController.getTodaysClasses);
router.post('/student/sessions/:sessionId/mark', verifyQuizTaker, studentAttendanceController.markAttendance);
router.get('/student/attendance/history', verifyQuizTaker, studentAttendanceController.getMyAttendanceHistory);
router.get('/student/schedule/weekly', verifyQuizTaker, studentAttendanceController.getMyWeeklySchedule);

module.exports = router;