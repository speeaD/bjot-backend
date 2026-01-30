const jwt = require('jsonwebtoken');
const prisma = require('../utils/database');

// Verify Admin
exports.verifyAdmin = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.',
      });
    }

    const admin = await prisma.admin.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true },
    });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message,
    });
  }
};

// Verify Quiz Taker
exports.verifyQuizTaker = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'quiztaker') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Quiz taker only.',
      });
    }

    const quizTaker = await prisma.quizTaker.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        accountType: true,
        isActive: true,
      },
    });

    if (!quizTaker) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    if (!quizTaker.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is inactive',
      });
    }

    req.quizTaker = quizTaker;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message,
    });
  }
};