const express = require('express');
const router = express.Router();
const { verifyAdmin } = require('../middleware/auth');
const Quiz = require('../models/Quiz');
const QuestionSet = require('../models/QuestionSet');

// @route   POST /api/quiz
// @desc    Create a new quiz with 4 question sets
// @access  Private (Admin only)
router.post('/', verifyAdmin, async (req, res) => {
  try {
    // Destructure the entire body to get settings at root level
    const { questionSetCombination, settings } = req.body;

    // Validation
    if (!settings || !settings.title) {
      return res.status(400).json({
        success: false,
        message: 'Quiz title is required',
      });
    }

    if (!questionSetCombination || !Array.isArray(questionSetCombination) || questionSetCombination.length !== 4) {
      return res.status(400).json({
        success: false,
        message: 'Exactly 4 question set IDs are required',
      });
    }

    // Check for duplicates
    const uniqueSetIds = new Set(questionSetCombination);
    if (uniqueSetIds.size !== 4) {
      return res.status(400).json({
        success: false,
        message: 'Cannot use the same question set multiple times',
      });
    }

    // Fetch all question sets
    const questionSets = await QuestionSet.find({
      _id: { $in: questionSetCombination },
      isActive: true,
    });

    if (questionSets.length !== 4) {
      return res.status(400).json({
        success: false,
        message: 'One or more question sets not found or inactive',
      });
    }

    // Create quiz question sets with snapshots in the order provided
    const quizQuestionSets = questionSetCombination.map((setId, index) => {
      const questionSet = questionSets.find(qs => qs._id.toString() === setId);
      
      if (!questionSet) {
        throw new Error(`Question set with ID ${setId} not found`);
      }

      // Create snapshot of questions
      const questions = questionSet.questions.map(q => ({
        type: q.type,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: q.points,
        order: q.order,
        originalQuestionId: q._id,
      }));

      return {
        questionSetId: questionSet._id,
        title: questionSet.title,
        questions,
        totalPoints: questionSet.totalPoints,
        order: index + 1,
      };
    });

    // Create quiz with proper structure
    const quiz = new Quiz({
      settings: {
        coverImage: settings.coverImage || '',
        title: settings.title,
        isQuizChallenge: settings.isQuizChallenge || false,
        isOpenQuiz: settings.isOpenQuiz || false,
        description: settings.description || '',
        instructions: settings.instructions || '',
        duration: settings.duration || { hours: 0, minutes: 30, seconds: 0 },
        multipleAttempts: settings.multipleAttempts || false,
        looseFocus: settings.permitLoseFocus || false, // Note: permitLoseFocus maps to looseFocus
        viewAnswer: settings.viewAnswer !== undefined ? settings.viewAnswer : true,
        viewResults: settings.viewResults !== undefined ? settings.viewResults : true,
        displayCalculator: settings.displayCalculator || false,
      },
      questionSets: quizQuestionSets,
      questionSetCombination: questionSetCombination,
      createdBy: req.admin._id,
    });

    await quiz.save();

    res.status(201).json({
      success: true,
      message: 'Quiz created successfully',
      quiz,
    });
  } catch (error) {
    console.error('Error creating quiz:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/quiz
// @desc    Get all quizzes
// @access  Private (Admin only)
router.get('/', verifyAdmin, async (req, res) => {
  try {
    const { isActive, isQuizChallenge } = req.query;

    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (isQuizChallenge !== undefined) filter['settings.isQuizChallenge'] = isQuizChallenge === 'true';

    const quizzes = await Quiz.find(filter)
      .populate('createdBy', 'email')
      .populate('questionSets.questionSetId', 'title')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: quizzes.length,
      quizzes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/quiz/:id
// @desc    Get single quiz by ID
// @access  Private (Admin only)
router.get('/:id', verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .populate('createdBy', 'email')
      .populate('questionSets.questionSetId', 'title questionCount totalPoints');

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    res.json({
      success: true,
      quiz,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   PUT /api/quiz/:id
// @desc    Update quiz settings (not question sets)
// @access  Private (Admin only)
router.put('/:id', verifyAdmin, async (req, res) => {
  try {
    const { settings, isActive } = req.body;

    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    // Update only settings and isActive, not question sets
    if (settings) {
      quiz.settings = { ...quiz.settings.toObject(), ...settings };
    }
    if (typeof isActive !== 'undefined') {
      quiz.isActive = isActive;
    }

    await quiz.save();

    res.json({
      success: true,
      message: 'Quiz updated successfully',
      quiz,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   PUT /api/quiz/:id/question-sets
// @desc    Replace question sets in a quiz (recreates snapshots)
// @access  Private (Admin only)
router.put('/:id/question-sets', verifyAdmin, async (req, res) => {
  try {
    const { questionSetIds } = req.body;

    if (!questionSetIds || !Array.isArray(questionSetIds) || questionSetIds.length !== 4) {
      return res.status(400).json({
        success: false,
        message: 'Exactly 4 question set IDs are required',
      });
    }

    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    // Fetch all question sets
    const questionSets = await QuestionSet.find({
      _id: { $in: questionSetIds },
      isActive: true,
    });

    if (questionSets.length !== 4) {
      return res.status(400).json({
        success: false,
        message: 'One or more question sets not found or inactive',
      });
    }

    // Create new quiz question sets with snapshots
    const quizQuestionSets = questionSetIds.map((setId, index) => {
      const questionSet = questionSets.find(qs => qs._id.toString() === setId);
      
      if (!questionSet) {
        throw new Error(`Question set with ID ${setId} not found`);
      }

      const questions = questionSet.questions.map(q => ({
        type: q.type,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: q.points,
        order: q.order,
        originalQuestionId: q._id,
      }));

      return {
        questionSetId: questionSet._id,
        title: questionSet.title,
        questions,
        totalPoints: questionSet.totalPoints,
        order: index + 1,
      };
    });

    quiz.questionSets = quizQuestionSets;
    await quiz.save();

    res.json({
      success: true,
      message: 'Quiz question sets updated successfully',
      quiz,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   DELETE /api/quiz/:id
// @desc    Delete quiz
// @access  Private (Admin only)
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    await quiz.deleteOne();

    res.json({
      success: true,
      message: 'Quiz deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   PATCH /api/quiz/:id/toggle-active
// @desc    Toggle quiz active status
// @access  Private (Admin only)
router.patch('/:id/toggle-active', verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    quiz.isActive = !quiz.isActive;
    await quiz.save();

    res.json({
      success: true,
      message: `Quiz ${quiz.isActive ? 'activated' : 'deactivated'} successfully`,
      quiz,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/quiz/:id/statistics
// @desc    Get quiz statistics (total questions, points per set, etc.)
// @access  Private (Admin only)
router.get('/:id/statistics', verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .populate('questionSets.questionSetId', 'title');

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    const statistics = {
      totalQuestionSets: quiz.questionSets.length,
      totalQuestions: quiz.questionSets.reduce((sum, qs) => sum + qs.questions.length, 0),
      totalPoints: quiz.totalPoints,
      questionSetBreakdown: quiz.questionSets.map(qs => ({
        title: qs.title,
        questionCount: qs.questions.length,
        totalPoints: qs.totalPoints,
        order: qs.order,
      })),
      duration: quiz.getTotalDurationInSeconds(),
    };

    res.json({
      success: true,
      statistics,
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