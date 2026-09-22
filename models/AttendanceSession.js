const mongoose = require('mongoose');

const AttendanceSessionSchema = new mongoose.Schema({
  department: {
    type: String,
    enum: ['Sciences', 'Arts', 'Commercial'],
    required: true,
  },
  
  questionSet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuestionSet',
    required: true,
  },
  
  questionSetTitle: {
    type: String,
    required: true,
  },
  
  date: {
    type: Date,
    required: true,
  },
  
  scheduledStartTime: {
    type: String,    // Format: "19:00"
    required: true,
  },
  
  scheduledEndTime: {
    type: String,    // Format: "21:00"
    required: true,
  },
  
  // Attendance window control
  attendanceWindow: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    openedAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
    },
    openedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    // Window duration in minutes (default 30)
    durationMinutes: {
      type: Number,
      default: 30,
    },
    // Allow marking within X minutes of class start (buffer)
    bufferMinutes: {
      type: Number,
      default: 15,
    },
  },
  
  // Track window open/close history
  windowHistory: [{
    action: {
      type: String,
      enum: ['opened', 'closed'],
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
  }],
  
  status: {
    type: String,
    enum: ['scheduled', 'ongoing', 'completed', 'cancelled'],
    default: 'scheduled',
  },
  
  // Statistics
  totalStudents: {
    type: Number,
    default: 0,
  },
  presentCount: {
    type: Number,
    default: 0,
  },
  absentCount: {
    type: Number,
    default: 0,
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
  
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for efficient queries
AttendanceSessionSchema.index({ department: 1, date: 1, questionSet: 1 });
AttendanceSessionSchema.index({ date: 1, 'attendanceWindow.isOpen': 1 });

// Update timestamp
AttendanceSessionSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

// Method to open attendance window
AttendanceSessionSchema.methods.openWindow = function(adminId) {
  this.attendanceWindow.isOpen = true;
  this.attendanceWindow.openedAt = new Date();
  this.attendanceWindow.openedBy = adminId;
  this.attendanceWindow.closedAt = null;
  
  this.windowHistory.push({
    action: 'opened',
    timestamp: new Date(),
    admin: adminId,
  });
  
  if (this.status === 'scheduled') {
    this.status = 'ongoing';
  }
};

// Method to close attendance window
AttendanceSessionSchema.methods.closeWindow = function(adminId) {
  this.attendanceWindow.isOpen = false;
  this.attendanceWindow.closedAt = new Date();
  this.attendanceWindow.closedBy = adminId;
  
  this.windowHistory.push({
    action: 'closed',
    timestamp: new Date(),
    admin: adminId,
  });
};

// Method to check if student can mark attendance
AttendanceSessionSchema.methods.canMarkAttendance = function() {
  if (!this.attendanceWindow.isOpen) {
    return { allowed: false, reason: 'Attendance window is closed' };
  }
  
  const now = new Date();
  const openedAt = this.attendanceWindow.openedAt;
  const durationMs = this.attendanceWindow.durationMinutes * 60 * 1000;
  const windowCloseTime = new Date(openedAt.getTime() + durationMs);
  
  if (now > windowCloseTime) {
    return { allowed: false, reason: 'Attendance window has expired' };
  }
  
  return { allowed: true };
};

// Static method to create sessions from schedule
AttendanceSessionSchema.statics.createFromSchedule = async function(department, date, adminId) {
  const Schedule = mongoose.model('Schedule');
  const schedule = await Schedule.findOne({ department, isActive: true });
  
  if (!schedule) {
    throw new Error(`No schedule found for ${department}`);
  }
  
  const classes = schedule.getClassesForDate(date);
  const sessions = [];
  
  for (const classSession of classes) {
    const QuestionSet = mongoose.model('QuestionSet');
    const questionSet = await QuestionSet.findById(classSession.questionSet);
    
    const session = await this.create({
      department,
      questionSet: classSession.questionSet,
      questionSetTitle: questionSet ? questionSet.title : classSession.questionSetTitle,
      date,
      scheduledStartTime: classSession.startTime,
      scheduledEndTime: classSession.endTime,
      createdBy: adminId,
    });
    
    sessions.push(session);
  }
  
  return sessions;
};

module.exports = mongoose.model('AttendanceSession', AttendanceSessionSchema);