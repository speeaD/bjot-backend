const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['multiple-choice', 'essay', 'true-false', 'fill-in-the-blanks'],
    required: true,
  },
  question: {
    type: String,
    required: true,
  },
  // For multiple choice
  options: [{
    type: String,
  }],
  correctAnswer: {
    type: mongoose.Schema.Types.Mixed, // Can be string, number, or array
  },
  points: {
    type: Number,
    default: 1,
  },
  order: {
    type: Number,
    required: true,
  },
}, { _id: true });

const QuizSchema = new mongoose.Schema({
  // Settings Section
  settings: {
    coverImage: {
      type: String,
      default: '',
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    isQuizChallenge: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      default: '',
    },
    instructions: {
      type: String,
      default: '',
    },
    duration: {
      hours: {
        type: Number,
        default: 0,
        min: 0,
      },
      minutes: {
        type: Number,
        default: 30,
        min: 0,
        max: 59,
      },
      seconds: {
        type: Number,
        default: 0,
        min: 0,
        max: 59,
      },
    },
    multipleAttempts: {
      type: Boolean,
      default: false,
    },
    looseFocus: {
      type: Boolean,
      default: false,
    },
    viewAnswer: {
      type: Boolean,
      default: true,
    },
    viewResults: {
      type: Boolean,
      default: true,
    },
    displayCalculator: {
      type: Boolean,
      default: false,
    },
  },
  
  // Questions Section
  questions: [QuestionSchema],
  
  // Additional fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  totalPoints: {
    type: Number,
    default: 0,
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

// Update totalPoints before saving
QuizSchema.pre('save', async function() {
    if (this.questions && this.questions.length > 0) {
    this.totalPoints = this.questions.reduce((sum, q) => sum + (q.points || 0), 0);
  }
  this.updatedAt = Date.now();
});

// Calculate total duration in seconds
QuizSchema.methods.getTotalDurationInSeconds = function() {
  const { hours, minutes, seconds } = this.settings.duration;
  return (hours * 3600) + (minutes * 60) + seconds;
};

module.exports = mongoose.model('Quiz', QuizSchema);