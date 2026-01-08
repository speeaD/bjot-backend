const mongoose = require('mongoose');

const QuestionSetProgressSchema = new mongoose.Schema({
  questionSetOrder: {
    type: Number,
    required: true,
    min: 1,
    max: 4,
  },
  selectedOrder: {
    type: Number,
    min: 1,
    max: 4,
  },
  status: {
    type: String,
    enum: ['not-started', 'in-progress', 'completed'],
    default: 'not-started',
  },
  startedAt: {
    type: Date,
  },
  completedAt: {
    type: Date,
  },
  score: {
    type: Number,
    default: 0,
  },
  totalPoints: {
    type: Number,
    default: 0,
  },
}, { _id: false });

const QuizTakerSchema = new mongoose.Schema({
  // NEW: Account type
  accountType: {
    type: String,
    enum: ['premium', 'regular'],
    default: 'premium',
    required: true,
  },
  
  // NEW: Full name (for regular students)
  name: {
    type: String,
    trim: true,
  },
  
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    // Remove unique constraint since regular students might have duplicate emails across attempts
    index: true,
  },
  
  // NEW: Question set combination (array of 4 question set IDs)
  questionSetCombination: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'QuestionSet',
    validate: {
      validator: function(arr) {
        return arr.length === 4;
      },
      message: 'Question set combination must contain exactly 4 question sets'
    }
  },
  
  accessCode: {
    type: String,
    // Only required for premium students
    required: function() {
      return this.accountType === 'premium';
    },
    sparse: true, // Allows null values and only enforces uniqueness on non-null values
    unique: true,
  },
  
  isActive: {
    type: Boolean,
    default: true,
  },
  
  quizzesTaken: [{
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
    },
    score: Number,
    completedAt: Date,
  }],
  
  // Only for premium students
  assignedQuizzes: [{
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
      required: true,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed'],
      default: 'pending',
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuizSubmission',
    },
    questionSetProgress: [QuestionSetProgressSchema],
    selectedQuestionSetOrder: {
      type: [Number],
      validate: {
        validator: function(arr) {
          if (!arr || arr.length === 0) return true;
          if (arr.length !== 4) return false;
          const sorted = [...arr].sort();
          return sorted.join(',') === '1,2,3,4';
        },
        message: 'selectedQuestionSetOrder must contain [1,2,3,4] in any order'
      }
    },
    currentQuestionSetOrder: {
      type: Number,
      min: 1,
      max: 4,
    },
  }],
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Create compound index for regular students (email + accountType)
QuizTakerSchema.index({ email: 1, accountType: 1 });

// Generate unique 9-digit alphanumeric access code (only for premium)
QuizTakerSchema.statics.generateAccessCode = function() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 9; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Helper method to initialize question set progress
QuizTakerSchema.methods.initializeQuestionSetProgress = function(quizId) {
  const assignedQuiz = this.assignedQuizzes.find(
    aq => aq.quizId.toString() === quizId.toString()
  );
  
  if (!assignedQuiz) return false;
  
  if (!assignedQuiz.questionSetProgress || assignedQuiz.questionSetProgress.length === 0) {
    assignedQuiz.questionSetProgress = [
      { questionSetOrder: 1, status: 'not-started' },
      { questionSetOrder: 2, status: 'not-started' },
      { questionSetOrder: 3, status: 'not-started' },
      { questionSetOrder: 4, status: 'not-started' },
    ];
  }
  
  return true;
};

// Validation: Premium students must have access codes
QuizTakerSchema.pre('save', function() {
  if (this.accountType === 'premium' && !this.accessCode) {
    return (new Error('Premium students must have an access code'));
  }
  
  // Regular students shouldn't have assigned quizzes
  if (this.accountType === 'regular' && this.assignedQuizzes && this.assignedQuizzes.length > 0) {
    return (new Error('Regular students cannot have assigned quizzes'));
  }
  return;
});

module.exports = mongoose.model('QuizTaker', QuizTakerSchema);