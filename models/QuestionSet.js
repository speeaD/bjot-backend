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
}, { _id: true });

const QuestionSetSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  questions: [QuestionSchema],
  totalPoints: {
    type: Number,
    default: 0,
  },
  questionCount: {
    type: Number,
    default: 0,
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
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update totalPoints and questionCount before saving
QuestionSetSchema.pre('save', function() {
  if (this.questions && this.questions.length > 0) {
    this.totalPoints = this.questions.reduce((sum, q) => sum + (q.points || 0), 0);
    this.questionCount = this.questions.length;
  }
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('QuestionSet', QuestionSetSchema);