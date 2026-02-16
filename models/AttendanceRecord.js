const mongoose = require('mongoose');

const AttendanceRecordSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AttendanceSession',
    required: true,
  },
  
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizTaker',
    required: true,
  },
  
  studentName: {
    type: String,
    required: true,
  },
  
  studentEmail: {
    type: String,
    required: true,
  },
  
  department: {
    type: String,
    enum: ['Sciences', 'Arts', 'Commercial'],
    required: true,
  },
  
  status: {
    type: String,
    enum: ['present', 'absent', 'excused'],
    default: 'absent',
  },
  
  // How attendance was marked
  markedBy: {
    type: String,
    enum: ['student', 'admin'],
    required: true,
  },
  
  // If marked by admin
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
  },
  
  markedAt: {
    type: Date,
    default: Date.now,
  },
  
  // Track if student was on time
  isLate: {
    type: Boolean,
    default: false,
  },
  
  // Minutes late (if applicable)
  minutesLate: {
    type: Number,
    default: 0,
  },
  
  notes: {
    type: String,
    default: '',
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound unique index to prevent duplicate records
AttendanceRecordSchema.index({ session: 1, student: 1 }, { unique: true });
AttendanceRecordSchema.index({ student: 1, createdAt: -1 });
AttendanceRecordSchema.index({ session: 1, status: 1 });

// Static method to mark attendance
AttendanceRecordSchema.statics.markAttendance = async function(sessionId, studentId, markedBy, adminId = null, notes = '') {
  const AttendanceSession = mongoose.model('AttendanceSession');
  const QuizTaker = mongoose.model('QuizTaker');
  
  const session = await AttendanceSession.findById(sessionId);
  if (!session) {
    throw new Error('Attendance session not found');
  }
  
  const student = await QuizTaker.findById(studentId);
  if (!student) {
    throw new Error('Student not found');
  }
  
  // Verify department match
  if (student.department !== session.department) {
    throw new Error('Student department does not match session department');
  }
  
  // Check if student is marking their own attendance
  if (markedBy === 'student') {
    const canMark = session.canMarkAttendance();
    if (!canMark.allowed) {
      throw new Error(canMark.reason);
    }
  }
  
  // Calculate if late
  const now = new Date();
  const sessionDate = new Date(session.date);
  const [hours, minutes] = session.scheduledStartTime.split(':');
  sessionDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  
  const bufferMs = session.attendanceWindow.bufferMinutes * 60 * 1000;
  const lateThreshold = new Date(sessionDate.getTime() + bufferMs);
  
  const isLate = now > lateThreshold;
  const minutesLate = isLate ? Math.floor((now - lateThreshold) / (60 * 1000)) : 0;
  
  // Create or update attendance record
  const record = await this.findOneAndUpdate(
    { session: sessionId, student: studentId },
    {
      session: sessionId,
      student: studentId,
      studentName: student.name,
      studentEmail: student.email,
      department: student.department,
      status: 'present',
      markedBy,
      admin: adminId,
      markedAt: now,
      isLate,
      minutesLate,
      notes,
    },
    { upsert: true, new: true }
  );
  
  // Update session statistics
  await this.updateSessionStats(sessionId);
  
  return record;
};

// Static method to update session statistics
AttendanceRecordSchema.statics.updateSessionStats = async function(sessionId) {
  const AttendanceSession = mongoose.model('AttendanceSession');
  const QuizTaker = mongoose.model('QuizTaker');
  
  const session = await AttendanceSession.findById(sessionId);
  if (!session) return;
  
  // Get total students in department
  const totalStudents = await QuizTaker.countDocuments({
    department: session.department,
    isActive: true,
  });
  
  // Count present students
  const presentCount = await this.countDocuments({
    session: sessionId,
    status: 'present',
  });
  
  // Update session
  session.totalStudents = totalStudents;
  session.presentCount = presentCount;
  session.absentCount = totalStudents - presentCount;
  
  await session.save();
};

module.exports = mongoose.model('AttendanceRecord', AttendanceRecordSchema);