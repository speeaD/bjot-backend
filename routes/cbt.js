const express = require("express");
const router = express.Router();
const QuestionSet = require("../models/QuestionSet");
const QuizTaker = require("../models/QuizTaker");
const CBTSubmission = require("../models/CbtModel");
const mongoose = require("mongoose");

// @route   GET /api/cbt/question-sets
// @desc    Get all active question sets (subjects) for selection
// @access  Public or with optional auth
router.get("/question-sets", async (req, res) => {
  try {
    const questionSets = await QuestionSet.find({ isActive: true })
      .select("title questionCount totalPoints")
      .sort({ title: 1 });

    res.json({
      success: true,
      count: questionSets.length,
      questionSets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/cbt/start-session
// @desc    Start a new CBT session with selected question sets
// @access  Public or with optional auth
router.post("/start-session", async (req, res) => {
  try {
    const { questionSetIds, email } = req.body;

    if (
      !questionSetIds ||
      !Array.isArray(questionSetIds) ||
      questionSetIds.length !== 4
    ) {
      return res.status(400).json({
        success: false,
        message: "Please select exactly 4 question sets",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Verify all question sets exist and are active
    const questionSets = await QuestionSet.find({
      _id: { $in: questionSetIds },
      isActive: true,
    });

    if (questionSets.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "One or more selected question sets are invalid or inactive",
      });
    }

    // Find or create quiz taker
    let quizTaker = await QuizTaker.findOne({
      email: email.toLowerCase(),
      accountType: "premium",
    });

    if (!quizTaker) {
      quizTaker = new QuizTaker({
        email: email.toLowerCase().trim(),
        accountType: "premium",
        questionSetCombination: questionSetIds,
        isActive: true,
      });

      try {
        await quizTaker.save();
      } catch (saveError) {
        // If duplicate key error on email, try to find again
        if (saveError.code === 11000) {
          quizTaker = await QuizTaker.findOne({
            email: email.toLowerCase().trim(),
            accountType: "premium",
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

      const currentCombo = JSON.stringify(
        quizTaker.questionSetCombination.map((id) => id.toString()).sort(),
      );
      const newCombo = JSON.stringify(
        questionSetIds.map((id) => id.toString()).sort(),
      );

      if (currentCombo !== newCombo) {
        quizTaker.questionSetCombination = questionSetIds;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await quizTaker.save();
      }
    }

    // Create session data
    const sessionData = {
      sessionId: new mongoose.Types.ObjectId().toString(),
      quizTakerId: quizTaker._id,
      questionSets: questionSets.map((qs, index) => ({
        questionSetId: qs._id,
        title: qs.title,
        order: index + 1,
        questionCount: qs.questionCount,
        totalPoints: qs.totalPoints,
      })),
      startedAt: new Date(),
    };

    res.json({
      success: true,
      message: "CBT session started successfully",
      session: sessionData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/cbt/question-set/:id/questions
// @desc    Get questions for a specific question set (without answers)
// @access  Public
router.get("/question-set/:id/questions", async (req, res) => {
  try {
    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    if (!questionSet.isActive) {
      return res.status(400).json({
        success: false,
        message: "This question set is not active",
      });
    }

    // Remove correct answers from questions
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
        totalPoints: questionSet.totalPoints,
        questionCount: questionSet.questionCount,
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

// @route   POST /api/cbt/submit
// @desc    Submit CBT answers
// @access  Public
router.post("/submit", async (req, res) => {
  try {
    const { quizTakerId, answers, questionSetIds, startedAt } = req.body;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "Answers are required",
      });
    }

    if (!questionSetIds || questionSetIds.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "Invalid question sets",
      });
    }

    // Fetch all question sets with answers
    const questionSets = await QuestionSet.find({
      _id: { $in: questionSetIds },
    });

    // Grade the answers
    const gradedAnswers = [];
    let totalScore = 0;
    let totalPoints = 0;

    questionSets.forEach((questionSet) => {
      totalPoints += questionSet.totalPoints;

      questionSet.questions.forEach((question) => {
        const submittedAnswer = answers.find(
          (ans) => ans.questionId === question._id.toString(),
        );

        if (!submittedAnswer) return;

        console.log("Grading question:", {
          questionId: question._id,
          type: question.type,
          correctAnswer: question.correctAnswer,
          submittedAnswer: submittedAnswer.answer,
        });

        const answerObj = {
          questionId: question._id,
          questionSetId: questionSet._id,
          answer: submittedAnswer.answer,
          pointsPossible: question.points,
          pointsAwarded: 0,
          isCorrect: false,
        };

        // Grade based on question type
        switch (question.type) {
          case "multiple-choice":
            // Direct comparison of answer text
            if (
              submittedAnswer.answer.trim() === question.correctAnswer.trim()
            ) {
              answerObj.isCorrect = true;
              answerObj.pointsAwarded = question.points;
              totalScore += question.points;
            }
            break;

          case "true-false":
            if (
              String(submittedAnswer.answer).toLowerCase() ===
              String(question.correctAnswer).toLowerCase()
            ) {
              answerObj.isCorrect = true;
              answerObj.pointsAwarded = question.points;
              totalScore += question.points;
            }
            break;

          case "fill-in-the-blanks":
            const submittedAns = String(submittedAnswer.answer)
              .trim()
              .toLowerCase();
            const correctAns = String(question.correctAnswer)
              .trim()
              .toLowerCase();
            if (submittedAns === correctAns) {
              answerObj.isCorrect = true;
              answerObj.pointsAwarded = question.points;
              totalScore += question.points;
            }
            break;

          case "essay":
            // Essays need manual grading
            answerObj.isCorrect = null;
            break;
        }

        gradedAnswers.push(answerObj);
      });
    });

    console.log("Grading results:", {
      totalScore,
      totalPoints,
      percentage:
        totalPoints > 0 ? Math.round((totalScore / totalPoints) * 100) : 0,
    });

    // Create submission record
    const submission = new CBTSubmission({
      quizTakerId,
      questionSets: questionSets.map((qs, index) => ({
        questionSetId: qs._id,
        title: qs.title,
        order: index + 1,
      })),
      answers: gradedAnswers,
      score: totalScore,
      totalPoints,
      percentage:
        totalPoints > 0 ? Math.round((totalScore / totalPoints) * 100) : 0,
      startedAt: new Date(startedAt),
      submittedAt: new Date(),
      timeTaken: Math.floor((new Date() - new Date(startedAt)) / 1000),
    });

    await submission.save();

    // Update quiz taker's record
    if (quizTakerId) {
      await QuizTaker.findByIdAndUpdate(quizTakerId, {
        $push: {
          quizzesTaken: {
            score: totalScore,
            totalPoints: totalPoints,
            percentage:
              totalPoints > 0
                ? Math.round((totalScore / totalPoints) * 100)
                : 0,
            timeTaken: Math.floor((new Date() - new Date(startedAt)) / 1000),
            examType: "multi-subject",
            questionSets: questionSets.map((qs) => ({
              questionSetId: qs._id,
              title: qs.title,
            })),
            completedAt: new Date(),
          },
        },
      });
    }

    res.json({
      success: true,
      message: "CBT submitted successfully",
      submission: {
        id: submission._id,
        score: submission.score,
        totalPoints: submission.totalPoints,
        percentage: submission.percentage,
        timeTaken: submission.timeTaken,
        submittedAt: submission.submittedAt,
      },
    });
  } catch (error) {
    console.error("Submit error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});
// @route   POST /api/cbt/start-single-subject
// @desc    Start a single subject exam
// @access  Public
router.post("/start-single-subject", async (req, res) => {
  try {
    const { questionSetId, email } = req.body;

    if (!questionSetId) {
      return res.status(400).json({
        success: false,
        message: "Please select a question set",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Verify question set exists and is active
    const questionSet = await QuestionSet.findById(questionSetId);

    if (!questionSet || !questionSet.isActive) {
      return res.status(400).json({
        success: false,
        message: "Question set is invalid or inactive",
      });
    }

    let quizTaker = await QuizTaker.findOne({
      email: email.toLowerCase(),
      accountType: "premium",
    });

    if (!quizTaker) {
      quizTaker = new QuizTaker({
        email: email.toLowerCase().trim(),
        accountType: "premium",
        isActive: true,
      });

      try {
        await quizTaker.save();
      } catch (saveError) {
        // If duplicate key error on email, try to find again
        if (saveError.code === 11000) {
          quizTaker = await QuizTaker.findOne({
            email: email.toLowerCase().trim(),
            accountType: "premium",
          });

          if (!quizTaker) {
            throw new Error("Failed to create or find quiz taker");
          }
        } else {
          throw saveError;
        }
      }
    }

    // Create session data
    const sessionData = {
      sessionId: new mongoose.Types.ObjectId().toString(),
      quizTakerId: quizTaker._id,
      examType: "single-subject",
      questionSet: {
        questionSetId: questionSet._id,
        title: questionSet.title,
        questionCount: questionSet.questionCount,
        totalPoints: questionSet.totalPoints,
      },
      startedAt: new Date(),
    };

    res.json({
      success: true,
      message: "Single subject exam started successfully",
      session: sessionData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/cbt/submit-single-subject
// @desc    Submit single subject exam answers
// @access  Public
router.post("/submit-single-subject", async (req, res) => {
  try {
    const { sessionId, quizTakerId, answers, questionSetId, startedAt } =
      req.body;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "Answers are required",
      });
    }

    if (!questionSetId) {
      return res.status(400).json({
        success: false,
        message: "Invalid question set",
      });
    }

    // Fetch question set with answers
    const questionSet = await QuestionSet.findById(questionSetId);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    // Grade the answers
    const gradedAnswers = [];
    let totalScore = 0;
    const totalPoints = questionSet.totalPoints;

    questionSet.questions.forEach((question) => {
      const submittedAnswer = answers.find(
        (ans) => ans.questionId === question._id.toString(),
      );

      if (!submittedAnswer) return;

      const answerObj = {
        questionId: question._id,
        questionSetId: questionSet._id,
        answer: submittedAnswer.answer,
        pointsPossible: question.points,
        pointsAwarded: 0,
        isCorrect: false,
      };

      // Grade based on question type
      switch (question.type) {
        case "multiple-choice":
            // Direct comparison of answer text
            if (
              submittedAnswer.answer.trim() === question.correctAnswer.trim()
            ) {
              answerObj.isCorrect = true;
              answerObj.pointsAwarded = question.points;
              totalScore += question.points;
            }
            break;

        case "true-false":
          if (
            String(submittedAnswer.answer).toLowerCase() ===
            String(question.correctAnswer).toLowerCase()
          ) {
            answerObj.isCorrect = true;
            answerObj.pointsAwarded = question.points;
            totalScore += question.points;
          }
          break;

        case "fill-in-the-blanks":
          const submittedAns = String(submittedAnswer.answer)
            .trim()
            .toLowerCase();
          const correctAns = String(question.correctAnswer)
            .trim()
            .toLowerCase();
          if (submittedAns === correctAns) {
            answerObj.isCorrect = true;
            answerObj.pointsAwarded = question.points;
            totalScore += question.points;
          }
          break;

        case "essay":
          answerObj.isCorrect = null;
          break;
      }

      gradedAnswers.push(answerObj);
    });

    // Create submission record
    const submission = new CBTSubmission({
      quizTakerId,
      examType: "single-subject",
      questionSets: [
        {
          questionSetId: questionSet._id,
          title: questionSet.title,
          order: 1,
        },
      ],
      answers: gradedAnswers,
      score: totalScore,
      totalPoints,
      percentage:
        totalPoints > 0 ? Math.round((totalScore / totalPoints) * 100) : 0,
      startedAt: new Date(startedAt),
      submittedAt: new Date(),
      timeTaken: Math.floor((new Date() - new Date(startedAt)) / 1000),
    });

    await submission.save();

    // Update quiz taker's record
    if (quizTakerId) {
      await QuizTaker.findByIdAndUpdate(quizTakerId, {
        $push: {
          quizzesTaken: {
            score: totalScore,
            totalPoints: totalPoints,
            percentage:
              totalPoints > 0
                ? Math.round((totalScore / totalPoints) * 100)
                : 0,
            timeTaken: Math.floor((new Date() - new Date(startedAt)) / 1000),
            examType: "single-subject", // or 'multi-subject'
            questionSets: [
              {
                questionSetId: questionSet._id,
                title: questionSet.title,
              },
            ],
            completedAt: new Date(),
          },
        },
      });
    }

    res.json({
      success: true,
      message: "Single subject exam submitted successfully",
      submission: {
        id: submission._id,
        score: submission.score,
        totalPoints: submission.totalPoints,
        percentage: submission.percentage,
        timeTaken: submission.timeTaken,
        submittedAt: submission.submittedAt,
      },
    });
  } catch (error) {
    console.error("Submit error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;
