const mongoose = require('mongoose');

const AnswerSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  questionSetOrder: { // NEW: Track which question set this answer belongs to
    type: Number,
    required: true,
    min: 1,
    max: 4,
  },
  questionType: {
    type: String,
    enum: ['multiple-choice', 'essay', 'true-false', 'fill-in-the-blanks'],
    required: true,
  },
  answer: {
    type: mongoose.Schema.Types.Mixed, // Can be string, boolean, or array
  },
  isCorrect: {
    type: Boolean,
    default: null, // null for essay questions (manual grading)
  },
  pointsAwarded: {
    type: Number,
    default: 0,
  },
  pointsPossible: {
    type: Number,
    required: true,
  },
}, { _id: false });

// NEW: Track individual question set submissions
const QuestionSetSubmissionSchema = new mongoose.Schema({
  questionSetOrder: {
    type: Number,
    required: true,
    min: 1,
    max: 4,
  },
  submittedAt: {
    type: Date,
    required: true,
  },
  score: {
    type: Number,
    default: 0,
  },
  totalPoints: {
    type: Number,
    required: true,
  },
  percentage: {
    type: Number,
    default: 0,
  },
  orderAnswered: { // 1st set answered, 2nd set answered, etc.
    type: Number,
    min: 1,
    max: 4,
  },
}, { _id: false });

const QuizSubmissionSchema = new mongoose.Schema({
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
  },
  quizTakerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizTaker',
    required: true,
  },
  answers: [AnswerSchema],
  // NEW: Track each question set submission
  questionSetSubmissions: [QuestionSetSubmissionSchema],
  startedAt: {
    type: Date,
    required: true,
  },
  submittedAt: {
    type: Date,
    required: true,
  },
  timeTaken: {
    type: Number, // in seconds
    required: true,
  },
  score: {
    type: Number,
    default: 0,
  },
  totalPoints: {
    type: Number,
    required: true,
  },
  percentage: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['auto-graded', 'pending-manual-grading', 'graded', 'in-progress'], // NEW: in-progress
    default: 'in-progress',
  },
  gradedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
  },
  gradedAt: {
    type: Date,
  },
  feedback: {
    type: String,
    default: '',
  },
  // NEW: Track custom question set order used
  questionSetOrderUsed: {
    type: [Number],
    validate: {
      validator: function(arr) {
        if (!arr || arr.length === 0) return true;
        if (arr.length !== 4) return false;
        const sorted = [...arr].sort();
        return sorted.join(',') === '1,2,3,4';
      },
      message: 'questionSetOrderUsed must contain [1,2,3,4] in any order'
    }
  },
}, {
  timestamps: true,
});
QuizSubmissionSchema.index({ quizId: 1, quizTakerId: 1 }, { unique: true, partialFilterExpression: { status: 'in-progress' } });

// Calculate percentage before saving
QuizSubmissionSchema.pre('save', function() {
  if (this.totalPoints > 0) {
    this.percentage = Math.round((this.score / this.totalPoints) * 100);
  }
  
  // Calculate percentage for each question set submission
  if (this.questionSetSubmissions && this.questionSetSubmissions.length > 0) {
    this.questionSetSubmissions.forEach(qss => {
      if (qss.totalPoints > 0) {
        qss.percentage = Math.round((qss.score / qss.totalPoints) * 100);
      }
    });
  }
});

QuizSubmissionSchema.pre('save', function() {
  // Check for duplicate questionSetOrders
  const questionSetOrders = this.questionSetSubmissions.map(qss => qss.questionSetOrder);
  const uniqueOrders = [...new Set(questionSetOrders)];
  
  if (questionSetOrders.length !== uniqueOrders.length) {
    return new Error('Duplicate question set submissions detected');
  }
  
  // Validate that we don't have more than 4 question sets
  if (this.questionSetSubmissions.length > 4) {
    return new Error('Cannot have more than 4 question set submissions');
  }
});

QuizSubmissionSchema.pre('save', function() {
  const answeredQuestionSets = [...new Set(this.answers.map(a => a.questionSetOrder))];
  const submittedQuestionSets = this.questionSetSubmissions.map(qss => qss.questionSetOrder);
  
  // Every answered question set should have a submission record
  for (const order of answeredQuestionSets) {
    if (!submittedQuestionSets.includes(order)) {
      console.warn(`Missing question set submission for order ${order}`);
    }
  }
  
});

// Helper method to get question set scores
QuizSubmissionSchema.methods.getQuestionSetScores = function() {
  return this.questionSetSubmissions.map(qss => ({
    questionSetOrder: qss.questionSetOrder,
    score: qss.score,
    totalPoints: qss.totalPoints,
    percentage: qss.percentage,
    orderAnswered: qss.orderAnswered,
    submittedAt: qss.submittedAt,
  }));
};

module.exports = mongoose.model('QuizSubmission', QuizSubmissionSchema);