const mongoose = require('mongoose');
const crypto = require('crypto');

const QuizTakerSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  accessCode: {
    type: String,
    required: true,
    unique: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  quizzesTaken: [{
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
    },
    score: Number,
    completedAt: Date,
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Generate unique 9-digit alphanumeric access code
QuizTakerSchema.statics.generateAccessCode = function() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 9; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Hash password before saving
QuizTakerSchema.pre('save', async function() { 
  if (!this.isModified('password')) return;
  
  const bcrypt = require('bcryptjs');
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare password
QuizTakerSchema.methods.comparePassword = async function(candidatePassword) {
  const bcrypt = require('bcryptjs');
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('QuizTaker', QuizTakerSchema);