const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const QuizTaker = require('../models/QuizTaker');

// Verify Admin Token
exports.verifyAdmin = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const admin = await Admin.findById(decoded.id).select('-password');
    
    if (!admin) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token.' 
      });
    }

    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token.', 
      error: error.message 
    });
  }
};

// Verify QuizTaker Token
exports.verifyQuizTaker = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'quiztaker') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Quiz taker only.' 
      });
    }

    const quizTaker = await QuizTaker.findById(decoded.id).select('-password');
    
    if (!quizTaker) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token.' 
      });
    }

    if (!quizTaker.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account is inactive. Contact admin.' 
      });
    }

    req.quizTaker = quizTaker;
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token.', 
      error: error.message 
    });
  }
};