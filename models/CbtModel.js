const express = require("express");
const router = express.Router();
const QuestionSet = require("./QuestionSet");
const QuizTaker = require("./QuizTaker");
const mongoose = require('mongoose');

// Create a simple CBT Submission schema
const CBTSubmissionSchema = new mongoose.Schema({
  quizTakerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizTaker',
    required: true,
  },
  questionSets: [{
    questionSetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionSet',
      required: true,
    },
    title: String,
    order: Number,
  }],
  answers: [{
    questionId: mongoose.Schema.Types.ObjectId,
    questionSetId: mongoose.Schema.Types.ObjectId,
    answer: mongoose.Schema.Types.Mixed,
    isCorrect: Boolean,
    pointsAwarded: Number,
    pointsPossible: Number,
  }],
  score: {
    type: Number,
    default: 0,
  },
  totalPoints: {
    type: Number,
    default: 0,
  },
  percentage: {
    type: Number,
    default: 0,
  },
  startedAt: {
    type: Date,
    required: true,
  },
  submittedAt: {
    type: Date,
  },
  timeTaken: {
    type: Number, // in seconds
    default: 0,
  },
}, { timestamps: true });

CBTSubmissionSchema.virtual('percentageValue').get(function() {
  return this.totalPoints > 0 ? Math.round((this.score / this.totalPoints) * 100) : 0;
});

const CBTSubmission = mongoose.model('CBTSubmission', CBTSubmissionSchema);