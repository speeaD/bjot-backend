const express = require('express');
const router = express.Router();
const { verifyQuizTaker } = require('../middleware/auth');

// @route   GET /api/quiztaker/dashboard
// @desc    Get quiz taker dashboard data
// @access  Private (Quiz taker only)
router.get('/dashboard', verifyQuizTaker, async (req, res) => {
  try {
    const quizTaker = req.quizTaker;

    res.json({
      success: true,
      quizTaker: {
        id: quizTaker._id,
        email: quizTaker.email,
        accessCode: quizTaker.accessCode,
        quizzesTaken: quizTaker.quizzesTaken,
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

// @route   GET /api/quiztaker/profile
// @desc    Get quiz taker profile
// @access  Private (Quiz taker only)
router.get('/profile', verifyQuizTaker, async (req, res) => {
  try {
    const quizTaker = req.quizTaker;

    res.json({
      success: true,
      profile: {
        id: quizTaker._id,
        email: quizTaker.email,
        accessCode: quizTaker.accessCode,
        totalQuizzesTaken: quizTaker.quizzesTaken.length,
        memberSince: quizTaker.createdAt,
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

module.exports = router;
