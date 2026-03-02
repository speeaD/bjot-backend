const Schedule = require('../models/Schedule');
const AttendanceSession = require('../models/AttendanceSession');
const AttendanceRecord = require('../models/AttendanceRecord');
const QuizTaker = require('../models/QuizTaker');
const QuestionSet = require('../models/QuestionSet');

// ============ SCHEDULE MANAGEMENT ============

// Create or update department schedule
exports.createOrUpdateSchedule = async (req, res) => {
  try {
    const { department, weeklySchedule } = req.body;
    const adminId = req.admin._id;
    
    // Validate and enrich weeklySchedule with QuestionSet titles
    const enrichedSchedule = [];
    for (const session of weeklySchedule) {
      const questionSet = await QuestionSet.findById(session.questionSet);
      if (!questionSet) {
        return res.status(404).json({
          success: false,
          message: `Question set not found: ${session.questionSet}`,
        });
      }
      
      enrichedSchedule.push({
        ...session,
        questionSetTitle: questionSet.title,
      });
    }
    
    // Update or create schedule
    const schedule = await Schedule.findOneAndUpdate(
      { department },
      {
        department,
        weeklySchedule: enrichedSchedule,
        createdBy: adminId,
      },
      { upsert: true, new: true, runValidators: true }
    ).populate('weeklySchedule.questionSet');
    
    res.status(200).json({
      success: true,
      message: 'Schedule created/updated successfully',
      data: schedule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get schedule for a department
exports.getDepartmentSchedule = async (req, res) => {
  try {
    const { department } = req.params;
    
    const schedule = await Schedule.findOne({ department, isActive: true })
      .populate('weeklySchedule.questionSet');
    
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found for this department',
      });
    }
    
    res.status(200).json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get all departments' schedules
exports.getAllSchedules = async (req, res) => {
  try {
    const schedules = await Schedule.find({ isActive: true })
      .populate('weeklySchedule.questionSet');
    
    res.status(200).json({
      success: true,
      data: schedules,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Add schedule override for a specific date
exports.addScheduleOverride = async (req, res) => {
  try {
    const { department, date, classSession, reason } = req.body;
    
    const schedule = await Schedule.findOne({ department });
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found',
      });
    }
    
    // Enrich with QuestionSet title
    const questionSet = await QuestionSet.findById(classSession.questionSet);
    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: 'Question set not found',
      });
    }
    
    schedule.overrides.push({
      date,
      classSession: {
        ...classSession,
        questionSetTitle: questionSet.title,
      },
      reason,
    });
    
    await schedule.save();
    
    res.status(200).json({
      success: true,
      message: 'Schedule override added',
      data: schedule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============ ATTENDANCE SESSION MANAGEMENT ============

// Get all sessions for a specific date (all departments)
exports.getSessionsForDate = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    const sessions = await AttendanceSession.find({
      date: {
        $gte: targetDate,
        $lt: nextDay,
      },
    })
    .populate('questionSet')
    .populate('createdBy', 'name email')
    .populate('attendanceWindow.openedBy', 'name')
    .populate('attendanceWindow.closedBy', 'name')
    .sort({ department: 1, scheduledStartTime: 1 });
    
    // Group by department
    const grouped = sessions.reduce((acc, session) => {
      if (!acc[session.department]) {
        acc[session.department] = [];
      }
      acc[session.department].push(session);
      return acc;
    }, {});
    
    res.status(200).json({
      success: true,
      data: grouped,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Create sessions for a specific date and department from schedule
exports.createSessionsFromSchedule = async (req, res) => {
  try {
    const { department, date } = req.body;
    const adminId = req.admin._id;
    
    const sessions = await AttendanceSession.createFromSchedule(
      department,
      new Date(date),
      adminId
    );
    
    res.status(201).json({
      success: true,
      message: `${sessions.length} session(s) created successfully`,
      data: sessions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Open attendance window
exports.openAttendanceWindow = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { durationMinutes, bufferMinutes } = req.body;
    const adminId = req.admin._id;
    
    console.log('Opening attendance window:', {
      sessionId,
      adminId,
      durationMinutes,
      bufferMinutes
    });
    
    const session = await AttendanceSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    // Update duration and buffer if provided
    if (durationMinutes) {
      session.attendanceWindow.durationMinutes = durationMinutes;
    }
    if (bufferMinutes !== undefined) {
      session.attendanceWindow.bufferMinutes = bufferMinutes;
    }
    
    session.openWindow(adminId);
    await session.save();
    
    console.log('Attendance window opened successfully');
    
    res.status(200).json({
      success: true,
      message: 'Attendance window opened',
      data: session,
    });
  } catch (error) {
    console.error('Error opening attendance window:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Close attendance window
exports.closeAttendanceWindow = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const adminId = req.admin._id;
    
    console.log('Closing attendance window:', { sessionId, adminId });
    
    const session = await AttendanceSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    session.closeWindow(adminId);
    await session.save();
    
    console.log('Attendance window closed successfully');
    
    res.status(200).json({
      success: true,
      message: 'Attendance window closed',
      data: session,
    });
  } catch (error) {
    console.error('Error closing attendance window:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get attendance records for a session
exports.getSessionAttendance = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await AttendanceSession.findById(sessionId)
      .populate('questionSet');
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    const records = await AttendanceRecord.find({ session: sessionId })
      .populate('student', 'name email accountType')
      .sort({ markedAt: 1 });
    
    // Get all students in department
    const allStudents = await QuizTaker.find({
      department: session.department,
      isActive: true,
    }).select('name email accountType');
    
    // Mark students who haven't marked attendance
    const presentStudentIds = new Set(
      records.map(r => r.student._id.toString())
    );
    
    const absentStudents = allStudents.filter(
      s => !presentStudentIds.has(s._id.toString())
    );
    
    res.status(200).json({
      success: true,
      data: {
        session,
        presentRecords: records,
        absentStudents,
        statistics: {
          total: session.totalStudents,
          present: session.presentCount,
          absent: session.absentCount,
          percentage: session.totalStudents > 0 
            ? ((session.presentCount / session.totalStudents) * 100).toFixed(2)
            : 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Manually mark student attendance (by admin)
exports.manuallyMarkAttendance = async (req, res) => {
  try {
    const { sessionId, studentId } = req.params;
    const { status, notes } = req.body;
    const adminId = req.admin._id;
    
    const record = await AttendanceRecord.markAttendance(
      sessionId,
      studentId,
      'admin',
      adminId,
      notes || `Manually marked as ${status} by admin`
    );
    
    // Update status if different from 'present'
    if (status && status !== 'present') {
      record.status = status;
      await record.save();
    }
    
    res.status(200).json({
      success: true,
      message: 'Attendance marked successfully',
      data: record,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get attendance report for a student
exports.getStudentAttendanceReport = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;
    
    const query = { student: studentId };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const records = await AttendanceRecord.find(query)
      .populate('session')
      .sort({ createdAt: -1 });
    
    const totalClasses = records.length;
    const presentCount = records.filter(r => r.status === 'present').length;
    const absentCount = records.filter(r => r.status === 'absent').length;
    const excusedCount = records.filter(r => r.status === 'excused').length;
    const lateCount = records.filter(r => r.isLate).length;
    
    res.status(200).json({
      success: true,
      data: {
        records,
        statistics: {
          totalClasses,
          present: presentCount,
          absent: absentCount,
          excused: excusedCount,
          late: lateCount,
          attendancePercentage: totalClasses > 0 
            ? ((presentCount / totalClasses) * 100).toFixed(2)
            : 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get department attendance summary
exports.getDepartmentAttendanceSummary = async (req, res) => {
  try {
    const { department } = req.params;
    const { startDate, endDate } = req.query;
    
    const dateQuery = {};
    if (startDate || endDate) {
      dateQuery.date = {};
      if (startDate) dateQuery.date.$gte = new Date(startDate);
      if (endDate) dateQuery.date.$lte = new Date(endDate);
    }
    
    const sessions = await AttendanceSession.find({
      department,
      ...dateQuery,
    });
    
    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(s => s.status === 'completed').length;
    const avgAttendance = sessions.reduce((sum, s) => {
      return sum + (s.totalStudents > 0 ? (s.presentCount / s.totalStudents) * 100 : 0);
    }, 0) / (totalSessions || 1);
    
    res.status(200).json({
      success: true,
      data: {
        department,
        totalSessions,
        completedSessions,
        averageAttendancePercentage: avgAttendance.toFixed(2),
        sessions,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============ STUDENT ANALYTICS ============

// Get department-wide student analytics
exports.getDepartmentStudentAnalytics = async (req, res) => {
  try {
    const { department } = req.params;
    const { startDate, endDate } = req.query;
    
    console.log('Getting student analytics for department:', department);
    
    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }
    
    // Get all active students in department
    const students = await QuizTaker.find({
      department,
      isActive: true,
    }).select('name email accountType').lean();
    
    console.log(`Found ${students.length} students in ${department}`);
    
    // Get attendance records for each student
    const studentAnalytics = await Promise.all(
      students.map(async (student) => {
        const records = await AttendanceRecord.find({
          student: student._id,
          department,
          ...dateFilter,
        }).lean();
        
        const totalClasses = records.length;
        const presentCount = records.filter(r => r.status === 'present').length;
        const absentCount = records.filter(r => r.status === 'absent').length;
        const excusedCount = records.filter(r => r.status === 'excused').length;
        const lateCount = records.filter(r => r.isLate && r.status === 'present').length;
        
        const attendanceRate = totalClasses > 0 
          ? ((presentCount / totalClasses) * 100).toFixed(2)
          : '0.00';
        
        return {
          studentId: student._id,
          name: student.name,
          email: student.email,
          accountType: student.accountType,
          totalClasses,
          present: presentCount,
          absent: absentCount,
          excused: excusedCount,
          late: lateCount,
          attendanceRate: parseFloat(attendanceRate),
        };
      })
    );
    
    // Sort by attendance rate (lowest first for at-risk students)
    studentAnalytics.sort((a, b) => a.attendanceRate - b.attendanceRate);
    
    // Calculate department statistics
    const departmentStats = {
      totalStudents: students.length,
      averageAttendanceRate: studentAnalytics.length > 0
        ? (studentAnalytics.reduce((sum, s) => sum + s.attendanceRate, 0) / studentAnalytics.length).toFixed(2)
        : '0.00',
      atRiskStudents: studentAnalytics.filter(s => s.attendanceRate < 75).length,
      perfectAttendance: studentAnalytics.filter(s => s.attendanceRate === 100).length,
    };
    
    res.status(200).json({
      success: true,
      data: {
        department,
        statistics: departmentStats,
        students: studentAnalytics,
        dateRange: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
      },
    });
    
  } catch (error) {
    console.error('Get department student analytics error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get individual student detailed analytics
exports.getStudentDetailedAnalytics = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;
    
    console.log('Getting detailed analytics for student:', studentId);
    
    // Get student info
    const student = await QuizTaker.findById(studentId)
      .select('name email department accountType')
      .populate('questionSetCombination', 'title');
    
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }
    
    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }
    
    // Get all attendance records
    const records = await AttendanceRecord.find({
      student: studentId,
      ...dateFilter,
    })
    .populate({
      path: 'session',
      select: 'questionSetTitle date scheduledStartTime scheduledEndTime',
    })
    .sort({ createdAt: -1 })
    .lean();
    
    console.log(`Found ${records.length} attendance records`);
    
    // Calculate statistics
    const totalClasses = records.length;
    const presentCount = records.filter(r => r.status === 'present').length;
    const absentCount = records.filter(r => r.status === 'absent').length;
    const excusedCount = records.filter(r => r.status === 'excused').length;
    const lateCount = records.filter(r => r.isLate && r.status === 'present').length;
    const onTimeCount = presentCount - lateCount;
    
    const attendanceRate = totalClasses > 0 
      ? ((presentCount / totalClasses) * 100).toFixed(2)
      : '0.00';
    
    const punctualityRate = presentCount > 0
      ? ((onTimeCount / presentCount) * 100).toFixed(2)
      : '0.00';
    
    // Group by subject
    const subjectBreakdown = {};
    records.forEach(record => {
      if (!record.session) return;
      
      const subject = record.session.questionSetTitle;
      if (!subjectBreakdown[subject]) {
        subjectBreakdown[subject] = {
          subject,
          total: 0,
          present: 0,
          absent: 0,
          late: 0,
        };
      }
      
      subjectBreakdown[subject].total++;
      if (record.status === 'present') {
        subjectBreakdown[subject].present++;
        if (record.isLate) subjectBreakdown[subject].late++;
      } else if (record.status === 'absent') {
        subjectBreakdown[subject].absent++;
      }
    });
    
    // Convert to array and calculate rates
    const subjectStats = Object.values(subjectBreakdown).map((stat) => ({
      ...stat,
      attendanceRate: stat.total > 0 
        ? ((stat.present / stat.total) * 100).toFixed(2)
        : '0.00',
    }));
    
    // Get recent attendance pattern (last 10 classes)
    const recentPattern = records.slice(0, 10).map(r => ({
      date: r.session?.date,
      subject: r.session?.questionSetTitle,
      status: r.status,
      isLate: r.isLate,
      markedAt: r.markedAt,
    }));
    
    res.status(200).json({
      success: true,
      data: {
        student: {
          id: student._id,
          name: student.name,
          email: student.email,
          department: student.department,
          accountType: student.accountType,
          subjects: student.questionSetCombination,
        },
        overallStats: {
          totalClasses,
          present: presentCount,
          absent: absentCount,
          excused: excusedCount,
          late: lateCount,
          onTime: onTimeCount,
          attendanceRate: parseFloat(attendanceRate),
          punctualityRate: parseFloat(punctualityRate),
        },
        subjectBreakdown: subjectStats,
        recentPattern,
        records: records.slice(0, 20), // Last 20 records
      },
    });
    
  } catch (error) {
    console.error('Get student detailed analytics error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};