const AttendanceSession = require('../models/AttendanceSession');
const AttendanceRecord = require('../models/AttendanceRecord');
const Schedule = require('../models/Schedule');

// Get student's classes for today (FILTERED by subject combination)
exports.getTodaysClasses = async (req, res) => {
  try {
    const studentId = req.quizTaker._id;
    const student = req.quizTaker;
    
    console.log('Getting today\'s classes for student:', {
      id: studentId,
      department: student.department,
      questionSetCombination: student.questionSetCombination
    });
    
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
    
    console.log(`Found ${sessions.length} total sessions for ${student.department}`);
    
    // ✅ FILTER sessions based on student's questionSetCombination
    let filteredSessions = sessions;
    
    if (student.questionSetCombination && student.questionSetCombination.length > 0) {
      // Convert student's question set IDs to strings for comparison
      const studentSubjectIds = student.questionSetCombination.map(id => id.toString());
      
      // Only show sessions where questionSet matches student's combination
      filteredSessions = sessions.filter(session => {
        const sessionQuestionSetId = session.questionSet?._id?.toString() || session.questionSet?.toString();
        const isInCombination = studentSubjectIds.includes(sessionQuestionSetId);
        
        console.log('Session filter check:', {
          sessionSubject: session.questionSetTitle,
          sessionQuestionSetId,
          isInCombination
        });
        
        return isInCombination;
      });
      
      console.log(`Filtered to ${filteredSessions.length} sessions matching student's subject combination`);
    } else {
      console.log('Student has no questionSetCombination, showing all sessions');
    }
    
    // Check attendance status for each filtered session
    const sessionsWithStatus = await Promise.all(
      filteredSessions.map(async (session) => {
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
    const studentId = req.quizTaker._id;
    const student = req.quizTaker;
    
    console.log('Marking attendance:', {
      sessionId,
      studentId,
      department: student.department
    });
    
    // ✅ VERIFY session belongs to student's subject combination
    const session = await AttendanceSession.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    // Check if session's questionSet is in student's combination
    if (student.questionSetCombination && student.questionSetCombination.length > 0) {
      const studentSubjectIds = student.questionSetCombination.map(id => id.toString());
      const sessionQuestionSetId = session.questionSet.toString();
      
      if (!studentSubjectIds.includes(sessionQuestionSetId)) {
        console.log('Student attempted to mark attendance for non-enrolled subject:', {
          sessionSubject: session.questionSetTitle,
          studentCombination: studentSubjectIds
        });
        
        return res.status(403).json({
          success: false,
          message: 'You are not enrolled in this subject',
        });
      }
    }
    
    const record = await AttendanceRecord.markAttendance(
      sessionId,
      studentId,
      'student'
    );
    
    console.log('Attendance marked successfully:', record._id);
    
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

// Get student's attendance history (FILTERED by subject combination)
exports.getMyAttendanceHistory = async (req, res) => {
  try {
    const studentId = req.quizTaker._id;
    const student = req.quizTaker;
    const { limit = 20, skip = 0 } = req.query;
    
    console.log('Fetching attendance history for student:', studentId);
    
    // Fetch records
    const records = await AttendanceRecord.find({ student: studentId })
      .populate('session')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();
    
    console.log(`Found ${records.length} attendance records`);
    
    // ✅ FILTER records based on student's subject combination
    let filteredRecords = records;
    
    if (student.questionSetCombination && student.questionSetCombination.length > 0) {
      const studentSubjectIds = student.questionSetCombination.map(id => id.toString());
      
      filteredRecords = records.filter(record => {
        if (!record.session || !record.session.questionSet) return false;
        
        const sessionQuestionSetId = record.session.questionSet.toString();
        return studentSubjectIds.includes(sessionQuestionSetId);
      });
      
      console.log(`Filtered to ${filteredRecords.length} records matching subject combination`);
    }
    
    const total = await AttendanceRecord.countDocuments({ student: studentId });
    const presentCount = await AttendanceRecord.countDocuments({
      student: studentId,
      status: 'present',
    });
    
    res.status(200).json({
      success: true,
      data: {
        records: filteredRecords,
        pagination: {
          total: filteredRecords.length, // Use filtered count
          limit: parseInt(limit),
          skip: parseInt(skip),
        },
        statistics: {
          totalClasses: filteredRecords.length,
          present: filteredRecords.filter(r => r.status === 'present').length,
          attendancePercentage: filteredRecords.length > 0 
            ? ((filteredRecords.filter(r => r.status === 'present').length / filteredRecords.length) * 100).toFixed(2)
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
      ...(process.env.NODE_ENV === 'development' && {
        error: error.toString(),
        stack: error.stack
      })
    });
  }
};

// Get student's weekly schedule (FILTERED by subject combination)
exports.getMyWeeklySchedule = async (req, res) => {
  try {
    const student = req.quizTaker;
    
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
    
    // ✅ FILTER weekly schedule based on student's subject combination
    let filteredSchedule = schedule.weeklySchedule;
    
    if (student.questionSetCombination && student.questionSetCombination.length > 0) {
      const studentSubjectIds = student.questionSetCombination.map(id => id.toString());
      
      filteredSchedule = schedule.weeklySchedule.filter(classSession => {
        const questionSetId = classSession.questionSet?._id?.toString() || classSession.questionSet?.toString();
        return studentSubjectIds.includes(questionSetId);
      });
      
      console.log(`Filtered schedule from ${schedule.weeklySchedule.length} to ${filteredSchedule.length} classes`);
    }
    
    res.status(200).json({
      success: true,
      data: filteredSchedule,
    });
  } catch (error) {
    console.error('Get weekly schedule error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};