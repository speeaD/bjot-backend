const express = require("express");
const router = express.Router();
const Quiz = require("../models/Quiz");
const QuizTaker = require("../models/QuizTaker");
const QuizSubmission = require("../models/QuizSubmission");

// @route   POST /api/public/quiz/available
// @desc    Get available open quizzes by question set combination
// @access  Public
router.post("/available", async (req, res) => {
  try {
    const { questionSetCombination } = req.body;

    if (
      !questionSetCombination ||
      !Array.isArray(questionSetCombination) ||
      questionSetCombination.length !== 4
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a valid question set combination (array of 4 question set IDs)",
      });
    }

    // Find all active open quizzes with the exact question set combination
    const quizzes = await Quiz.find({
      "settings.isOpenQuiz": true,
      isActive: true,
      questionSetCombination: {
        $size: 4,
        $all: questionSetCombination,
      },
    })
      .select(
        "settings.title settings.description settings.coverImage settings.duration totalPoints questionSetCombination"
      )
      .populate("questionSetCombination", "title")
      .sort({ createdAt: -1 });

    // Filter to ensure exact match (order doesn't matter, but all 4 must match)
    const exactMatchQuizzes = quizzes.filter((quiz) => {
      const quizCombo = quiz.questionSetCombination
        .map((qs) => qs._id.toString())
        .sort();
      const userCombo = questionSetCombination
        .map((id) => id.toString())
        .sort();
      return JSON.stringify(quizCombo) === JSON.stringify(userCombo);
    });

    res.json({
      success: true,
      count: exactMatchQuizzes.length,
      quizzes: exactMatchQuizzes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/public/quiz/:quizId
// @desc    Get quiz details (without answers) for regular students
// @access  Public
router.get("/:quizId", async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.quizId).populate(
      "questionSetCombination",
      "title"
    );

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    if (!quiz.isActive || !quiz.settings.isOpenQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not available",
      });
    }

    // Return quiz without answers
    const questionSetsOverview = quiz.questionSets.map((qs) => ({
      _id: qs._id,
      questionSetId: qs.questionSetId,
      title: qs.title,
      order: qs.order,
      totalPoints: qs.totalPoints,
      questionCount: qs.questions.length,
    }));

    res.json({
      success: true,
      quiz: {
        _id: quiz._id,
        settings: quiz.settings,
        questionSets: questionSetsOverview,
        totalPoints: quiz.totalPoints,
        questionSetCombination: quiz.questionSetCombination,
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

// @route   GET /api/public/quiz/:quizId/question-set/:questionSetOrder
// @desc    Get specific question set questions (without answers)
// @access  Public
router.get("/:quizId/question-set/:questionSetOrder", async (req, res) => {
  try {
    const questionSetOrder = parseInt(req.params.questionSetOrder);

    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    if (!quiz.isActive || !quiz.settings.isOpenQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not available",
      });
    }

    const questionSet = quiz.questionSets.find(
      (qs) => qs.order === questionSetOrder
    );

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    const questionsWithoutAnswers = questionSet.questions.map((q) => ({
      _id: q._id,
      type: q.type,
      question: q.question,
      options: q.options,
      points: q.points,
      order: q.order,
    }));

    res.json({
      success: true,
      questionSet: {
        _id: questionSet._id,
        title: questionSet.title,
        order: questionSet.order,
        totalPoints: questionSet.totalPoints,
        questions: questionsWithoutAnswers,
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

// @route   POST /api/public/quiz/:quizId/submit
// @desc    Submit quiz as regular student
// @access  Public
router.post("/:quizId/submit", async (req, res) => {
  try {
    const {
      email,
      name,
      questionSetCombination,
      answers = [], // Default to empty array
      timeTaken = 0,
      submissionType = "manual", // 'manual', 'timeout', 'focus-loss'
    } = req.body;

    // Validation - only require email, name, and questionSetCombination
    if (!email || !name || !questionSetCombination) {
      return res.status(400).json({
        success: false,
        message: "Please provide email, name, and question set combination",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    if (
      !Array.isArray(questionSetCombination) ||
      questionSetCombination.length !== 4
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Question set combination must contain exactly 4 question sets",
      });
    }

    // Validate answers is an array (can be empty)
    if (!Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "Answers must be an array",
      });
    }

    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    if (!quiz.isActive || !quiz.settings.isOpenQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not available",
      });
    }

    // Verify question set combination matches
    const quizCombo = quiz.questionSetCombination
      .map((id) => id.toString())
      .sort();
    const userCombo = questionSetCombination.map((id) => id.toString()).sort();

    if (JSON.stringify(quizCombo) !== JSON.stringify(userCombo)) {
      return res.status(400).json({
        success: false,
        message: "Question set combination does not match this quiz",
      });
    }

    let quizTaker = await QuizTaker.findOne({
      email: email.toLowerCase().trim(),
      accountType: "regular",
    });

    if (!quizTaker) {
      // Create new regular student WITHOUT accessCode
      quizTaker = new QuizTaker({
        accountType: "regular",
        email: email.toLowerCase().trim(),
        name: name.trim(),
        questionSetCombination,
        isActive: true,
        // DO NOT set accessCode for regular students
      });

      try {
        await quizTaker.save();
      } catch (saveError) {
        // If duplicate key error on email, try to find again
        if (saveError.code === 11000) {
          quizTaker = await QuizTaker.findOne({
            email: email.toLowerCase().trim(),
            accountType: "regular",
          });

          if (!quizTaker) {
            throw new Error("Failed to create or find quiz taker");
          }
        } else {
          throw saveError;
        }
      }
    } else {
      // Update existing quiz taker
      let needsUpdate = false;

      if (quizTaker.name !== name.trim()) {
        quizTaker.name = name.trim();
        needsUpdate = true;
      }

      const currentCombo = JSON.stringify(
        quizTaker.questionSetCombination.map((id) => id.toString()).sort()
      );
      const newCombo = JSON.stringify(
        questionSetCombination.map((id) => id.toString()).sort()
      );

      if (currentCombo !== newCombo) {
        quizTaker.questionSetCombination = questionSetCombination;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await quizTaker.save();
      }
    }

    // Check for multiple attempts BEFORE processing submission
    if (!quiz.settings.multipleAttempts) {
      const existingSubmission = await QuizSubmission.findOne({
        quizId: quiz._id,
        quizTakerId: quizTaker._id,
      });

      if (existingSubmission) {
        return res.status(400).json({
          success: false,
          message:
            "You have already submitted this quiz. Multiple attempts are not allowed.",
        });
      }
    }

    // Create a map of submitted answers for quick lookup
    const submittedAnswersMap = new Map();
    if (answers && answers.length > 0) {
      answers.forEach((ans) => {
        if (ans.questionId) {
          submittedAnswersMap.set(ans.questionId.toString(), ans.answer);
        }
      });
    }

    const gradedAnswers = [];
    let totalScore = 0;
    let hasEssayQuestions = false;
    let totalQuestionsAnswered = 0;

    // Process ALL questions in the quiz
    quiz.questionSets.forEach((qs) => {
      qs.questions.forEach((question) => {
        const questionId = question._id.toString();
        const submittedAnswer = submittedAnswersMap.get(questionId);

        const answerObj = {
          questionId: question._id,
          questionSetOrder: qs.order,
          questionType: question.type,
          answer: submittedAnswer !== undefined ? submittedAnswer : null,
          pointsPossible: question.points,
          pointsAwarded: 0,
          isCorrect: null,
        };

        // Check if answer was provided and is not empty
        const hasAnswer =
          submittedAnswer !== undefined &&
          submittedAnswer !== null &&
          submittedAnswer !== "" &&
          !(Array.isArray(submittedAnswer) && submittedAnswer.length === 0);

        if (hasAnswer) {
          totalQuestionsAnswered++;

          // Auto-grade based on question type
          switch (question.type) {
            case "multiple-choice":
              const correctOptionLetter = question.correctAnswer;
              let optionsArray;

              if (Array.isArray(question.options)) {
                optionsArray = question.options;
              } else if (typeof question.options === "string") {
                optionsArray = question.options.split("|");
              } else {
                optionsArray = Object.values(question.options);
              }

              const correctOption = optionsArray.find((opt) =>
                String(opt)
                  .trim()
                  .startsWith(correctOptionLetter + ".")
              );

              if (submittedAnswer === correctOption) {
                answerObj.isCorrect = true;
                answerObj.pointsAwarded = question.points;
                totalScore += question.points;
              } else {
                answerObj.isCorrect = false;
                answerObj.pointsAwarded = 0;
              }
              break;

            case "true-false":
              if (
                String(submittedAnswer).toLowerCase() ===
                String(question.correctAnswer).toLowerCase()
              ) {
                answerObj.isCorrect = true;
                answerObj.pointsAwarded = question.points;
                totalScore += question.points;
              } else {
                answerObj.isCorrect = false;
                answerObj.pointsAwarded = 0;
              }
              break;

            case "fill-in-the-blanks":
              const submittedAns = String(submittedAnswer).trim().toLowerCase();
              const correctAns = String(question.correctAnswer)
                .trim()
                .toLowerCase();

              if (submittedAns === correctAns) {
                answerObj.isCorrect = true;
                answerObj.pointsAwarded = question.points;
                totalScore += question.points;
              } else {
                answerObj.isCorrect = false;
                answerObj.pointsAwarded = 0;
              }
              break;

            case "essay":
              answerObj.isCorrect = null; // Needs manual grading
              answerObj.pointsAwarded = 0;
              hasEssayQuestions = true;
              break;
          }
        } else {
          // No answer provided - mark as unanswered
          if (question.type === "essay") {
            answerObj.isCorrect = null;
            hasEssayQuestions = true;
          } else {
            answerObj.isCorrect = false;
          }
          answerObj.pointsAwarded = 0;
        }

        gradedAnswers.push(answerObj);
      });
    });

    // Calculate total questions
    const totalQuestions = quiz.questionSets.reduce(
      (sum, qs) => sum + qs.questions.length,
      0
    );

    // Calculate start time based on time taken
    const startedAt = new Date(Date.now() - timeTaken * 1000);
    const submittedAt = new Date();

    // Create submission
    const submission = new QuizSubmission({
      quizId: quiz._id,
      quizTakerId: quizTaker._id,
      answers: gradedAnswers,
      questionSetSubmissions: [],
      startedAt: startedAt,
      submittedAt: submittedAt,
      timeTaken: timeTaken,
      score: totalScore,
      totalPoints: quiz.totalPoints,
      status: hasEssayQuestions ? "pending-manual-grading" : "auto-graded",
      questionSetOrderUsed: [1, 2, 3, 4], // Regular students answer in order
    });

    // Calculate question set scores
    quiz.questionSets.forEach((qs, index) => {
      const qsAnswers = gradedAnswers.filter(
        (ans) => ans.questionSetOrder === qs.order
      );
      const qsScore = qsAnswers.reduce(
        (sum, ans) => sum + ans.pointsAwarded,
        0
      );

      submission.questionSetSubmissions.push({
        questionSetOrder: qs.order,
        submittedAt: submittedAt,
        score: qsScore,
        totalPoints: qs.totalPoints,
        orderAnswered: index + 1,
      });
    });

    await submission.save();

    // Update quiz taker's quizzesTaken
    quizTaker.quizzesTaken.push({
      quizId: quiz._id,
      score: totalScore,
      completedAt: submittedAt,
    });
    await quizTaker.save();

    // Prepare response with submission details
    const responseData = {
      success: true,
      message:
        totalQuestionsAnswered === totalQuestions
          ? "Quiz submitted successfully"
          : "Quiz submitted successfully (partial submission)",
      submission: {
        id: submission._id,
        score: submission.score,
        totalPoints: submission.totalPoints,
        percentage: submission.percentage,
        timeTaken: submission.timeTaken,
        status: submission.status,
        questionsAnswered: totalQuestionsAnswered,
        totalQuestions: totalQuestions,
        submissionType: submissionType,
      },
    };

    // Add warning if submission was incomplete
    if (totalQuestionsAnswered < totalQuestions) {
      responseData.warning = `You answered ${totalQuestionsAnswered} out of ${totalQuestions} questions.`;
    }

    res.json(responseData);
  } catch (error) {
    console.error("Submit quiz error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/public/submission/:submissionId
// @desc    Get submission results for regular student
// @access  Public
router.get("/submission/:submissionId", async (req, res) => {
  try {
    const submission = await QuizSubmission.findById(req.params.submissionId)
      .populate("quizId")
      .populate("quizTakerId", "email name");

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found",
      });
    }

    // Verify this is a regular student submission
    const quizTaker = await QuizTaker.findById(submission.quizTakerId);
    if (!quizTaker || quizTaker.accountType !== "regular") {
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
        studentName: quizTaker.name,
        studentEmail: quizTaker.email,
      },
    };

    // Include answers if allowed
    if (canViewAnswers) {
      const answersByQuestionSet = {};

      submission.answers.forEach((answer) => {
        const questionSet = quiz.questionSets.find((qs) =>
          qs.questions.some(
            (q) => q._id.toString() === answer.questionId.toString()
          )
        );

        if (!questionSet) return;

        if (!answersByQuestionSet[questionSet.order]) {
          answersByQuestionSet[questionSet.order] = {
            questionSetTitle: questionSet.title,
            order: questionSet.order,
            answers: [],
          };
        }

        const question = questionSet.questions.find(
          (q) => q._id.toString() === answer.questionId.toString()
        );

        answersByQuestionSet[questionSet.order].answers.push({
          question: question.question,
          type: answer.questionType,
          yourAnswer: answer.answer,
          correctAnswer: question.correctAnswer,
          isCorrect: answer.isCorrect,
          pointsAwarded: answer.pointsAwarded,
          pointsPossible: answer.pointsPossible,
        });
      });

      responseData.submission.answersByQuestionSet = Object.values(
        answersByQuestionSet
      ).sort((a, b) => a.order - b.order);
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

module.exports = router;
