const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['multiple-choice', 'essay', 'true-false', 'fill-in-the-blanks'],
    required: true,
  },
  question: {
    type: String,
    required: true,
  },
  passage: {
    type: String,
    default: '',
    trim: true,
  },
  // NEW: Optional diagram/image reference
  diagram: {
    type: String,           // URL to image (e.g. Cloudinary, S3, or your own storage)
    default: null,
  },
  diagramAlt: {             // Optional accessibility text
    type: String,
    default: '',
    trim: true,
  },
  options: [{
    type: String,
  }],
  correctAnswer: {
    type: mongoose.Schema.Types.Mixed,
  },
  points: {
    type: Number,
    default: 1,
  },
  order: {
    type: Number,
    required: true,
  },
}, { _id: true });

const BatchSchema = new mongoose.Schema({
  batchNumber: {
    type: Number,
    required: true,
    min: 1,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  questions: [QuestionSchema],
  totalPoints: {
    type: Number,
    default: 0,
  },
  questionCount: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: true });

const QuestionSetSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  // Legacy support: questions array for backward compatibility
  questions: {
    type: [QuestionSchema],
    default: [],
  },
  // NEW: Batches array
  batches: {
    type: [BatchSchema],
    default: [],
  },
  // NEW: Flag to indicate if this question set uses batches
  usesBatches: {
    type: Boolean,
    default: false,
  },
  totalPoints: {
    type: Number,
    default: 0,
  },
  questionCount: {
    type: Number,
    default: 0,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update totalPoints and questionCount before saving
QuestionSetSchema.pre('save', function() {
  // If using batches
  if (this.usesBatches && this.batches && this.batches.length > 0) {
    // Update each batch's stats
    this.batches.forEach(batch => {
      if (batch.questions && batch.questions.length > 0) {
        batch.totalPoints = batch.questions.reduce((sum, q) => sum + (q.points || 0), 0);
        batch.questionCount = batch.questions.length;
      }
    });
    
    // Set overall stats to the sum of all active batches
    const activeBatches = this.batches.filter(b => b.isActive);
    this.totalPoints = activeBatches.reduce((sum, b) => sum + (b.totalPoints || 0), 0);
    this.questionCount = activeBatches.reduce((sum, b) => sum + (b.questionCount || 0), 0);
  } 
  // Legacy: If not using batches
  else if (this.questions && this.questions.length > 0) {
    this.totalPoints = this.questions.reduce((sum, q) => sum + (q.points || 0), 0);
    this.questionCount = this.questions.length;
  }
  
  this.updatedAt = Date.now();
});

// Helper method to get a specific batch
QuestionSetSchema.methods.getBatch = function(batchNumber) {
  if (!this.usesBatches) return null;
  return this.batches.find(b => b.batchNumber === batchNumber && b.isActive);
};

// Helper method to get all active batches
QuestionSetSchema.methods.getActiveBatches = function() {
  if (!this.usesBatches) return [];
  return this.batches.filter(b => b.isActive);
};

// Static method to convert legacy question set to batched
QuestionSetSchema.statics.convertToBatches = async function(questionSetId) {
  const questionSet = await this.findById(questionSetId);
  if (!questionSet) throw new Error('Question set not found');
  if (questionSet.usesBatches) throw new Error('Question set already uses batches');
  
  // Move all questions to Batch 1
  questionSet.batches = [{
    batchNumber: 1,
    name: 'Batch 1',
    questions: questionSet.questions,
    isActive: true,
  }];
  
  questionSet.usesBatches = true;
  questionSet.questions = []; // Clear legacy questions
  
  await questionSet.save();
  return questionSet;
};

module.exports = mongoose.model('QuestionSet', QuestionSetSchema);