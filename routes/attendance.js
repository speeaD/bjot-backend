const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const studentAttendanceController = require('../controllers/studentAttendanceController');
const { adminAuth, studentAuth } = require('../middleware/auth'); // Your auth middleware

// ============ ADMIN ROUTES ============

// Schedule management
router.post('/admin/schedules', adminAuth, attendanceController.createOrUpdateSchedule);
router.get('/admin/schedules', adminAuth, attendanceController.getAllSchedules);
router.get('/admin/schedules/:department', adminAuth, attendanceController.getDepartmentSchedule);
router.post('/admin/schedules/override', adminAuth, attendanceController.addScheduleOverride);

// Session management
router.get('/admin/sessions', adminAuth, attendanceController.getSessionsForDate);
router.post('/admin/sessions/create', adminAuth, attendanceController.createSessionsFromSchedule);
router.patch('/admin/sessions/:sessionId/open', adminAuth, attendanceController.openAttendanceWindow);
router.patch('/admin/sessions/:sessionId/close', adminAuth, attendanceController.closeAttendanceWindow);

// Attendance records
router.get('/admin/sessions/:sessionId/attendance', adminAuth, attendanceController.getSessionAttendance);
router.post('/admin/sessions/:sessionId/students/:studentId/mark', adminAuth, attendanceController.manuallyMarkAttendance);

// Reports
router.get('/admin/students/:studentId/attendance-report', adminAuth, attendanceController.getStudentAttendanceReport);
router.get('/admin/departments/:department/summary', adminAuth, attendanceController.getDepartmentAttendanceSummary);

// ============ STUDENT ROUTES ============

router.get('/student/classes/today', studentAuth, studentAttendanceController.getTodaysClasses);
router.post('/student/sessions/:sessionId/mark', studentAuth, studentAttendanceController.markAttendance);
router.get('/student/attendance/history', studentAuth, studentAttendanceController.getMyAttendanceHistory);
router.get('/student/schedule/weekly', studentAuth, studentAttendanceController.getMyWeeklySchedule);

module.exports = router;