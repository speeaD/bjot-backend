const express = require('express');
const mongoose = require("mongoose");
const router = express.Router();

router.get('/', async (req, res) => {
  const start = Date.now();
  await mongoose.connection.db.admin().ping();
  const duration = Date.now() - start;
  
  res.json({ 
    status: 'ok',
    dbPing: `${duration}ms`,
    dbState: mongoose.connection.readyState 
    // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  });
});

module.exports = router;