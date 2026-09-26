const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');

dotenv.config();

const app = express();

// Prisma maps PostgreSQL BIGINT columns (such as quiz-taker phone numbers) to
// JavaScript BigInt values. Native JSON.stringify cannot serialize BigInt, so
// make every Express JSON response represent them as strings. Phone numbers are
// identifiers rather than numbers and must not lose precision in transit.
app.set('json replacer', (_key, value) =>
  typeof value === 'bigint' ? value.toString() : value
);

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  }
});


// Make upload middleware available globally
app.set('upload', upload);

// Middleware 
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('MongoDB connected successfully'))
.catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/content', require('./routes/landing-content-admin'));
app.use('/api/attendance/admin/schedules', require('./routes/schedules'));
app.use('/api/quiztaker', require('./routes/quiztaker'));
app.use('/api/quiz', require('./routes/quiz'));
app.use('/api/questionset', require('./routes/questionset'));
app.use('/api/study-hub', require('./routes/study-hub'));
// NEW: Public routes for regular students (no authentication required)
app.use('/api/public/quiz', require('./routes/public.js'));
app.use('/api/public-exams', require('./routes/public-exams'));
app.use('/api/public/content', require('./routes/landing-content-public'));
app.use('/api/cbt', require('./routes/cbt.js'));
app.use('/api/games', require('./routes/games'));

// Test route to verify server is working
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!', 
    error: err.message 
  });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
