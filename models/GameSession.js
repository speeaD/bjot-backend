const mongoose = require('mongoose');

const GameHistorySchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  question: String,
  selectedAnswer: String,
  correctAnswer: mongoose.Schema.Types.Mixed,
  wager: {
    type: Number,
    enum: [5, 10],
    required: true,
  },
  isCorrect: Boolean,
  pointsChange: Number,
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const GameSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // or 'Student' based on your user model
    required: true,
  },
  gameType: {
    type: String,
    default: 'scholars-wager',
  },
  questionSetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuestionSet',
    required: true,
  },
  subject: {
    type: String,
    required: true,
  },
  currentScore: {
    type: Number,
    default: 100,
  },
  goalScore: {
    type: Number,
    default: 1000,
  },
  questionsAnswered: {
    type: Number,
    default: 0,
  },
  correctAnswers: {
    type: Number,
    default: 0,
  },
  usedQuestionIds: [{
    type: mongoose.Schema.Types.ObjectId,
  }],
  status: {
    type: String,
    enum: ['active', 'won', 'lost', 'abandoned'],
    default: 'active',
  },
  history: [GameHistorySchema],
  startedAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: Date,
  duration: Number, // in seconds
}, {
  timestamps: true,
});

// Calculate duration before saving when completed
GameSessionSchema.pre('save', function() {
  if (this.completedAt && !this.duration) {
    this.duration = Math.floor((this.completedAt - this.startedAt) / 1000);
  }
});

module.exports = mongoose.model('GameSession', GameSessionSchema);