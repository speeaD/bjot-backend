const express = require('express');
const router = express.Router();
const { verifyQuizTaker } = require('../middleware/auth'); // Your auth middleware
const GameSession = require('../models/GameSession');
const QuestionSet = require('../models/QuestionSet');


// @route   GET /api/scholarswager/subjects
// @desc    Get all available subjects (question sets)
// @access  Private
router.get('/subjects', async (req, res) => {
  try {
    const questionSets = await QuestionSet.find({ 
      isActive: true,
      questionCount: { $gt: 0 }
    })
    .select('title questionCount')
    .sort({ title: 1 });

    // Map to subject format for frontend
    const subjects = questionSets.map(qs => ({
      id: qs._id,
      name: qs.title,
      questionCount: qs.questionCount
    }));

    res.json({
      success: true,
      subjects,
    });
  } catch (error) {
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

    const questionSet = await QuestionSet.findOne({
      _id: questionSetId,
      isActive: true,
    });

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: 'Question set not found or inactive',
      });
    }

    // Filter only multiple-choice questions for Scholar's Wager
    const mcQuestions = questionSet.questions.filter(q => q.type === 'multiple-choice');

    if (mcQuestions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No multiple-choice questions found in this question set',
      });
    }

    // Check if user has an active session
    const existingSession = await GameSession.findOne({
      userId: userId,
      status: 'active',
      gameType: 'scholars-wager',
    });

    if (existingSession) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active game session',
        sessionId: existingSession._id,
      });
    }

    // Create new game session
    const gameSession = new GameSession({
      userId: userId,
      questionSetId: questionSet._id,
      subject: questionSet.title,
    });

    await gameSession.save();

    res.status(201).json({
      success: true,
      message: 'Game session started',
      session: {
        id: gameSession._id,
        subject: gameSession.subject,
        currentScore: gameSession.currentScore,
        goalScore: gameSession.goalScore,
        totalQuestions: mcQuestions.length,
      },
    });
  } catch (error) {
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
    const gameSession = await GameSession.findOne({
      _id: req.params.sessionId,
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

    const questionSet = await QuestionSet.findById(gameSession.questionSetId);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: 'Question set not found',
      });
    }

    // Get only multiple-choice questions that haven't been used
    const availableQuestions = questionSet.questions.filter(q => 
      q.type === 'multiple-choice' && 
      !gameSession.usedQuestionIds.includes(q._id)
    );

    if (availableQuestions.length === 0) {
      // No more questions - game over
      gameSession.status = gameSession.currentScore >= gameSession.goalScore ? 'won' : 'lost';
      gameSession.completedAt = new Date();
      await gameSession.save();

      return res.json({
        success: true,
        message: 'No more questions available',
        gameOver: true,
        finalScore: gameSession.currentScore,
        status: gameSession.status,
      });
    }

    // Randomly select a question
    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    const selectedQuestion = availableQuestions[randomIndex];

    res.json({
      success: true,
      question: {
        id: selectedQuestion._id,
        text: selectedQuestion.question,
        options: selectedQuestion.options,
      },
      currentScore: gameSession.currentScore,
      goalScore: gameSession.goalScore,
      questionsAnswered: gameSession.questionsAnswered,
      questionsRemaining: availableQuestions.length,
    });
  } catch (error) {
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

    const gameSession = await GameSession.findOne({
      _id: req.params.sessionId,
      userId: userId,
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

    const questionSet = await QuestionSet.findById(gameSession.questionSetId);
    const question = questionSet.questions.id(questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    // Check if question was already answered
    if (gameSession.usedQuestionIds.includes(questionId)) {
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

    // Update game session
    gameSession.currentScore += pointsChange;
    gameSession.questionsAnswered += 1;
    if (isCorrect) gameSession.correctAnswers += 1;
    gameSession.usedQuestionIds.push(questionId);
    
    // Add to history
    gameSession.history.push({
      questionId,
      question: question.question,
      selectedAnswer,
      correctAnswer: question.correctAnswer,
      wager,
      isCorrect,
      pointsChange,
    });

    // Check win/loss conditions
    if (gameSession.currentScore >= gameSession.goalScore) {
      gameSession.status = 'won';
      gameSession.completedAt = new Date();
    } else if (gameSession.currentScore < 5) {
      // Can't make minimum wager anymore
      gameSession.status = 'lost';
      gameSession.completedAt = new Date();
    }

    await gameSession.save();

    res.json({
      success: true,
      result: {
        isCorrect,
        correctAnswer: question.correctAnswer,
        pointsChange,
        newScore: gameSession.currentScore,
        status: gameSession.status,
      },
      gameOver: gameSession.status !== 'active',
    });
  } catch (error) {
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
    const gameSession = await GameSession.findOne({
      _id: req.params.sessionId,
      userId: req.params.userId,
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
    const gameSession = await GameSession.findOne({
      _id: req.params.sessionId,
      userId: req.userId,
      status: 'active',
    });

    if (!gameSession) {
      return res.status(404).json({
        success: false,
        message: 'Active game session not found',
      });
    }

    gameSession.status = 'abandoned';
    gameSession.completedAt = new Date();
    await gameSession.save();

    res.json({
      success: true,
      message: 'Game abandoned',
    });
  } catch (error) {
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

    const filter = { status: 'won' };
    if (subject) filter.subject = subject;

    const topScores = await GameSession.find(filter)
      .populate('userId', 'name email') // Adjust fields based on your User model
      .sort({ currentScore: -1, duration: 1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      leaderboard: topScores.map((session, index) => ({
        rank: index + 1,
        player: session.userId.name,
        score: session.currentScore,
        subject: session.subject,
        questionsAnswered: session.questionsAnswered,
        accuracy: ((session.correctAnswers / session.questionsAnswered) * 100).toFixed(1),
        duration: session.duration,
      })),
    });
  } catch (error) {
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

    const filter = { userId: req.user._id };
    if (status) filter.status = status;

    const history = await GameSession.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('-history'); // Exclude detailed history for list view

    res.json({
      success: true,
      history,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

module.exports = router;