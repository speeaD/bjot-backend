const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');

dotenv.config();

const app = express();

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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

app.set('upload', upload);
app.use(cors());
app.use(express.json());

// Routes (will be registered after DB connects)
const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected successfully');

    // Register routes after DB connection
    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/admin', require('./routes/admin'));
    app.use('/api/quiztaker', require('./routes/quiztaker'));
    app.use('/api/quiz', require('./routes/quiz'));
    app.use('/api/questionset', require('./routes/questionset'));
    app.use('/api/public/quiz', require('./routes/public.js'));
    app.use('/api/cbt', require('./routes/cbt.js'));
    app.use('/api/games/scholarswager', require('./routes/scholarswager.js'));
    app.use('/api/attendance', require('./routes/attendance.js'));
    app.use('/api/health', require('./routes/health.js'));

    app.get('/', (req, res) => {
      res.json({ message: 'Server is running!' });
    });

    const PORT = process.env.PORT || 5001;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

startServer();

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!', 
    error: err.message 
  });
});   