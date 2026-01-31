const express = require('express');
const router = express.Router();
const { verifyQuizTaker } = require('../middleware/auth');
const prisma = require('../utils/database');

// @route   GET /api/scholarswager/subjects
// @desc    Get all available subjects (question sets)
// @access  Private
router.get('/subjects', async (req, res) => {
  try {
    // Changed from: QuestionSet.find({ isActive: true, questionCount: { $gt: 0 } })
    const questionSets = await prisma.questionSet.findMany({
      where: { 
        isActive: true,
        questionCount: { gt: 0 }
      },
      select: {
        id: true,
        title: true,
        questionCount: true
      },
      orderBy: { title: 'asc' }
    });

    // Map to subject format for frontend
    const subjects = questionSets.map(qs => ({
      id: qs.id,
      name: qs.title,
      questionCount: qs.questionCount
    }));

    res.json({
      success: true,
      subjects,
    });
  } catch (error) {
    console.error("Error fetching subjects:", error);
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
router.post('/start', async (req, res) => {
  try {
    const { questionSetId, userId } = req.body;

    if (!questionSetId) {
      return res.status(400).json({
        success: false,
        message: 'Question set ID is required',
      });
    }

    // Changed from: QuestionSet.findOne({ _id: questionSetId, isActive: true })
    const questionSet = await prisma.questionSet.findFirst({
      where: {
        id: questionSetId,
        isActive: true,
      },
      include: {
        questions: {
          where: {
            type: 'multiple-choice', // Only get multiple-choice questions
            isArchived: false
          }
        }
      }
    });

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: 'Question set not found or inactive',
      });
    }

    // Filter only multiple-choice questions for Scholar's Wager
    const mcQuestions = questionSet.questions;

    if (mcQuestions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No multiple-choice questions found in this question set',
      });
    }

    // Check if user has an active session
    // Changed from: GameSession.findOne({ userId, status: 'active', gameType: 'scholars-wager' })
    const existingSession = await prisma.gameSession.findFirst({
      where: {
        userId: userId,
        status: 'active',
        gameType: 'scholars-wager',
      }
    });

    if (existingSession) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active game session',
        sessionId: existingSession.id,
      });
    }

    // Create new game session
    // Changed from: new GameSession({ ... }).save()
    const gameSession = await prisma.gameSession.create({
      data: {
        userId: userId,
        questionSetId: questionSet.id,
        subject: questionSet.title,
        gameType: 'scholars-wager',
      }
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
    console.error("Error starting game session:", error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/scholars-wager/session/:sessionId/question
// @desc    Get next question for the game
// @access  Private
router.get('/session/:sessionId/question', async (req, res) => {
  try {
    // Changed from: GameSession.findOne({ _id: req.params.sessionId })
    const gameSession = await prisma.gameSession.findUnique({
      where: {
        id: req.params.sessionId,
      },
      include: {
        usedQuestions: {
          select: {
            questionId: true
          }
        }
      }
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

    // Changed from: QuestionSet.findById()
    const questionSet = await prisma.questionSet.findUnique({
      where: { id: gameSession.questionSetId },
      include: {
        questions: {
          where: {
            type: 'multiple-choice',
            isArchived: false
          }
        }
      }
    });

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: 'Question set not found',
      });
    }

    // Get only multiple-choice questions that haven't been used
    const usedQuestionIds = gameSession.usedQuestions.map(uq => uq.questionId);
    
    const availableQuestions = questionSet.questions.filter(q => 
      !usedQuestionIds.includes(q.id)
    );

    if (availableQuestions.length === 0) {
      // No more questions - game over
      const finalStatus = gameSession.currentScore >= gameSession.goalScore ? 'won' : 'lost';
      
      // Update game session
      const updatedSession = await prisma.gameSession.update({
        where: { id: req.params.sessionId },
        data: {
          status: finalStatus,
          completedAt: new Date()
        }
      });

      return res.json({
        success: true,
        message: 'No more questions available',
        gameOver: true,
        finalScore: updatedSession.currentScore,
        status: updatedSession.status,
      });
    }

    // Randomly select a question
    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    const selectedQuestion = availableQuestions[randomIndex];

    res.json({
      success: true,
      question: {
        id: selectedQuestion.id,
        text: selectedQuestion.question,
        options: selectedQuestion.options,
      },
      currentScore: gameSession.currentScore,
      goalScore: gameSession.goalScore,
      questionsAnswered: gameSession.questionsAnswered,
      questionsRemaining: availableQuestions.length,
    });
  } catch (error) {
    console.error("Error getting question:", error);
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
router.post('/session/:sessionId/answer', async (req, res) => {
  try {
    const { questionId, selectedAnswer, wager, userId } = req.body;

    // Validation
    if (!questionId || selectedAnswer === undefined || !wager) {
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

    // Changed from: GameSession.findOne({ _id: req.params.sessionId })
    const gameSession = await prisma.gameSession.findUnique({
      where: {
        id: req.params.sessionId,
      },
      include: {
        usedQuestions: {
          select: {
            questionId: true
          }
        }
      }
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
        message: 'Game is not active',
      });
    }

    // Check if user has enough points to wager
    if (gameSession.currentScore < wager) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient points to make this wager',
      });
    }

    // Get the question
    // Changed from: questionSet.questions.id(questionId)
    const question = await prisma.question.findUnique({
      where: { id: questionId }
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    // Check if question was already answered
    const usedQuestionIds = gameSession.usedQuestions.map(uq => uq.questionId);
    
    if (usedQuestionIds.includes(questionId)) {
      return res.status(400).json({
        success: false,
        message: 'Question already answered',
      });
    }

    // Check answer
    const isCorrect = selectedAnswer === question.correctAnswer;
    
    // Calculate points change
    let pointsChange;
    if (isCorrect) {
      // Correct answer: gain points based on wager
      pointsChange = wager === 10 ? 10 : 2.5; // 100% return for confident, 50% for unsure
    } else {
      // Wrong answer: lose the wagered amount
      pointsChange = -wager;
    }

    const newScore = gameSession.currentScore + pointsChange;
    const newQuestionsAnswered = gameSession.questionsAnswered + 1;
    const newCorrectAnswers = isCorrect ? gameSession.correctAnswers + 1 : gameSession.correctAnswers;

    // Determine new status
    let newStatus = 'active';
    let completedAt = null;
    
    if (newScore >= gameSession.goalScore) {
      newStatus = 'won';
      completedAt = new Date();
    } else if (newScore < 5) {
      // Can't make minimum wager anymore
      newStatus = 'lost';
      completedAt = new Date();
    }

    // Calculate duration if game is ending
    let duration = null;
    if (completedAt) {
      const startTime = new Date(gameSession.startedAt);
      duration = Math.floor((completedAt - startTime) / 1000); // Duration in seconds
    }

    // Update game session using transaction
    // Changed from: updating arrays and calling .save()
    const updatedSession = await prisma.$transaction(async (tx) => {
      // Add to used questions
      await tx.gameUsedQuestion.create({
        data: {
          gameSessionId: req.params.sessionId,
          questionId: questionId
        }
      });

      // Add to history
      await tx.gameHistory.create({
        data: {
          gameSessionId: req.params.sessionId,
          questionId: questionId,
          question: question.question,
          selectedAnswer: selectedAnswer.toString(),
          correctAnswer: question.correctAnswer,
          wager: wager,
          isCorrect: isCorrect,
          pointsChange: Math.round(pointsChange * 100) / 100, // Round to 2 decimals
        }
      });

      // Update session
      return tx.gameSession.update({
        where: { id: req.params.sessionId },
        data: {
          currentScore: Math.round(newScore * 100) / 100, // Round to 2 decimals
          questionsAnswered: newQuestionsAnswered,
          correctAnswers: newCorrectAnswers,
          status: newStatus,
          ...(completedAt && { completedAt }),
          ...(duration !== null && { duration })
        }
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
    console.error("Error submitting answer:", error);
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
router.get('/session/:sessionId', async (req, res) => {
  try {
    // Changed from: GameSession.findOne({ _id: req.params.sessionId })
    const gameSession = await prisma.gameSession.findUnique({
      where: {
        id: req.params.sessionId,
      },
      include: {
        usedQuestions: {
          include: {
            question: {
              select: {
                question: true,
                type: true
              }
            }
          }
        },
        history: {
          orderBy: {
            timestamp: 'asc'
          }
        }
      }
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
    console.error("Error fetching game session:", error);
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
router.post('/session/:sessionId/quit', async (req, res) => {
  try {
    // Changed from: GameSession.findOne({ _id, userId, status })
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        id: req.params.sessionId,
        userId: req.userId,
        status: 'active',
      }
    });

    if (!gameSession) {
      return res.status(404).json({
        success: false,
        message: 'Active game session not found',
      });
    }

    // Changed from: gameSession.status = 'abandoned'; gameSession.save()
    await prisma.gameSession.update({
      where: { id: req.params.sessionId },
      data: {
        status: 'abandoned',
        completedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Game abandoned',
    });
  } catch (error) {
    console.error("Error quitting game:", error);
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
router.get('/leaderboard', async (req, res) => {
  try {
    const { limit = 10, subject } = req.query;

    const where = { status: 'won' };
    if (subject) where.subject = subject;

    // Changed from: GameSession.find().populate().sort().limit()
    const topScores = await prisma.gameSession.findMany({
      where,
      include: {
        user: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: [
        { currentScore: 'desc' },
        { duration: 'asc' }
      ],
      take: parseInt(limit)
    });

    res.json({
      success: true,
      leaderboard: topScores.map((session, index) => ({
        rank: index + 1,
        player: session.user.name || session.user.email,
        score: session.currentScore,
        subject: session.subject,
        questionsAnswered: session.questionsAnswered,
        accuracy: session.questionsAnswered > 0 
          ? ((session.correctAnswers / session.questionsAnswered) * 100).toFixed(1) 
          : '0.0',
        duration: session.duration,
      })),
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
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
router.get('/history', async (req, res) => {
  try {
    const { limit = 10, status } = req.query;

    const where = { userId: req.user.id }; // Changed from: req.user._id
    if (status) where.status = status;

    // Changed from: GameSession.find().sort().limit().select()
    const history = await prisma.gameSession.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit),
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
        // Exclude history field for list view
      }
    });

    res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("Error fetching game history:", error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

module.exports = router;