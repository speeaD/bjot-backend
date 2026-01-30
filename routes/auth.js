const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const prisma = require('../utils/database');
const bcrypt = require('bcryptjs'); // You'll need this for password hashing



// Generate JWT Token
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

// @route   POST /api/auth/admin/login
// @desc    Admin login
// @access  Public
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide email and password' 
      });
    }

    // Check if admin exists
    // Changed from: Admin.findOne({ email })
    const admin = await prisma.admin.findUnique({
      where: { email }
    });

    if (!admin) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Check password
    // NOTE: You'll need to implement password comparison
    // If you had a comparePassword method on the Mongoose model,
    // you'll need to use bcrypt.compare here
    const isMatch = await bcrypt.compare(password, admin.password);
    
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Generate token
    // Changed from: admin._id to admin.id (UUIDs in Prisma)
    const token = generateToken(admin.id, 'admin');

    res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
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

// @route   POST /api/auth/admin/register
// @desc    Register admin (for initial setup only)
// @access  Public (You may want to restrict this in production)
router.post('/admin/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide email and password' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters' 
      });
    }

    // Check if admin already exists
    // Changed from: Admin.findOne({ email })
    const existingAdmin = await prisma.admin.findUnique({
      where: { email }
    });

    if (existingAdmin) {
      return res.status(400).json({ 
        success: false, 
        message: 'Admin already exists' 
      });
    }

    // Hash password
    // NOTE: In Mongoose, you likely had a pre-save hook to hash passwords
    // With Prisma, you need to hash manually before saving
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin
    // Changed from: new Admin({ ... }) then admin.save()
    const admin = await prisma.admin.create({
      data: {
        email,
        password: hashedPassword,
        // role defaults to "admin" in schema, so no need to specify unless different
      }
    });

    // Generate token
    const token = generateToken(admin.id, 'admin');

    res.status(201).json({
      success: true,
      message: 'Admin registered successfully',
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
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

// @route   POST /api/auth/quiztaker/login
// @desc    Quiz taker login with access code
// @access  Public
router.post('/quiztaker/login', async (req, res) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide a valid email address' 
      });
    }

    // Check if quiz taker exists
    // Changed from: QuizTaker.findOne({ email: email.trim() })
    const quizTaker = await prisma.quizTaker.findFirst({
      where: { 
        email: email.trim()
      }
    });

    if (!quizTaker) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid access code' 
      });
    }

    // Check if account is active
    if (!quizTaker.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account is inactive. Contact admin.' 
      });
    }

    // Generate token
    const token = generateToken(quizTaker.id, 'quiztaker');

    res.json({
      success: true,
      message: 'Login successful',
      token,
      quizTaker: {
        id: quizTaker.id,
        email: quizTaker.email,
        accessCode: quizTaker.accessCode,
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