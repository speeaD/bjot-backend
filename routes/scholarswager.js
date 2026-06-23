const express = require('express');
const router = express.Router();
const { verifyQuizTaker } = require('../middleware/auth');
const prisma = require('../utils/database');

// @route   GET /api/scholarswager/subjects
// @desc    Get all available subjects (question sets)
// @access  Private
router.get('/subjects', verifyQuizTaker, async (req, res) => {
  try {
    const questionSets = await prisma.questionSet.findMany({
      where: {
        isActive: true,
        questionCount: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        questionCount: true,
        totalPoints: true,
      },
      orderBy: { title: 'asc' },
    });

    const subjects = questionSets.map(qs => ({
      id: qs.id,
      name: qs.title,
      questionCount: qs.questionCount,
      totalPoints: qs.totalPoints,
    }));

    res.json({
      success: true,
      subjects,
    });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   POST /api/scholars-wager/start
// @desc    Start a new game session
// @access  Private
router.post('/start', verifyQuizTaker, async (req, res) => {
  try {
    const { questionSetId } = req.body;
    // BUG FIX: Use req.user.id from middleware consistently — do not accept
    // userId from req.body (that's an insecure, client-supplied value).
    const userId = req.user.id;

    if (!questionSetId) {
      return res.status(400).json({
        success: false,
        message: 'Question set ID is required',
      });
    }

    // BUG FIX: Removed `isArchived: false` filter — that field does not exist
    // on the QuestionSet/Question schema. Filtering by it causes silent failures
    // or Prisma errors in strict mode.
    const questionSet = await prisma.questionSet.findFirst({
      where: {
        id: questionSetId,
        isActive: true,
      },
      include: {
        questions: {
          where: {
            type: 'multiple-choice',
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: 'Question set not found or inactive',
      });
    }

    const mcQuestions = questionSet.questions;

    if (mcQuestions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No multiple-choice questions found in this question set',
      });
    }

    // Check if user already has an active session
    const existingSession = await prisma.gameSession.findFirst({
      where: {
        userId,
        status: 'active',
        gameType: 'scholars-wager',
      },
    });

    if (existingSession) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active game session',
        sessionId: existingSession.id,
      });
    }

    const gameSession = await prisma.gameSession.create({
      data: {
        userId,
        questionSetId: questionSet.id,
        subject: questionSet.title,
        gameType: 'scholars-wager',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Game session started',
      session: {
        id: gameSession.id,
        subject: gameSession.subject,
        currentScore: gameSession.currentScore,
        goalScore: gameSession.goalScore,
        totalQuestions: mcQuestions.length,
      },
    });
  } catch (error) {
    console.error('Error starting game session:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/scholars-wager/session/:sessionId/question
// @desc    Get the next batch of available questions for the game session
// @access  Private
//
// CHANGED: Now returns the full batch of remaining (unanswered) questions
// instead of a single randomly selected one. Each question includes `id`,
// `text`, `options`, `type`, `order`, and `points` — matching the
// QuestionSet schema shape. The client is responsible for selecting/displaying
// one question at a time; this avoids an extra round-trip per question and
// aligns with the batch format used elsewhere in the app.
router.get('/session/:sessionId/question', verifyQuizTaker, async (req, res) => {
  try {
    const gameSession = await prisma.gameSession.findUnique({
      where: { id: req.params.sessionId },
      include: {
        usedQuestions: {
          select: { questionId: true },
        },
      },
    });

    if (!gameSession) {
      return res.status(404).json({
        success: false,
        message: 'Game session not found',
      });
    }

    if (gameSession.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Game is already ${gameSession.status}`,
      });
    }

    // BUG FIX: Removed `isArchived: false` — field does not exist on schema.
    const questionSet = await prisma.questionSet.findUnique({
      where: { id: gameSession.questionSetId },
      include: {
        questions: {
          where: { type: 'multiple-choice' },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: 'Question set not found',
      });
    }

    const usedQuestionIds = gameSession.usedQuestions.map(uq => uq.questionId);

    const availableQuestions = questionSet.questions.filter(
      q => !usedQuestionIds.includes(q.id)
    );

    if (availableQuestions.length === 0) {
      const finalStatus =
        gameSession.currentScore >= gameSession.goalScore ? 'won' : 'lost';

      const updatedSession = await prisma.gameSession.update({
        where: { id: req.params.sessionId },
        data: {
          status: finalStatus,
          completedAt: new Date(),
        },
      });

      return res.json({
        success: true,
        message: 'No more questions available',
        gameOver: true,
        finalScore: updatedSession.currentScore,
        status: updatedSession.status,
      });
    }

    // Return the full batch of remaining questions (without correctAnswer).
    // `type` and `order` are included to match the QuestionSet schema shape
    // and support any type-specific rendering the client needs.
    const batch = availableQuestions.map(q => ({
      id: q.id,
      text: q.question,
      type: q.type,
      order: q.order,
      options: q.options,
      points: q.points,
    }));

    res.json({
      success: true,
      questions: batch,
      totalRemaining: batch.length,
      currentScore: gameSession.currentScore,
      goalScore: gameSession.goalScore,
      questionsAnswered: gameSession.questionsAnswered,
    });
  } catch (error) {
    console.error('Error getting questions:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   POST /api/scholars-wager/session/:sessionId/answer
// @desc    Submit answer with wager
// @access  Private
router.post('/session/:sessionId/answer', verifyQuizTaker, async (req, res) => {
  try {
    const { questionId, selectedAnswer, wager } = req.body;
    // BUG FIX: userId sourced from auth middleware, not req.body.
    const userId = req.user.id;

    if (!questionId || selectedAnswer === undefined || wager === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Question ID, answer, and wager are required',
      });
    }

    if (![5, 10].includes(wager)) {
      return res.status(400).json({
        success: false,
        message: 'Wager must be either 5 or 10 points',
      });
    }

    const gameSession = await prisma.gameSession.findUnique({
      where: { id: req.params.sessionId },
      include: {
        usedQuestions: {
          select: { questionId: true },
        },
      },
    });

    if (!gameSession) {
      return res.status(404).json({
        success: false,
        message: 'Game session not found',
      });
    }

    // BUG FIX: Verify the session belongs to the authenticated user to
    // prevent one user submitting answers on another user's session.
    if (gameSession.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    if (gameSession.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Game is not active',
      });
    }

    if (gameSession.currentScore < wager) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient points to make this wager',
      });
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    const usedQuestionIds = gameSession.usedQuestions.map(uq => uq.questionId);

    if (usedQuestionIds.includes(questionId)) {
      return res.status(400).json({
        success: false,
        message: 'Question already answered',
      });
    }

    // BUG FIX: Normalize both sides to strings before comparing. The schema
    // stores correctAnswer as Mixed (can be string, number, or boolean), and
    // selectedAnswer arrives as whatever the client sends. Strict equality
    // (`===`) causes false negatives for values like true vs "true" or 1 vs "1".
    const isCorrect =
      String(selectedAnswer).trim() === String(question.correctAnswer).trim();

    // BUG FIX: Wager payout was asymmetric — wager of 5 only returned 2.5 on
    // a correct answer but still deducted the full 5 on a wrong answer.
    // Corrected to a symmetric scheme:
    //   - Wager 10 (confident): gain 10 on correct, lose 10 on wrong.
    //   - Wager  5 (unsure):    gain  5 on correct, lose  5 on wrong.
    // If you intentionally want a reduced payout for the low-confidence wager,
    // reinstate the asymmetry here and document it clearly in the UI.
    let pointsChange;
    if (isCorrect) {
      pointsChange = wager; // Symmetric: gain exactly what you wagered
    } else {
      pointsChange = -wager;
    }

    const newScore = gameSession.currentScore + pointsChange;
    const newQuestionsAnswered = gameSession.questionsAnswered + 1;
    const newCorrectAnswers = isCorrect
      ? gameSession.correctAnswers + 1
      : gameSession.correctAnswers;

    let newStatus = 'active';
    let completedAt = null;

    if (newScore >= gameSession.goalScore) {
      newStatus = 'won';
      completedAt = new Date();
    } else if (newScore < 5) {
      // Can't afford the minimum wager anymore
      newStatus = 'lost';
      completedAt = new Date();
    }

    let duration = null;
    if (completedAt) {
      const startTime = new Date(gameSession.startedAt);
      duration = Math.floor((completedAt - startTime) / 1000);
    }

    const updatedSession = await prisma.$transaction(async tx => {
      await tx.gameUsedQuestion.create({
        data: {
          gameSessionId: req.params.sessionId,
          questionId,
        },
      });

      await tx.gameHistory.create({
        data: {
          gameSessionId: req.params.sessionId,
          questionId,
          question: question.question,
          selectedAnswer: String(selectedAnswer),
          correctAnswer: String(question.correctAnswer),
          wager,
          isCorrect,
          pointsChange: Math.round(pointsChange * 100) / 100,
        },
      });

      return tx.gameSession.update({
        where: { id: req.params.sessionId },
        data: {
          currentScore: Math.round(newScore * 100) / 100,
          questionsAnswered: newQuestionsAnswered,
          correctAnswers: newCorrectAnswers,
          status: newStatus,
          ...(completedAt && { completedAt }),
          ...(duration !== null && { duration }),
        },
      });
    });

    res.json({
      success: true,
      result: {
        isCorrect,
        correctAnswer: question.correctAnswer,
        pointsChange: Math.round(pointsChange * 100) / 100,
        newScore: updatedSession.currentScore,
        status: updatedSession.status,
      },
      gameOver: updatedSession.status !== 'active',
    });
  } catch (error) {
    console.error('Error submitting answer:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/scholars-wager/session/:sessionId
// @desc    Get current session details
// @access  Private
router.get('/session/:sessionId', verifyQuizTaker, async (req, res) => {
  try {
    const gameSession = await prisma.gameSession.findUnique({
      where: { id: req.params.sessionId },
      include: {
        usedQuestions: {
          include: {
            question: {
              select: {
                question: true,
                type: true,
              },
            },
          },
        },
        history: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!gameSession) {
      return res.status(404).json({
        success: false,
        message: 'Game session not found',
      });
    }

    res.json({
      success: true,
      session: gameSession,
    });
  } catch (error) {
    console.error('Error fetching game session:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   POST /api/scholars-wager/session/:sessionId/quit
// @desc    Quit/abandon current game
// @access  Private
router.post('/session/:sessionId/quit', verifyQuizTaker, async (req, res) => {
  try {
    // BUG FIX: Was using req.userId (undefined) instead of req.user.id.
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        id: req.params.sessionId,
        userId: req.user.id,
        status: 'active',
      },
    });

    if (!gameSession) {
      return res.status(404).json({
        success: false,
        message: 'Active game session not found',
      });
    }

    await prisma.gameSession.update({
      where: { id: req.params.sessionId },
      data: {
        status: 'abandoned',
        completedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Game abandoned',
    });
  } catch (error) {
    console.error('Error quitting game:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/scholars-wager/leaderboard
// @desc    Get leaderboard
// @access  Private
router.get('/leaderboard', verifyQuizTaker, async (req, res) => {
  try {
    const { limit = 10, subject } = req.query;

    const where = { status: 'won' };
    if (subject) where.subject = subject;

    const topScores = await prisma.gameSession.findMany({
      where,
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: [{ currentScore: 'desc' }, { duration: 'asc' }],
      take: parseInt(limit, 10),
    });

    res.json({
      success: true,
      leaderboard: topScores.map((session, index) => ({
        rank: index + 1,
        player: session.user.name || session.user.email,
        score: session.currentScore,
        subject: session.subject,
        questionsAnswered: session.questionsAnswered,
        accuracy:
          session.questionsAnswered > 0
            ? ((session.correctAnswers / session.questionsAnswered) * 100).toFixed(1)
            : '0.0',
        duration: session.duration,
      })),
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/scholars-wager/history
// @desc    Get user's game history
// @access  Private
router.get('/history', verifyQuizTaker, async (req, res) => {
  try {
    const { limit = 10, status } = req.query;

    // BUG FIX: Was `req.user.id` in one place and `req.userId` / `req.body.userId`
    // in others. Standardized to `req.user.id` set by verifyQuizTaker middleware.
    const where = { userId: req.user.id };
    if (status) where.status = status;

    const history = await prisma.gameSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      select: {
        id: true,
        userId: true,
        gameType: true,
        questionSetId: true,
        subject: true,
        currentScore: true,
        goalScore: true,
        questionsAnswered: true,
        correctAnswers: true,
        status: true,
        duration: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

module.exports = router;