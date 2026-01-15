const mongoose = require('mongoose');
require('dotenv').config();

async function fixAccessCodeIndex() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('quiztakers');

    // Drop the existing accessCode index
    try {
      await collection.dropIndex('accessCode_1');
      console.log('✓ Dropped old accessCode_1 index');
    } catch (err) {
      console.log('No existing accessCode_1 index to drop');
    }

    // Create new sparse unique index
    await collection.createIndex(
      { accessCode: 1 }, 
      { unique: true, sparse: true }
    );
    console.log('✓ Created new sparse unique index on accessCode');

    // Also create the compound index for regular students
    await collection.createIndex(
      { email: 1, accountType: 1 }
    );
    console.log('✓ Created compound index on email and accountType');

    console.log('\n✅ All indexes fixed successfully!');
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing indexes:', error);
    process.exit(1);
  }
}

fixAccessCodeIndex();