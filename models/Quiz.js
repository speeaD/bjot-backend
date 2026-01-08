const mongoose = require('mongoose');

const QuizQuestionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['multiple-choice', 'essay', 'true-false', 'fill-in-the-blanks'],
    required: true,
  },
  question: {
    type: String,
    required: true,
  },
  options: [{
    type: String,
  }],
  correctAnswer: {
    type: mongoose.Schema.Types.Mixed,
  },
  points: {
    type: Number,
    default: 1,
  },
  order: {
    type: Number,
    required: true,
  },
  originalQuestionId: {
    type: mongoose.Schema.Types.ObjectId,
  }
}, { _id: true });

const QuizQuestionSetSchema = new mongoose.Schema({
  questionSetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuestionSet',
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  questions: [QuizQuestionSchema],
  totalPoints: {
    type: Number,
    default: 0,
  },
  order: {
    type: Number,
    required: true,
    min: 1,
    max: 4,
  }
}, { _id: true });

const QuizSchema = new mongoose.Schema({
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
    // NEW: Flag for open quizzes
    isOpenQuiz: {
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
  
  questionSets: {
    type: [QuizQuestionSetSchema],
    validate: {
      validator: function(v) {
        return v.length === 4;
      },
      message: 'A quiz must have exactly 4 question sets'
    }
  },
  
  // NEW: Track the question set combination used in this quiz
  questionSetCombination: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'QuestionSet',
    validate: {
      validator: function(v) {
        return v.length === 4;
      },
      message: 'Question set combination must contain exactly 4 question sets'
    }
  },
  
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

// Update totalPoints and questionSetCombination before saving
QuizSchema.pre('save', function() {
  if (this.questionSets && this.questionSets.length > 0) {
    // Calculate total points from all question sets
    this.totalPoints = this.questionSets.reduce((sum, qs) => {
      const setTotal = qs.questions.reduce((qSum, q) => qSum + (q.points || 0), 0);
      qs.totalPoints = setTotal;
      return sum + setTotal;
    }, 0);
    
    // Update questionSetCombination
    this.questionSetCombination = this.questionSets.map(qs => qs.questionSetId);
  }
  this.updatedAt = Date.now();
});

// Calculate total duration in seconds
QuizSchema.methods.getTotalDurationInSeconds = function() {
  const { hours, minutes, seconds } = this.settings.duration;
  return (hours * 3600) + (minutes * 60) + seconds;
};

module.exports = mongoose.model('Quiz', QuizSchema);