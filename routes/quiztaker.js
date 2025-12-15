const express = require("express");
const router = express.Router();
const { verifyQuizTaker } = require("../middleware/auth");
const QuizTaker = require("../models/QuizTaker");
const Quiz = require("../models/Quiz");
const QuizSubmission = require("../models/QuizSubmission");

// @route   GET /api/quiztaker/dashboard
// @desc    Get quiz taker dashboard data
// @access  Private (Quiz taker only)
router.get("/dashboard", verifyQuizTaker, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.quizTaker._id)
      .select("-password")
      .populate("assignedQuizzes.quizId", "settings")
      .populate("assignedQuizzes.submissionId");

    res.json({
      success: true,
      quizTaker: {
        id: quizTaker._id,
        email: quizTaker.email,
        accessCode: quizTaker.accessCode,
        assignedQuizzes: quizTaker.assignedQuizzes,
        createdAt: quizTaker.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/profile
// @desc    Get quiz taker profile
// @access  Private (Quiz taker only)
router.get("/profile", verifyQuizTaker, async (req, res) => {
  try {
    const quizTaker = req.quizTaker;

    const completedCount = quizTaker.assignedQuizzes.filter(
      (aq) => aq.status === "completed"
    ).length;

    res.json({
      success: true,
      profile: {
        id: quizTaker._id,
        email: quizTaker.email,
        accessCode: quizTaker.accessCode,
        totalQuizzesAssigned: quizTaker.assignedQuizzes.length,
        completedQuizzes: completedCount,
        memberSince: quizTaker.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/quiz/:quizId
// @desc    Get quiz details (without answers)
// @access  Private (Quiz taker only)
router.get("/quiz/:quizId", verifyQuizTaker, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.quizTaker._id);

    // Check if quiz is assigned to this quiz taker
    const assignedQuiz = quizTaker.assignedQuizzes.find(
      (aq) => aq.quizId.toString() === req.params.quizId
    );

    if (!assignedQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not assigned to you",
      });
    }

    // Check if already completed
    if (assignedQuiz.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "You have already completed this quiz",
      });
    }

    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    if (!quiz.isActive) {
      return res.status(400).json({
        success: false,
        message: "This quiz is not currently active",
      });
    }

    // Return quiz without correct answers
    const questionsWithoutAnswers = quiz.questions.map((q) => ({
      _id: q._id,
      type: q.type,
      question: q.question,
      options: q.options,
      points: q.points,
      order: q.order,
    }));

    res.json({
      success: true,
      quiz: {
        _id: quiz._id,
        settings: quiz.settings,
        questions: questionsWithoutAnswers,
        totalPoints: quiz.totalPoints,
      },
      assignmentStatus: assignedQuiz.status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/quiztaker/quiz/:quizId/start
// @desc    Start a quiz (marks as in-progress)
// @access  Private (Quiz taker only)
router.post("/quiz/:quizId/start", verifyQuizTaker, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.quizTaker._id);

    const assignedQuiz = quizTaker.assignedQuizzes.find(
      (aq) => aq.quizId.toString() === req.params.quizId
    );

    if (!assignedQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not assigned to you",
      });
    }

    if (assignedQuiz.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "You have already completed this quiz",
      });
    }

    if (assignedQuiz.status === "in-progress") {
      return res.json({
        success: true,
        message: "Quiz already in progress",
        startedAt: assignedQuiz.startedAt,
      });
    }

    // Mark as in-progress
    assignedQuiz.status = "in-progress";
    assignedQuiz.startedAt = new Date();

    await quizTaker.save();

    res.json({
      success: true,
      message: "Quiz started successfully",
      startedAt: assignedQuiz.startedAt,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/quiztaker/quiz/:quizId/submit
// @desc    Submit quiz answers
// @access  Private (Quiz taker only)
// Fixed submit route
router.post("/quiz/:quizId/submit", verifyQuizTaker, async (req, res) => {
  try {
    const { answers } = req.body;
    // answers format: [{ questionId, answer }]

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "Please provide answers array",
      });
    }

    const quizTaker = await QuizTaker.findById(req.quizTaker._id);

    const assignedQuiz = quizTaker.assignedQuizzes.find(
      (aq) => aq.quizId.toString() === req.params.quizId
    );

    if (!assignedQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not assigned to you",
      });
    }

    if (assignedQuiz.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "You have already completed this quiz",
      });
    }

    if (assignedQuiz.status !== "in-progress") {
      return res.status(400).json({
        success: false,
        message: "You must start the quiz before submitting",
      });
    }

    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Grade the submission
    const gradedAnswers = [];
    let totalScore = 0;
    let hasEssayQuestions = false;

    answers.forEach((submittedAnswer) => {
      const question = quiz.questions.id(submittedAnswer.questionId);

      if (!question) return;

      const answerObj = {
        questionId: question._id,
        questionType: question.type,
        answer: submittedAnswer.answer,
        pointsPossible: question.points,
        pointsAwarded: 0,
        isCorrect: null,
      };

      // Auto-grade based on question type
      switch (question.type) {
        case "multiple-choice":
          const correctOptionLetter = question.correctAnswer; // e.g., "C"

          let optionsArray;
          if (Array.isArray(question.options)) {
            optionsArray = question.options;
          } else if (typeof question.options === "string") {
            optionsArray = question.options.split("|");
          } else {
            optionsArray = Object.values(question.options);
          }

          // Find the option that starts with the correct letter
          const correctOption = optionsArray.find((opt) =>
            String(opt)
              .trim()
              .startsWith(correctOptionLetter + ".")
          );

          console.log("=== MULTIPLE CHOICE DEBUG ===");
          console.log("Correct option (full):", correctOption);
          console.log("Submitted answer:", submittedAnswer.answer);
          console.log("Match?", submittedAnswer.answer === correctOption);
          console.log("============================");

          // Compare the full option text
          if (submittedAnswer.answer === correctOption) {
            answerObj.isCorrect = true;
            answerObj.pointsAwarded = question.points;
            totalScore += question.points;
          } else {
            answerObj.isCorrect = false;
          }
          break;

        case "true-false":
          console.log("=== TRUE-FALSE DEBUG ===");
          console.log("Question:", question.question);
          console.log("Correct answer:", question.correctAnswer);
          console.log("Submitted answer:", submittedAnswer.answer);
          console.log(
            "Match?",
            String(submittedAnswer.answer).toLowerCase() ===
              String(question.correctAnswer).toLowerCase()
          );
          console.log("=======================");

          if (
            String(submittedAnswer.answer).toLowerCase() ===
            String(question.correctAnswer).toLowerCase()
          ) {
            answerObj.isCorrect = true;
            answerObj.pointsAwarded = question.points;
            totalScore += question.points;
          } else {
            answerObj.isCorrect = false;
          }
          break;

        case "fill-in-the-blanks":
          const submittedAns = String(submittedAnswer.answer)
            .trim()
            .toLowerCase();
          const correctAns = String(question.correctAnswer)
            .trim()
            .toLowerCase();

          console.log("=== FILL-IN-BLANKS DEBUG ===");
          console.log("Question:", question.question);
          console.log("Correct answer (processed):", correctAns);
          console.log("Submitted answer (processed):", submittedAns);
          console.log("Match?", submittedAns === correctAns);
          console.log("============================");

          if (submittedAns === correctAns) {
            answerObj.isCorrect = true;
            answerObj.pointsAwarded = question.points;
            totalScore += question.points;
          } else {
            answerObj.isCorrect = false;
          }
          break;

        case "essay":
          answerObj.isCorrect = null;
          hasEssayQuestions = true;
          break;
      }

      gradedAnswers.push(answerObj);
    });

    // Calculate time taken
    const startTime = new Date(assignedQuiz.startedAt);
    const endTime = new Date();
    const timeTaken = Math.floor((endTime - startTime) / 1000); // in seconds

    // Create submission
    const submission = new QuizSubmission({
      quizId: quiz._id,
      quizTakerId: quizTaker._id,
      answers: gradedAnswers,
      startedAt: assignedQuiz.startedAt,
      submittedAt: endTime,
      timeTaken,
      score: totalScore,
      totalPoints: quiz.totalPoints,
      status: hasEssayQuestions ? "pending-manual-grading" : "auto-graded",
    });

    await submission.save();

    // Update quiz taker status
    assignedQuiz.status = "completed";
    assignedQuiz.completedAt = endTime;
    assignedQuiz.submissionId = submission._id;

    // IMPORTANT: Mark the subdocument array as modified for Mongoose to save it
    quizTaker.markModified("assignedQuizzes");

    await quizTaker.save();

    return res.json({
      success: true,
      message: "Quiz submitted successfully",
      submission: {
        id: submission._id,
        score: submission.score,
        totalPoints: submission.totalPoints,
        percentage: submission.percentage,
        timeTaken: submission.timeTaken,
        status: submission.status,
      },
    });
  } catch (error) {
    console.error("Submit quiz error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/submission/:submissionId
// @desc    Get submission results
// @access  Private (Quiz taker only)
router.get("/submission/:submissionId", verifyQuizTaker, async (req, res) => {
  try {
    const submission = await QuizSubmission.findById(
      req.params.submissionId
    ).populate("quizId");

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found",
      });
    }

    // Verify submission belongs to this quiz taker
    if (submission.quizTakerId.toString() !== req.quizTaker._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const quiz = submission.quizId;

    // Check quiz settings for what to show
    const canViewAnswers = quiz.settings.viewAnswer;
    const canViewResults = quiz.settings.viewResults;

    if (!canViewResults) {
      return res.status(403).json({
        success: false,
        message: "Results viewing is not allowed for this quiz",
      });
    }

    let responseData = {
      success: true,
      submission: {
        id: submission._id,
        score: submission.score,
        totalPoints: submission.totalPoints,
        percentage: submission.percentage,
        timeTaken: submission.timeTaken,
        submittedAt: submission.submittedAt,
        status: submission.status,
        feedback: submission.feedback,
      },
    };

    // Include answers if allowed
    if (canViewAnswers) {
      responseData.submission.answers = submission.answers.map((answer) => {
        const question = quiz.questions.id(answer.questionId);
        return {
          question: question.question,
          type: answer.questionType,
          yourAnswer: answer.answer,
          correctAnswer: question.correctAnswer,
          isCorrect: answer.isCorrect,
          pointsAwarded: answer.pointsAwarded,
          pointsPossible: answer.pointsPossible,
        };
      });
    }

    res.json(responseData);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/my-submissions
// @desc    Get all submissions by this quiz taker
// @access  Private (Quiz taker only)
router.get("/my-submissions", verifyQuizTaker, async (req, res) => {
  try {
    const submissions = await QuizSubmission.find({
      quizTakerId: req.quizTaker._id,
    })
      .populate("quizId", "settings.title settings.isQuizChallenge")
      .sort({ submittedAt: -1 });

    res.json({
      success: true,
      count: submissions.length,
      submissions: submissions.map((sub) => ({
        id: sub._id,
        quizTitle: sub.quizId.settings.title,
        score: sub.score,
        totalPoints: sub.totalPoints,
        percentage: sub.percentage,
        submittedAt: sub.submittedAt,
        status: sub.status,
      })),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;
