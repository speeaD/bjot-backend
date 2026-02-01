// Quick Fix: Manually migrate submissions for sejiofor20@gmail.com
// Run this after the improved migration if you need to fix specific users

const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

// MongoDB models  
const QuizSubmission = require('../models/QuizSubmission');
const QuizTaker = require('../models/QuizTaker');
const Quiz = require('../models/Quiz');

async function fixSpecificUser() {
  try {
    const targetEmail = 'sejiofor20@gmail.com';
    
    console.log(`🔧 Fixing submissions for: ${targetEmail}\n`);
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Find quiz taker in MongoDB
    const mongoQuizTaker = await QuizTaker.findOne({ 
      email: targetEmail 
    });
    
    if (!mongoQuizTaker) {
      console.log('❌ Quiz taker not found in MongoDB');
      return;
    }
    
    console.log(`Found quiz taker in MongoDB: ${mongoQuizTaker._id}`);
    
    // Find quiz taker in PostgreSQL
    const pgQuizTaker = await prisma.quizTaker.findFirst({
      where: { email: targetEmail }
    });
    
    if (!pgQuizTaker) {
      console.log('❌ Quiz taker not found in PostgreSQL');
      return;
    }
    
    console.log(`Found quiz taker in PostgreSQL: ${pgQuizTaker.id}\n`);
    
    // Find all submissions for this quiz taker in MongoDB
    const mongoSubmissions = await QuizSubmission.find({
      quizTakerId: mongoQuizTaker._id
    });
    
    console.log(`Found ${mongoSubmissions.length} submissions in MongoDB\n`);
    
    for (const submission of mongoSubmissions) {
      try {
        // Get the quiz ID from the submission
        const mongoQuizId = submission.quizId?.toString() || submission.quizId;
        
        if (!mongoQuizId) {
          console.log(`⚠️  Skipping submission: No quiz ID`);
          continue;
        }
        
        // Find the quiz in MongoDB to get its title
        const mongoQuiz = await Quiz.findById(mongoQuizId);
        
        if (!mongoQuiz) {
          console.log(`⚠️  Skipping submission: Quiz not found in MongoDB`);
          continue;
        }
        
        const quizTitle = mongoQuiz.settings?.title;
        
        if (!quizTitle) {
          console.log(`⚠️  Skipping submission: No quiz title`);
          continue;
        }
        
        // Find quiz in PostgreSQL by title
        const pgQuiz = await prisma.quiz.findFirst({
          where: { title: quizTitle }
        });
        
        if (!pgQuiz) {
          console.log(`⚠️  Skipping submission: Quiz not found - "${quizTitle}"`);
          continue;
        }
        
        // Find assigned quiz
        const assignedQuiz = await prisma.assignedQuiz.findFirst({
          where: {
            quizTakerId: pgQuizTaker.id,
            quizId: pgQuiz.id
          }
        });
        
        // Check if already exists
        const existing = await prisma.quizSubmission.findFirst({
          where: {
            quizTakerId: pgQuizTaker.id,
            quizId: pgQuiz.id,
            submittedAt: submission.submittedAt
          }
        });
        
        if (existing) {
          console.log(`✓ Submission already exists for: ${quizTitle}`);
          continue;
        }
        
        // Create submission
        const newSubmission = await prisma.quizSubmission.create({
          data: {
            quizId: pgQuiz.id,
            quizTakerId: pgQuizTaker.id,
            assignedQuizId: assignedQuiz?.id || null,
            status: submission.status || 'auto-graded',
            score: submission.score || 0,
            totalPoints: submission.totalPoints || 0,
            percentage: parseFloat(submission.percentage) || 0,
            timeTaken: submission.timeTaken || 0,
            feedback: submission.feedback || '',
            startedAt: submission.startedAt || new Date(),
            submittedAt: submission.submittedAt || new Date(),
          }
        });
        
        // Create history entry
        await prisma.quizTakenHistory.create({
          data: {
            quizTakerId: pgQuizTaker.id,
            quizId: pgQuiz.id,
            submissionId: newSubmission.id,
            examType: 'multi-subject',
            score: submission.score || 0,
            totalPoints: submission.totalPoints || 0,
            percentage: parseFloat(submission.percentage) || 0,
            timeTaken: submission.timeTaken || 0,
            completedAt: submission.submittedAt || new Date()
          }
        });
        
        console.log(`✅ Created submission for: ${quizTitle}`);
        console.log(`   Score: ${submission.score}/${submission.totalPoints} (${submission.percentage}%)`);
        console.log(`   Submitted: ${submission.submittedAt}\n`);
        
      } catch (error) {
        console.error(`❌ Error:`, error.message);
      }
    }
    
    // Verify
    const finalCount = await prisma.quizSubmission.count({
      where: { quizTakerId: pgQuizTaker.id }
    });
    
    console.log(`\n✅ Final count: ${finalCount} submissions in PostgreSQL`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    await prisma.$disconnect();
  }
}

fixSpecificUser();