const mongoose = require("mongoose");

const QuizQuestionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["multiple-choice", "essay", "true-false", "fill-in-the-blanks"],
      required: true,
    },
    question: {
      type: String,
      required: true,
    },
    passage: {
      type: String,
      default: "",
      trim: true,
    },
    diagram: {
      type: String, // URL to image (e.g. Cloudinary, S3, or your own storage)
      default: null,
    },
    diagramAlt: {
      type: String,
      default: "",
      trim: true,
    },
    options: [
      {
        type: String,
      },
    ],
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
    },
  },
  { _id: true },
);

const QuizQuestionSetSchema = new mongoose.Schema(
  {
    questionSetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QuestionSet",
      required: true,
    },
    // NEW: Batch information
    batchNumber: {
      type: Number,
      min: 1,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    batchName: {
      type: String,
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
    },
  },
  { _id: true },
);

const QuizSchema = new mongoose.Schema({
  settings: {
    examType: {
      type: String,
      enum: ["multi-subject", "single-subject"],
      default: "multi-subject",
    },
    coverImage: {
      type: String,
      default: "",
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
    isOpenQuiz: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      default: "",
    },
    instructions: {
      type: String,
      default: "",
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
      validator: function (v) {
      if (this.settings?.examType === 'single-subject') return v.length === 1;
      return v.length === 4;
    },
    message: 'A multi-subject quiz must have 4 question sets; a single-subject quiz must have 1',
    },
  },

  questionSetCombination: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: "QuestionSet",
    validate: {
     validator: function (v) {
      if (this.settings?.examType === 'single-subject') return v.length === 1;
      return v.length === 4;
    },
    message: 'Question set combination must contain 1 (single-subject) or 4 (multi-subject) question sets',
    },
  },

  // NEW: Track batch configuration used in this quiz
  batchConfiguration: [
    {
      questionSetId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "QuestionSet",
      },
      batchNumber: {
        type: Number,
        min: 1,
      },
      order: {
        type: Number,
        min: 1,
        max: 4,
      },
    },
  ],

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
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
QuizSchema.pre("save", function () {
  if (this.questionSets && this.questionSets.length > 0) {
    // Calculate total points from all question sets
    this.totalPoints = this.questionSets.reduce((sum, qs) => {
      const setTotal = qs.questions.reduce(
        (qSum, q) => qSum + (q.points || 0),
        0,
      );
      qs.totalPoints = setTotal;
      return sum + setTotal;
    }, 0);

    // Update questionSetCombination (just the base IDs, not batch info)
    this.questionSetCombination = this.questionSets.map(
      (qs) => qs.questionSetId,
    );

    // Update batchConfiguration
    this.batchConfiguration = this.questionSets.map((qs) => ({
      questionSetId: qs.questionSetId,
      batchNumber: qs.batchNumber || null,
      order: qs.order,
    }));
  }
  this.updatedAt = Date.now();
});

// Calculate total duration in seconds
QuizSchema.methods.getTotalDurationInSeconds = function () {
  const { hours, minutes, seconds } = this.settings.duration;
  return hours * 3600 + minutes * 60 + seconds;
};

// Helper method to get batch info for a specific question set order
QuizSchema.methods.getBatchInfo = function (order) {
  const questionSet = this.questionSets.find((qs) => qs.order === order);
  if (!questionSet) return null;

  return {
    questionSetId: questionSet.questionSetId,
    batchNumber: questionSet.batchNumber,
    batchName: questionSet.batchName,
    title: questionSet.title,
  };
};

module.exports = mongoose.model("Quiz", QuizSchema);
