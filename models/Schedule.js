const mongoose = require('mongoose');

const ClassSessionSchema = new mongoose.Schema({
  dayOfWeek: {
    type: Number,
    required: true,
    min: 0,    // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    max: 6,
  },
  dayName: {
    type: String,
    enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
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
  startTime: {
    type: String,    // Format: "19:00" (7:00 PM)
    required: true,
    default: '19:00',
  },
  endTime: {
    type: String,    // Format: "21:00" (9:00 PM)
    required: true,
    default: '21:00',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { _id: true });

const ScheduleSchema = new mongoose.Schema({
  department: {
    type: String,
    enum: ['Sciences', 'Arts', 'Commercial'],
    required: true,
    unique: true,
  },
  
  // Weekly recurring schedule
  weeklySchedule: [ClassSessionSchema],
  
  // Special/override schedules for specific dates
  overrides: [{
    date: {
      type: Date,
      required: true,
    },
    classSession: ClassSessionSchema,
    reason: {
      type: String,
      default: '',
    },
  }],
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
  },
  
  isActive: {
    type: Boolean,
    default: true,
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

// Update timestamp on save
ScheduleSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

// Method to get classes for a specific date
ScheduleSchema.methods.getClassesForDate = function(date) {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  
  // Check for overrides first
  const override = this.overrides.find(o => {
    const overrideDate = new Date(o.date);
    overrideDate.setHours(0, 0, 0, 0);
    return overrideDate.getTime() === targetDate.getTime() && o.classSession.isActive;
  });
  
  if (override) {
    return [override.classSession];
  }
  
  // Otherwise, return weekly schedule for that day
  const dayOfWeek = targetDate.getDay();
  return this.weeklySchedule.filter(
    session => session.dayOfWeek === dayOfWeek && session.isActive
  );
};

// Static method to get all departments' classes for a specific date
ScheduleSchema.statics.getAllClassesForDate = async function(date) {
  const schedules = await this.find({ isActive: true });
  const result = {};
  
  schedules.forEach(schedule => {
    result[schedule.department] = schedule.getClassesForDate(date);
  });
  
  return result;
};

module.exports = mongoose.model('Schedule', ScheduleSchema);