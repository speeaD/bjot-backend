const express = require('express');
const router = express.Router();
const { verifyAdmin } = require('../middleware/auth');
const QuizTaker = require('../models/QuizTaker');

// @route   POST /api/admin/quiztaker
// @desc    Create a new quiz taker
// @access  Private (Admin only)
router.post('/quiztaker', verifyAdmin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide email and password' 
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
      password,
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
      .select('-password')
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
      .select('-password');

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
    const { email, password, isActive } = req.body;

    const quizTaker = await QuizTaker.findById(req.params.id);

    if (!quizTaker) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quiz taker not found' 
      });
    }

    // Update fields
    if (email) quizTaker.email = email;
    if (password) quizTaker.password = password;
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

module.exports = router;