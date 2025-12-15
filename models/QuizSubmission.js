const mongoose = require('mongoose');

const AnswerSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
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
    enum: ['auto-graded', 'pending-manual-grading', 'graded'],
    default: 'auto-graded',
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
}, {
  timestamps: true,
});

// Calculate percentage before saving
QuizSubmissionSchema.pre('save', function() {
  if (this.totalPoints > 0) {
    this.percentage = Math.round((this.score / this.totalPoints) * 100);
  }
});

module.exports = mongoose.model('QuizSubmission', QuizSubmissionSchema);