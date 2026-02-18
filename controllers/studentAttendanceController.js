const AttendanceSession = require('../models/AttendanceSession');
const AttendanceRecord = require('../models/AttendanceRecord');
const Schedule = require('../models/Schedule');

// Get student's classes for today
exports.getTodaysClasses = async (req, res) => {
  try {
    const studentId = req.student._id; // Assuming auth middleware sets req.student
    const student = req.student;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Get all sessions for student's department today
    const sessions = await AttendanceSession.find({
      department: student.department,
      date: {
        $gte: today,
        $lt: tomorrow,
      },
    })
    .populate('questionSet')
    .sort({ scheduledStartTime: 1 });
    
    // Check attendance status for each session
    const sessionsWithStatus = await Promise.all(
      sessions.map(async (session) => {
        const attendanceRecord = await AttendanceRecord.findOne({
          session: session._id,
          student: studentId,
        });
        
        return {
          ...session.toObject(),
          attendanceMarked: !!attendanceRecord,
          attendanceStatus: attendanceRecord?.status || null,
          markedAt: attendanceRecord?.markedAt || null,
          isLate: attendanceRecord?.isLate || false,
        };
      })
    );
    
    res.status(200).json({
      success: true,
      data: {
        classes: sessionsWithStatus,
        date: today,
      },
    });
  } catch (error) {
    console.error('Get today\'s classes error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Mark attendance for a class
exports.markAttendance = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const studentId = req.student._id;
    
    const record = await AttendanceRecord.markAttendance(
      sessionId,
      studentId,
      'student'
    );
    
    res.status(200).json({
      success: true,
      message: 'Attendance marked successfully',
      data: record,
    });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Get student's attendance history
exports.getMyAttendanceHistory = async (req, res) => {
  try {
    const studentId = req.student._id;
    const { limit = 20, skip = 0 } = req.query;
    
    console.log('Fetching attendance history for student:', studentId);
    
    // Fetch records - remove nested populate which might be causing the error
    const records = await AttendanceRecord.find({ student: studentId })
      .populate('session') // Just populate session, not nested questionSet
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean(); // Use lean for better performance
    
    console.log(`Found ${records.length} attendance records`);
    
    const total = await AttendanceRecord.countDocuments({ student: studentId });
    const presentCount = await AttendanceRecord.countDocuments({
      student: studentId,
      status: 'present',
    });
    
    res.status(200).json({
      success: true,
      data: {
        records,
        pagination: {
          total,
          limit: parseInt(limit),
          skip: parseInt(skip),
        },
        statistics: {
          totalClasses: total,
          present: presentCount,
          attendancePercentage: total > 0 
            ? ((presentCount / total) * 100).toFixed(2)
            : 0,
        },
      },
    });
  } catch (error) {
    console.error('Get attendance history error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message,
      // Send more details in development
      ...(process.env.NODE_ENV === 'development' && {
        error: error.toString(),
        stack: error.stack
      })
    });
  }
};

// Get student's weekly schedule
exports.getMyWeeklySchedule = async (req, res) => {
  try {
    const student = req.student;
    
    console.log('Fetching weekly schedule for department:', student.department);
    
    const schedule = await Schedule.findOne({
      department: student.department,
      isActive: true,
    }).populate('weeklySchedule.questionSet');
    
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'No schedule found for your department',
      });
    }
    
    res.status(200).json({
      success: true,
      data: schedule.weeklySchedule,
    });
  } catch (error) {
    console.error('Get weekly schedule error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};