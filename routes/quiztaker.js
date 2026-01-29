const express = require("express");
const mongoose = require('mongoose');
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
// @desc    Get quiz details with all question sets (without answers)
// @access  Private (Quiz taker only)
router.get("/quiz/:quizId", verifyQuizTaker, async (req, res) => {
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
      },
      assignmentStatus: assignedQuiz.status,
      selectedQuestionSetOrder: assignedQuiz.selectedQuestionSetOrder,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/quiz/:quizId/question-set/:questionSetOrder
// @desc    Get specific question set questions (without answers)
// @access  Private (Quiz taker only)
router.get("/quiz/:quizId/question-set/:questionSetOrder", verifyQuizTaker, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.quizTaker._id);
    const questionSetOrder = parseInt(req.params.questionSetOrder);

    const assignedQuiz = quizTaker.assignedQuizzes.find(
      (aq) => aq.quizId.toString() === req.params.quizId
    );

    if (!assignedQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not assigned to you",
      });
    }

    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    const questionSet = quiz.questionSets.find(qs => qs.order === questionSetOrder);

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

// @route   POST /api/quiztaker/quiz/:quizId/set-question-order
// @desc    Set custom question set order for quiz taker
// @access  Private (Quiz taker only)
router.post("/quiz/:quizId/set-question-order", verifyQuizTaker, async (req, res) => {
  try {
    const { questionSetOrder } = req.body;

    if (!questionSetOrder || !Array.isArray(questionSetOrder) || questionSetOrder.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "questionSetOrder must be an array of 4 numbers",
      });
    }

    const sorted = [...questionSetOrder].sort();
    if (sorted.join(',') !== '1,2,3,4') {
      return res.status(400).json({
        success: false,
        message: "questionSetOrder must contain [1,2,3,4] in any order",
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
        message: "Cannot change order for completed quiz",
      });
    }

    if (assignedQuiz.status === "in-progress" && assignedQuiz.questionSetProgress) {
      const anyCompleted = assignedQuiz.questionSetProgress.some(
        qsp => qsp.status === 'completed'
      );
      
      if (anyCompleted) {
        return res.status(400).json({
          success: false,
          message: "Cannot change order after submitting question sets",
        });
      }
    }

    assignedQuiz.selectedQuestionSetOrder = questionSetOrder;
    quizTaker.initializeQuestionSetProgress(req.params.quizId);
    
    assignedQuiz.questionSetProgress.forEach(qsp => {
      const indexInCustomOrder = questionSetOrder.indexOf(qsp.questionSetOrder);
      qsp.selectedOrder = indexInCustomOrder + 1;
    });

    assignedQuiz.currentQuestionSetOrder = questionSetOrder[0];

    quizTaker.markModified("assignedQuizzes");
    await quizTaker.save();

    res.json({
      success: true,
      message: "Question set order saved successfully",
      questionSetOrder: assignedQuiz.selectedQuestionSetOrder,
      currentQuestionSetOrder: assignedQuiz.currentQuestionSetOrder,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/quiz/:quizId/progress
// @desc    Get detailed progress for a quiz
// @access  Private (Quiz taker only)
router.get("/quiz/:quizId/progress", verifyQuizTaker, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.quizTaker._id)
      .populate('assignedQuizzes.quizId', 'settings.title questionSets');

    const assignedQuiz = quizTaker.assignedQuizzes.find(
      (aq) => aq.quizId._id.toString() === req.params.quizId
    );

    if (!assignedQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not assigned to you",
      });
    }

    quizTaker.initializeQuestionSetProgress(req.params.quizId);
    await quizTaker.save();

    const quiz = assignedQuiz.quizId;
    
    const progress = {
      quizId: quiz._id,
      quizTitle: quiz.settings.title,
      status: assignedQuiz.status,
      startedAt: assignedQuiz.startedAt,
      completedAt: assignedQuiz.completedAt,
      selectedQuestionSetOrder: assignedQuiz.selectedQuestionSetOrder || [1, 2, 3, 4],
      currentQuestionSetOrder: assignedQuiz.currentQuestionSetOrder,
      questionSets: [],
      overallProgress: {
        completed: 0,
        total: 4,
        percentage: 0,
      }
    };

    const questionSetDetails = quiz.questionSets.map(qs => ({
      order: qs.order,
      title: qs.title,
      totalPoints: qs.totalPoints,
      questionCount: qs.questions.length,
    }));

    assignedQuiz.questionSetProgress.forEach(qsp => {
      const details = questionSetDetails.find(d => d.order === qsp.questionSetOrder);
      
      progress.questionSets.push({
        questionSetOrder: qsp.questionSetOrder,
        title: details?.title || 'Unknown',
        selectedOrder: qsp.selectedOrder,
        status: qsp.status,
        startedAt: qsp.startedAt,
        completedAt: qsp.completedAt,
        score: qsp.score,
        totalPoints: qsp.totalPoints || details?.totalPoints || 0,
        questionCount: details?.questionCount || 0,
        percentage: qsp.totalPoints > 0 ? Math.round((qsp.score / qsp.totalPoints) * 100) : 0,
      });
    });

    progress.questionSets.sort((a, b) => {
      if (a.selectedOrder && b.selectedOrder) {
        return a.selectedOrder - b.selectedOrder;
      }
      return a.questionSetOrder - b.questionSetOrder;
    });

    const completedCount = assignedQuiz.questionSetProgress.filter(
      qsp => qsp.status === 'completed'
    ).length;
    
    progress.overallProgress.completed = completedCount;
    progress.overallProgress.percentage = Math.round((completedCount / 4) * 100);

    res.json({
      success: true,
      progress,
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

    assignedQuiz.status = "in-progress";
    assignedQuiz.startedAt = new Date();
    
    quizTaker.initializeQuestionSetProgress(req.params.quizId);

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

// @route   POST /api/quiztaker/quiz/:quizId/question-set/:questionSetOrder/start
// @desc    Start a specific question set
// @access  Private (Quiz taker only)
router.post("/quiz/:quizId/question-set/:questionSetOrder/start", verifyQuizTaker, async (req, res) => {
  try {
    const questionSetOrder = parseInt(req.params.questionSetOrder);

    if (questionSetOrder < 1 || questionSetOrder > 4) {
      return res.status(400).json({
        success: false,
        message: "Invalid question set order (must be 1-4)",
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
        message: "Quiz already completed",
      });
    }

    quizTaker.initializeQuestionSetProgress(req.params.quizId);

    const qsProgress = assignedQuiz.questionSetProgress.find(
      qsp => qsp.questionSetOrder === questionSetOrder
    );

    if (!qsProgress) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    if (qsProgress.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: "This question set has already been completed",
      });
    }

    if (assignedQuiz.status === 'pending') {
      assignedQuiz.status = 'in-progress';
      assignedQuiz.startedAt = new Date();
    }

    if (qsProgress.status === 'not-started') {
      qsProgress.status = 'in-progress';
      qsProgress.startedAt = new Date();
    }

    assignedQuiz.currentQuestionSetOrder = questionSetOrder;

    quizTaker.markModified("assignedQuizzes");
    await quizTaker.save();

    res.json({
      success: true,
      message: "Question set started successfully",
      questionSetOrder,
      startedAt: qsProgress.startedAt,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/quiz/:quizId/next-question-set
// @desc    Get the next question set to answer based on custom order
// @access  Private (Quiz taker only)
router.get("/quiz/:quizId/next-question-set", verifyQuizTaker, async (req, res) => {
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
        message: "Quiz already completed",
      });
    }

    quizTaker.initializeQuestionSetProgress(req.params.quizId);

    const customOrder = assignedQuiz.selectedQuestionSetOrder || [1, 2, 3, 4];

    let nextQuestionSetOrder = null;
    
    for (const order of customOrder) {
      const qsProgress = assignedQuiz.questionSetProgress.find(
        qsp => qsp.questionSetOrder === order
      );
      
      if (qsProgress && qsProgress.status !== 'completed') {
        nextQuestionSetOrder = order;
        break;
      }
    }

    if (!nextQuestionSetOrder) {
      return res.json({
        success: true,
        message: "All question sets completed",
        nextQuestionSetOrder: null,
        allCompleted: true,
      });
    }

    res.json({
      success: true,
      nextQuestionSetOrder,
      allCompleted: false,
      customOrder,
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
// @desc    Submit question set answers (can be partial or final)
// @access  Private (Quiz taker only)
router.post("/quiz/:quizId/submit", verifyQuizTaker, async (req, res) => {
  // Start a session for transaction
  const session = await mongoose.startSession();
  
  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      // Start transaction
      session.startTransaction();

      const { questionSetOrder, answers, isFinalSubmission } = req.body;

      // Validation
      if (!questionSetOrder || questionSetOrder < 1 || questionSetOrder > 4) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Invalid questionSetOrder. Must be between 1 and 4",
        });
      }

      if (!answers || !Array.isArray(answers)) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Answers must be provided as an array",
        });
      }

      // 🔑 Fetch fresh documents with session
      const quizTaker = await QuizTaker.findById(req.quizTaker._id).session(session);

      const assignedQuiz = quizTaker.assignedQuizzes.find(
        (aq) => aq.quizId.toString() === req.params.quizId
      );

      if (!assignedQuiz) {
        await session.abortTransaction();
        return res.status(403).json({
          success: false,
          message: "This quiz is not assigned to you",
        });
      }

      if (assignedQuiz.status === "completed") {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "You have already completed this quiz",
        });
      }

      const quiz = await Quiz.findById(req.params.quizId).session(session);

      if (!quiz) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Quiz not found",
        });
      }

      const questionSet = quiz.questionSets.find(qs => qs.order === questionSetOrder);

      if (!questionSet) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Question set not found",
        });
      }

      // Initialize progress if needed
      if (!assignedQuiz.questionSetProgress || assignedQuiz.questionSetProgress.length === 0) {
        quizTaker.initializeQuestionSetProgress(req.params.quizId);
      }

      const qsProgress = assignedQuiz.questionSetProgress.find(
        qsp => qsp.questionSetOrder === questionSetOrder
      );

      // 🔒 CRITICAL: Prevent duplicate submissions of same question set
      if (qsProgress && qsProgress.status === 'completed') {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "This question set has already been submitted",
        });
      }

      // Start quiz if not started
      if (assignedQuiz.status === "pending") {
        assignedQuiz.status = "in-progress";
        assignedQuiz.startedAt = new Date();
      }

      // 🔑 Find ONLY in-progress submission for THIS quiz taker
      let submission = await QuizSubmission.findOne({
        quizId: quiz._id,
        quizTakerId: quizTaker._id,
        status: 'in-progress'
      }).session(session);

      const isNewSubmission = !submission;

      if (isNewSubmission) {
        // Count existing completed submissions for attempt number
        const existingSubmissionsCount = await QuizSubmission.countDocuments({
          quizId: quiz._id,
          quizTakerId: quizTaker._id,
          status: { $in: ['auto-graded', 'pending-manual-grading', 'graded'] }
        }).session(session);

        submission = new QuizSubmission({
          quizId: quiz._id,
          quizTakerId: quizTaker._id,
          answers: [],
          questionSetSubmissions: [],
          startedAt: assignedQuiz.startedAt,
          submittedAt: new Date(),
          timeTaken: 0,
          score: 0,
          totalPoints: quiz.totalPoints,
          status: 'in-progress',
          questionSetOrderUsed: assignedQuiz.selectedQuestionSetOrder || [1, 2, 3, 4],
          attemptNumber: existingSubmissionsCount + 1,
        });
      }

      // Grade answers
      const gradedAnswers = [];
      let questionSetScore = 0;
      let hasEssayQuestions = false;

      answers.forEach((submittedAnswer) => {
        const question = questionSet.questions.find(
          q => q._id.toString() === submittedAnswer.questionId
        );

        if (!question) {
          console.warn(`Question ${submittedAnswer.questionId} not found in question set ${questionSetOrder}`);
          return;
        }

        const answerObj = {
          questionId: question._id,
          questionSetOrder: questionSetOrder,
          questionType: question.type,
          answer: submittedAnswer.answer,
          pointsPossible: question.points,
          pointsAwarded: 0,
          isCorrect: null,
        };

        switch (question.type) {
          case "multiple-choice":
            if (submittedAnswer.answer.trim() === question.correctAnswer.trim()) {
              answerObj.isCorrect = true;
              answerObj.pointsAwarded = question.points;
              questionSetScore += question.points;
            } else {
              answerObj.isCorrect = false;
            }
            break;

          case "true-false":
            if (
              String(submittedAnswer.answer).toLowerCase() ===
              String(question.correctAnswer).toLowerCase()
            ) {
              answerObj.isCorrect = true;
              answerObj.pointsAwarded = question.points;
              questionSetScore += question.points;
            } else {
              answerObj.isCorrect = false;
            }
            break;

          case "fill-in-the-blanks":
            const submittedAns = String(submittedAnswer.answer).trim().toLowerCase();
            const correctAns = String(question.correctAnswer).trim().toLowerCase();

            if (submittedAns === correctAns) {
              answerObj.isCorrect = true;
              answerObj.pointsAwarded = question.points;
              questionSetScore += question.points;
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

      // 🔑 Remove old answers for this question set (prevent duplicates)
      submission.answers = submission.answers.filter(
        ans => ans.questionSetOrder !== questionSetOrder
      );

      submission.answers.push(...gradedAnswers);

      // 🔑 Update or add question set submission tracking
      const existingQSSubmission = submission.questionSetSubmissions.find(
        qss => qss.questionSetOrder === questionSetOrder
      );

      const orderAnswered = assignedQuiz.questionSetProgress.filter(
        qsp => qsp.status === 'completed'
      ).length + 1;

      if (existingQSSubmission) {
        // Update existing
        existingQSSubmission.submittedAt = new Date();
        existingQSSubmission.score = questionSetScore;
        existingQSSubmission.totalPoints = questionSet.totalPoints;
        existingQSSubmission.orderAnswered = orderAnswered;
      } else {
        // Add new (only if not exists)
        submission.questionSetSubmissions.push({
          questionSetOrder,
          submittedAt: new Date(),
          score: questionSetScore,
          totalPoints: questionSet.totalPoints,
          orderAnswered,
        });
      }

      // Calculate total score
      submission.score = submission.answers.reduce(
        (sum, answer) => sum + answer.pointsAwarded, 0
      );

      // Update question set progress
      if (qsProgress) {
        qsProgress.status = 'completed';
        qsProgress.completedAt = new Date();
        qsProgress.score = questionSetScore;
        qsProgress.totalPoints = questionSet.totalPoints;
      }

      const hasAnyEssay = submission.answers.some(ans => ans.questionType === 'essay');
      
      if (isFinalSubmission) {
        const endTime = new Date();
        const startTime = new Date(assignedQuiz.startedAt);
        submission.timeTaken = Math.floor((endTime - startTime) / 1000);
        submission.submittedAt = endTime;
        submission.status = hasAnyEssay ? "pending-manual-grading" : "auto-graded";

        assignedQuiz.status = "completed";
        assignedQuiz.completedAt = endTime;
        assignedQuiz.submissionId = submission._id;

        const quizTakenEntry = {
          quizId: quiz._id,
          score: submission.score,
          totalPoints: submission.totalPoints,
          percentage: submission.percentage,
          timeTaken: submission.timeTaken,
          examType: 'multi-subject',
          questionSets: quiz.questionSets.map(qs => ({
            questionSetId: qs.questionSetId,
            title: qs.title
          })),
          completedAt: endTime,
          attemptNumber: submission.attemptNumber || 1,
        };

        quizTaker.quizzesTaken.push(quizTakenEntry);
      }

      quizTaker.markModified("assignedQuizzes");

      // 🔑 ATOMIC: Both saves succeed or both fail
      await submission.save({ session });
      await quizTaker.save({ session });

      // Commit transaction
      await session.commitTransaction();

      // Success! Return response
      return res.json({
        success: true,
        message: isFinalSubmission ? "Quiz submitted successfully" : "Question set submitted successfully",
        submission: {
          id: submission._id,
          questionSetScore: questionSetScore,
          questionSetTotalPoints: questionSet.totalPoints,
          overallScore: submission.score,
          overallTotalPoints: submission.totalPoints,
          percentage: submission.percentage,
          timeTaken: submission.timeTaken,
          status: submission.status,
          isFinalSubmission: isFinalSubmission || false,
          attemptNumber: submission.attemptNumber,
        },
      });

    } catch (error) {
      // Abort transaction on any error
      await session.abortTransaction();

      // Check if it's a version error
      if (error.name === 'VersionError') {
        attempt++;
        console.log(`Version conflict on attempt ${attempt}/${MAX_RETRIES}, retrying...`);
        
        if (attempt >= MAX_RETRIES) {
          console.error("Max retries reached for version conflict:", error);
          await session.endSession();
          return res.status(409).json({
            success: false,
            message: "Unable to save due to concurrent updates. Please try again.",
            error: error.message,
          });
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        continue; // Retry
      }
      
      // Other errors - don't retry
      console.error("Submit quiz error:", error);
      await session.endSession();
      return res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  }

  // End session after all retries
  await session.endSession();
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

    // Include answers if allowed - organized by question set
    if (canViewAnswers) {
      const answersByQuestionSet = [];

      // Iterate through ALL question sets in the quiz (regardless of whether answered)
      for (const questionSet of quiz.questionSets) {
        const questionSetData = {
          questionSetTitle: questionSet.title,
          order: questionSet.order,
          answers: []
        };

        // Get all questions in this question set
        for (const question of questionSet.questions) {
          // Find the submitted answer for this question
          const submittedAnswer = submission.answers.find(
            ans => ans.questionId.toString() === question._id.toString()
          );

          if (submittedAnswer) {
            // Question was answered
            questionSetData.answers.push({
              question: question.question,
              type: submittedAnswer.questionType,
              yourAnswer: submittedAnswer.answer,
              correctAnswer: question.correctAnswer,
              isCorrect: submittedAnswer.isCorrect,
              pointsAwarded: submittedAnswer.pointsAwarded,
              pointsPossible: submittedAnswer.pointsPossible,
              wasAnswered: true,
            });
          } else {
            // Question was NOT answered - show as unanswered
            questionSetData.answers.push({
              question: question.question,
              type: question.type,
              yourAnswer: null,
              correctAnswer: question.correctAnswer,
              isCorrect: false,
              pointsAwarded: 0,
              pointsPossible: question.points,
              wasAnswered: false, // Flag to indicate this was not answered
            });
          }
        }

        answersByQuestionSet.push(questionSetData);
      }

      // Sort by question set order
      answersByQuestionSet.sort((a, b) => a.order - b.order);

      responseData.submission.answersByQuestionSet = answersByQuestionSet;
    }

    res.json(responseData);
  } catch (error) {
    console.error('Submission results error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});
// @route   GET /api/quiztaker/my-submissions
// @desc    Get all submissions from quizzesTaken array
// @access  Private (Quiz taker only)
router.get("/my-submissions", verifyQuizTaker, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.quizTaker._id)
      .select('quizzesTaken')
      .populate({
        path: 'quizzesTaken.quizId',
        select: 'settings.title settings.isQuizChallenge'
      });

    if (!quizTaker) {
      return res.status(404).json({
        success: false,
        message: "Quiz taker not found",
      });
    }

    // Sort by completedAt (most recent first)
    const sortedQuizzes = quizTaker.quizzesTaken
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    res.json({
      success: true,
      count: sortedQuizzes.length,
      submissions: sortedQuizzes.map((quiz) => ({
        id: quiz._id,
        quizId: quiz.quizId?._id,
        quizTitle: quiz.quizId?.settings?.title || 'CBT Exam',
        score: quiz.score || 0,
        totalPoints: quiz.totalPoints > 0 ? Math.round((quiz.score / quiz.totalPoints) * 400) : 0,
        percentage: quiz.totalPoints > 0 
          ? Math.round((quiz.score / quiz.totalPoints) * 100) 
          : 0,
        completedAt: quiz.completedAt,
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