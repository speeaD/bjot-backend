const express = require('express');
const router = express.Router();
const { verifyAdmin } = require('../middleware/auth');
const QuizTaker = require('../models/QuizTaker');
const Quiz = require('../models/Quiz');

// @route   POST /api/admin/quiztaker
// @desc    Create a new quiz taker
// @access  Private (Admin only)
router.post('/quiztaker', verifyAdmin, async (req, res) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email ) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide email address' 
      });
    }

    // Check if quiz taker already exists
    const existingQuizTaker = await QuizTaker.findOne({ email });
    if (existingQuizTaker) {
      return res.status(400).json({ 
        success: false, 
        message: 'Quiz taker with this email already exists' 
      });
    }

    // Generate unique access code
    let accessCode;
    let isUnique = false;
    
    while (!isUnique) {
      accessCode = QuizTaker.generateAccessCode();
      const existing = await QuizTaker.findOne({ accessCode });
      if (!existing) isUnique = true;
    }

    // Create quiz taker
    const quizTaker = new QuizTaker({
      email,
      accessCode,
    });

    await quizTaker.save();

    res.status(201).json({
      success: true,
      message: 'Quiz taker created successfully',
      quizTaker: {
        id: quizTaker._id,
        email: quizTaker.email,
        accessCode: quizTaker.accessCode,
        isActive: quizTaker.isActive,
        createdAt: quizTaker.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// @route   GET /api/admin/quiztakers
// @desc    Get all quiz takers
// @access  Private (Admin only)
router.get('/quiztakers', verifyAdmin, async (req, res) => {
  try {
    const quizTakers = await QuizTaker.find()
      .populate('assignedQuizzes.quizId', 'settings.title')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: quizTakers.length,
      quizTakers,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// @route   GET /api/admin/quiztaker/:id
// @desc    Get single quiz taker
// @access  Private (Admin only)
router.get('/quiztaker/:id', verifyAdmin, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.params.id)
      .populate('assignedQuizzes.quizId', 'settings.title settings.isQuizChallenge')
      .populate('assignedQuizzes.submissionId');

    if (!quizTaker) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quiz taker not found' 
      });
    }

    res.json({
      success: true,
      quizTaker,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// @route   PUT /api/admin/quiztaker/:id
// @desc    Update quiz taker
// @access  Private (Admin only)
router.put('/quiztaker/:id', verifyAdmin, async (req, res) => {
  try {
    const { email, isActive } = req.body;

    const quizTaker = await QuizTaker.findById(req.params.id);

    if (!quizTaker) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quiz taker not found' 
      });
    }

    // Update fields
    if (email) quizTaker.email = email;
    if (typeof isActive !== 'undefined') quizTaker.isActive = isActive;

    await quizTaker.save();

    res.json({
      success: true,
      message: 'Quiz taker updated successfully',
      quizTaker: {
        id: quizTaker._id,
        email: quizTaker.email,
        accessCode: quizTaker.accessCode,
        isActive: quizTaker.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// @route   DELETE /api/admin/quiztaker/:id
// @desc    Delete quiz taker
// @access  Private (Admin only)
router.delete('/quiztaker/:id', verifyAdmin, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.params.id);

    if (!quizTaker) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quiz taker not found' 
      });
    }

    await quizTaker.deleteOne();

    res.json({
      success: true,
      message: 'Quiz taker deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// @route   POST /api/admin/assign-quiz
// @desc    Assign quiz to quiz taker(s)
// @access  Private (Admin only)
router.post('/assign-quiz', verifyAdmin, async (req, res) => {
  try {
    const { quizId, quizTakerIds } = req.body;

    // Validation
    if (!quizId || !quizTakerIds || !Array.isArray(quizTakerIds)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quizId and quizTakerIds array',
      });
    }

    // Check if quiz exists
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    const results = {
      success: [],
      failed: [],
    };

    for (const takerId of quizTakerIds) {
      try {
        const quizTaker = await QuizTaker.findById(takerId);
        
        if (!quizTaker) {
          results.failed.push({ takerId, reason: 'Quiz taker not found' });
          continue;
        }

        // Initialize assignedQuizzes if it doesn't exist
        if (!quizTaker.assignedQuizzes) {
          quizTaker.assignedQuizzes = [];
        }

        // Check if quiz is already assigned
        const alreadyAssigned = quizTaker.assignedQuizzes.some(
          aq => aq.quizId.toString() === quizId
        );

        if (alreadyAssigned) {
          results.failed.push({ takerId, reason: 'Quiz already assigned' });
          continue;
        }

        // Assign quiz
        quizTaker.assignedQuizzes.push({
          quizId,
          status: 'pending',
        });

        await quizTaker.save();
        results.success.push({ takerId, email: quizTaker.email });
      } catch (error) {
        results.failed.push({ takerId, reason: error.message });
      }
    }

    res.json({
      success: true,
      message: `Quiz assigned to ${results.success.length} quiz taker(s)`,
      results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   DELETE /api/admin/unassign-quiz
// @desc    Unassign quiz from quiz taker
// @access  Private (Admin only)
router.delete('/unassign-quiz', verifyAdmin, async (req, res) => {
  try {
    const { quizId, quizTakerId } = req.body;

    const quizTaker = await QuizTaker.findById(quizTakerId);
    
    if (!quizTaker) {
      return res.status(404).json({
        success: false,
        message: 'Quiz taker not found',
      });
    }

    // Check if quiz is assigned and not completed
    const assignedQuiz = quizTaker.assignedQuizzes.find(
      aq => aq.quizId.toString() === quizId
    );

    if (!assignedQuiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not assigned to this quiz taker',
      });
    }

    if (assignedQuiz.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot unassign completed quiz',
      });
    }

    // Remove quiz assignment
    quizTaker.assignedQuizzes = quizTaker.assignedQuizzes.filter(
      aq => aq.quizId.toString() !== quizId
    );

    await quizTaker.save();

    res.json({
      success: true,
      message: 'Quiz unassigned successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/admin/submissions
// @desc    Get all quiz submissions
// @access  Private (Admin only)
router.get('/submissions', verifyAdmin, async (req, res) => {
  try {
    const QuizSubmission = require('../models/QuizSubmission');
    
    const submissions = await QuizSubmission.find()
      .populate('quizId', 'settings.title')
      .populate('quizTakerId', 'email accessCode')
      .sort({ submittedAt: -1 });

    res.json({
      success: true,
      count: submissions.length,
      submissions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/admin/submission/:id
// @desc    Get single submission
// @access  Private (Admin only)
router.get('/submission/:id', verifyAdmin, async (req, res) => {
  try {
    const QuizSubmission = require('../models/QuizSubmission');
    
    const submission = await QuizSubmission.findById(req.params.id)
      .populate('quizId')
      .populate('quizTakerId', 'email accessCode');

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found',
      });
    }

    res.json({
      success: true,
      submission,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   PUT /api/admin/grade-essay/:submissionId
// @desc    Grade essay questions manually
// @access  Private (Admin only)
router.put('/grade-essay/:submissionId', verifyAdmin, async (req, res) => {
  try {
    const { grades, feedback } = req.body;
    // grades format: [{ questionId, pointsAwarded }]

    const QuizSubmission = require('../models/QuizSubmission');
    const submission = await QuizSubmission.findById(req.params.submissionId);

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found',
      });
    }

    // Update essay grades
    grades.forEach(grade => {
      const answer = submission.answers.find(
        a => a.questionId.toString() === grade.questionId
      );
      if (answer && answer.questionType === 'essay') {
        answer.pointsAwarded = grade.pointsAwarded;
        answer.isCorrect = grade.pointsAwarded > 0;
      }
    });

    // Recalculate total score
    submission.score = submission.answers.reduce(
      (sum, answer) => sum + answer.pointsAwarded, 0
    );
    
    submission.status = 'graded';
    submission.gradedBy = req.admin._id;
    submission.gradedAt = new Date();
    submission.feedback = feedback || '';

    await submission.save();

    res.json({
      success: true,
      message: 'Essay graded successfully',
      submission,
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
