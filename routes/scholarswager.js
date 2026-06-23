const express = require('express');
const router = express.Router();
const { verifyQuizTaker } = require('../middleware/auth');

const GameSession = require('../models/GameSession');
const QuestionSet = require('../models/QuestionSet');
const QuizTaker = require('../models/QuizTaker'); // for population if needed

// @route   GET /api/scholarswager/subjects
router.get('/subjects', verifyQuizTaker, async (req, res) => {
  try {
    const questionSets = await QuestionSet.find({
      isActive: true,
      questionCount: { $gt: 0 },
    })
      .select('title questionCount totalPoints')
      .sort({ title: 1 });

    const subjects = questionSets.map(qs => ({
      id: qs._id,
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
router.post('/start', verifyQuizTaker, async (req, res) => {
  try {
    const { questionSetId } = req.body;
    const userId = req.user.id; // from middleware

    if (!questionSetId) {
      return res.status(400).json({ success: false, message: 'Question set ID is required' });
    }

    const questionSet = await QuestionSet.findOne({
      _id: questionSetId,
      isActive: true,
    });

    if (!questionSet) {
      return res.status(404).json({ success: false, message: 'Question set not found or inactive' });
    }

    const mcQuestions = questionSet.questions.filter(q => q.type === 'multiple-choice');

    if (mcQuestions.length === 0) {
      return res.status(400).json({ success: false, message: 'No multiple-choice questions found' });
    }

    // Check for existing active session
    const existingSession = await GameSession.findOne({
      userId,
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

    const gameSession = await GameSession.create({
      userId,
      questionSetId: questionSet._id,
      subject: questionSet.title,
      gameType: 'scholars-wager',
      currentScore: 100,
      goalScore: 1000,
    });

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
    console.error('Error starting game session:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   GET /api/scholars-wager/session/:sessionId/question
router.get('/session/:sessionId/question', verifyQuizTaker, async (req, res) => {
  try {
    const gameSession = await GameSession.findById(req.params.sessionId)
      .populate('usedQuestions'); // if you have a separate usedQuestions collection

    if (!gameSession) {
      return res.status(404).json({ success: false, message: 'Game session not found' });
    }

    if (gameSession.status !== 'active') {
      return res.status(400).json({ success: false, message: `Game is already ${gameSession.status}` });
    }

    const questionSet = await QuestionSet.findById(gameSession.questionSetId);

    if (!questionSet) {
      return res.status(404).json({ success: false, message: 'Question set not found' });
    }

    const usedQuestionIds = gameSession.usedQuestionIds || []; // or from populated usedQuestions

    const availableQuestions = questionSet.questions
      .filter(q => q.type === 'multiple-choice' && !usedQuestionIds.includes(q._id.toString()))
      .sort((a, b) => a.order - b.order);

    if (availableQuestions.length === 0) {
      const finalStatus = gameSession.currentScore >= gameSession.goalScore ? 'won' : 'lost';

      const updatedSession = await GameSession.findByIdAndUpdate(
        req.params.sessionId,
        { status: finalStatus, completedAt: new Date() },
        { new: true }
      );

      return res.json({
        success: true,
        message: 'No more questions available',
        gameOver: true,
        finalScore: updatedSession.currentScore,
        status: updatedSession.status,
      });
    }

    const batch = availableQuestions.map(q => ({
      id: q._id,
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
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   POST /api/scholars-wager/session/:sessionId/answer
router.post('/session/:sessionId/answer', verifyQuizTaker, async (req, res) => {
  try {
    const { questionId, selectedAnswer, wager } = req.body;
    const userId = req.user.id;

    if (!questionId || selectedAnswer === undefined || wager === undefined) {
      return res.status(400).json({ success: false, message: 'Question ID, answer, and wager are required' });
    }

    if (![5, 10].includes(wager)) {
      return res.status(400).json({ success: false, message: 'Wager must be either 5 or 10 points' });
    }

    const gameSession = await GameSession.findById(req.params.sessionId);

    if (!gameSession) return res.status(404).json({ success: false, message: 'Game session not found' });
    if (gameSession.userId.toString() !== userId) return res.status(403).json({ success: false, message: 'Unauthorized' });
    if (gameSession.status !== 'active') return res.status(400).json({ success: false, message: 'Game is not active' });
    if (gameSession.currentScore < wager) return res.status(400).json({ success: false, message: 'Insufficient points' });

    const questionSet = await QuestionSet.findById(gameSession.questionSetId);
    const question = questionSet?.questions.id(questionId);

    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });

    const usedQuestionIds = gameSession.usedQuestionIds || [];
    if (usedQuestionIds.includes(questionId)) {
      return res.status(400).json({ success: false, message: 'Question already answered' });
    }

    const isCorrect = String(selectedAnswer).trim() === String(question.correctAnswer).trim();

    const pointsChange = isCorrect ? wager : -wager;
    const newScore = gameSession.currentScore + pointsChange;
    const newQuestionsAnswered = gameSession.questionsAnswered + 1;
    const newCorrectAnswers = isCorrect ? gameSession.correctAnswers + 1 : gameSession.correctAnswers;

    let newStatus = 'active';
    let completedAt = null;
    let duration = null;

    if (newScore >= gameSession.goalScore) {
      newStatus = 'won';
      completedAt = new Date();
    } else if (newScore < 5) {
      newStatus = 'lost';
      completedAt = new Date();
    }

    if (completedAt) {
      duration = Math.floor((completedAt - gameSession.startedAt) / 1000);
    }

    const updatedSession = await GameSession.findByIdAndUpdate(
      req.params.sessionId,
      {
        $push: {
          usedQuestionIds: questionId,
          history: {
            questionId,
            question: question.question,
            selectedAnswer: String(selectedAnswer),
            correctAnswer: question.correctAnswer,
            wager,
            isCorrect,
            pointsChange: Math.round(pointsChange * 100) / 100,
          },
        },
        currentScore: Math.round(newScore * 100) / 100,
        questionsAnswered: newQuestionsAnswered,
        correctAnswers: newCorrectAnswers,
        status: newStatus,
        ...(completedAt && { completedAt }),
        ...(duration !== null && { duration }),
      },
      { new: true }
    );

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
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   GET /api/scholars-wager/session/:sessionId
router.get('/session/:sessionId', verifyQuizTaker, async (req, res) => {
  try {
    const gameSession = await GameSession.findById(req.params.sessionId)
      .populate('user', 'name email');

    if (!gameSession) {
      return res.status(404).json({ success: false, message: 'Game session not found' });
    }

    res.json({ success: true, session: gameSession });
  } catch (error) {
    console.error('Error fetching game session:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   POST /api/scholars-wager/session/:sessionId/quit
router.post('/session/:sessionId/quit', verifyQuizTaker, async (req, res) => {
  try {
    const gameSession = await GameSession.findOneAndUpdate(
      { _id: req.params.sessionId, userId: req.user.id, status: 'active' },
      { status: 'abandoned', completedAt: new Date() },
      { new: true }
    );

    if (!gameSession) {
      return res.status(404).json({ success: false, message: 'Active game session not found' });
    }

    res.json({ success: true, message: 'Game abandoned' });
  } catch (error) {
    console.error('Error quitting game:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   GET /api/scholars-wager/leaderboard
router.get('/leaderboard', verifyQuizTaker, async (req, res) => {
  try {
    const { limit = 10, subject } = req.query;

    const where = { status: 'won' };
    if (subject) where.subject = subject;

    const topScores = await GameSession.find(where)
      .populate('user', 'name email')
      .sort({ currentScore: -1, duration: 1 })
      .limit(parseInt(limit, 10));

    res.json({
      success: true,
      leaderboard: topScores.map((session, index) => ({
        rank: index + 1,
        player: session.user?.name || session.user?.email,
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
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   GET /api/scholars-wager/history
router.get('/history', verifyQuizTaker, async (req, res) => {
  try {
    const { limit = 10, status } = req.query;

    const where = { userId: req.user.id };
    if (status) where.status = status;

    const history = await GameSession.find(where)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10))
      .select('-history'); // exclude full history for performance

    res.json({ success: true, history });
  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

module.exports = router;