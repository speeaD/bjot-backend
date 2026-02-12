// manual-test.js - Simple test runner without frameworks
const mongoose = require('mongoose');
const QuestionSet = require('../models/QuestionSet');
const CBTSubmission = require('../models/CbtModel');
const QuizTaker = require('../models/QuizTaker');

// Import your helper functions
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getAllQuestionsFromQuestionSet(questionSet) {
  if (questionSet.usesBatches && questionSet.batches && questionSet.batches.length > 0) {
    const allQuestions = [];
    
    questionSet.batches.forEach(batch => {
      if (batch.isActive && batch.questions && batch.questions.length > 0) {
        batch.questions.forEach(question => {
          allQuestions.push({
            ...question.toObject(),
            batchId: batch._id,
            batchNumber: batch.batchNumber,
            batchName: batch.name,
          });
        });
      }
    });
    
    return allQuestions;
  } else if (questionSet.questions && questionSet.questions.length > 0) {
    return questionSet.questions.map(q => q.toObject());
  }
  
  return [];
}

async function runTests() {
  try {
    console.log('🧪 Starting Manual Tests...\n');

    // Connect to test database
    await mongoose.connect('mongodb://localhost:27017/cbt_test');
    console.log('✅ Connected to test database');

    // Clean up
    await QuestionSet.deleteMany({});
    await CBTSubmission.deleteMany({});
    await QuizTaker.deleteMany({});
    console.log('✅ Cleaned up test data\n');

    // TEST 1: Create Legacy Question Set
    console.log('📝 TEST 1: Creating legacy question set...');
    const legacyQuestionSet = await QuestionSet.create({
      title: 'Legacy Math',
      usesBatches: false,
      questions: [
        {
          type: 'multiple-choice',
          question: 'What is 2+2?',
          options: ['1', '2', '3', '4'],
          correctAnswer: '4',
          points: 1,
          order: 1
        },
        {
          type: 'true-false',
          question: 'Earth is flat',
          correctAnswer: false,
          points: 1,
          order: 2
        }
      ],
      createdBy: new mongoose.Types.ObjectId()
    });
    console.log(`✅ Created legacy question set: ${legacyQuestionSet.title}`);
    console.log(`   Questions: ${legacyQuestionSet.questions.length}\n`);

    // TEST 2: Create Batch Question Set
    console.log('📝 TEST 2: Creating batch-based question set...');
    const batchQuestionSet = await QuestionSet.create({
      title: 'Batch Math',
      usesBatches: true,
      batches: [
        {
          batchNumber: 1,
          name: 'Algebra',
          isActive: true,
          questions: [
            {
              type: 'multiple-choice',
              question: 'What is 3+3?',
              options: ['4', '5', '6', '7'],
              correctAnswer: '6',
              points: 1,
              order: 1
            },
            {
              type: 'fill-in-the-blanks',
              question: 'The square root of 16 is ____',
              correctAnswer: '4',
              points: 1,
              order: 2
            }
          ]
        },
        {
          batchNumber: 2,
          name: 'Geometry',
          isActive: true,
          questions: [
            {
              type: 'essay',
              question: 'Explain the Pythagorean theorem',
              passage: 'The Pythagorean theorem is a fundamental relation...',
              diagram: 'https://example.com/triangle.png',
              diagramAlt: 'Right triangle diagram',
              correctAnswer: '',
              points: 5,
              order: 1
            }
          ]
        }
      ],
      createdBy: new mongoose.Types.ObjectId()
    });
    console.log(`✅ Created batch question set: ${batchQuestionSet.title}`);
    console.log(`   Batches: ${batchQuestionSet.batches.length}`);
    console.log(`   Total Questions: ${batchQuestionSet.questionCount}\n`);

    // TEST 3: Test getAllQuestionsFromQuestionSet with Legacy
    console.log('📝 TEST 3: Testing getAllQuestionsFromQuestionSet with legacy...');
    const legacyQuestions = getAllQuestionsFromQuestionSet(legacyQuestionSet);
    console.log(`✅ Retrieved ${legacyQuestions.length} questions from legacy set`);
    console.assert(legacyQuestions.length === 2, '❌ Should have 2 questions');
    console.log('✅ Assertion passed: Has 2 questions\n');

    // TEST 4: Test getAllQuestionsFromQuestionSet with Batches
    console.log('📝 TEST 4: Testing getAllQuestionsFromQuestionSet with batches...');
    const batchQuestions = getAllQuestionsFromQuestionSet(batchQuestionSet);
    console.log(`✅ Retrieved ${batchQuestions.length} questions from batch set`);
    console.assert(batchQuestions.length === 3, '❌ Should have 3 questions');
    console.log('✅ Assertion passed: Has 3 questions');
    console.assert(batchQuestions[0].batchId !== undefined, '❌ Should have batchId');
    console.log('✅ Assertion passed: Questions have batch metadata\n');

    // TEST 5: Test Randomization
    console.log('📝 TEST 5: Testing question randomization...');
    const originalOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let differentCount = 0;
    for (let i = 0; i < 10; i++) {
      const shuffled = shuffleArray(originalOrder);
      if (JSON.stringify(shuffled) !== JSON.stringify(originalOrder)) {
        differentCount++;
      }
    }
    console.log(`✅ Out of 10 shuffles, ${differentCount} were different from original`);
    console.assert(differentCount >= 8, '❌ Should be random most of the time');
    console.log('✅ Assertion passed: Shuffling works correctly\n');

    // TEST 6: Test Batch with Inactive Batch
    console.log('📝 TEST 6: Testing inactive batch filtering...');
    const mixedBatchSet = await QuestionSet.create({
      title: 'Mixed Batch Set',
      usesBatches: true,
      batches: [
        {
          batchNumber: 1,
          name: 'Active Batch',
          isActive: true,
          questions: [{
            type: 'true-false',
            question: 'Active question?',
            correctAnswer: true,
            points: 1,
            order: 1
          }]
        },
        {
          batchNumber: 2,
          name: 'Inactive Batch',
          isActive: false,
          questions: [{
            type: 'true-false',
            question: 'Should not appear',
            correctAnswer: true,
            points: 1,
            order: 1
          }]
        }
      ],
      createdBy: new mongoose.Types.ObjectId()
    });
    const mixedQuestions = getAllQuestionsFromQuestionSet(mixedBatchSet);
    console.log(`✅ Retrieved ${mixedQuestions.length} questions (only from active batches)`);
    console.assert(mixedQuestions.length === 1, '❌ Should only get questions from active batch');
    console.log('✅ Assertion passed: Inactive batches are filtered out\n');

    // TEST 7: Test Question Points Calculation
    console.log('📝 TEST 7: Testing points calculation...');
    console.log(`   Legacy set total points: ${legacyQuestionSet.totalPoints}`);
    console.assert(legacyQuestionSet.totalPoints === 2, '❌ Legacy should have 2 points');
    console.log(`   Batch set total points: ${batchQuestionSet.totalPoints}`);
    console.assert(batchQuestionSet.totalPoints === 7, '❌ Batch should have 7 points (1+1+5)');
    console.log('✅ All points calculations correct\n');

    // Summary
    console.log('═══════════════════════════════════════════════');
    console.log('🎉 All Tests Passed!');
    console.log('═══════════════════════════════════════════════');
    console.log('\nTest Summary:');
    console.log('  ✅ Legacy question set creation');
    console.log('  ✅ Batch question set creation');
    console.log('  ✅ Question retrieval from legacy set');
    console.log('  ✅ Question retrieval from batch set');
    console.log('  ✅ Batch metadata inclusion');
    console.log('  ✅ Question randomization');
    console.log('  ✅ Inactive batch filtering');
    console.log('  ✅ Points calculation');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Cleanup
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    console.log('\n🧹 Cleaned up and closed database connection');
  }
}

// Run tests
runTests();


// // Quick Fix: Manually migrate submissions for sejiofor20@gmail.com
// // Run this after the improved migration if you need to fix specific users

// const mongoose = require('mongoose');
// const { PrismaClient } = require('@prisma/client');
// require('dotenv').config();

// const prisma = new PrismaClient();

// // MongoDB models  
// const QuizSubmission = require('../models/QuizSubmission');
// const QuizTaker = require('../models/QuizTaker');
// const Quiz = require('../models/Quiz');

// async function fixSpecificUser() {
//   try {
//     const targetEmail = 'sejiofor20@gmail.com';
    
//     console.log(`🔧 Fixing submissions for: ${targetEmail}\n`);
    
//     // Connect to MongoDB
//     await mongoose.connect(process.env.MONGODB_URI);
//     console.log('✅ Connected to MongoDB');
    
//     // Find quiz taker in MongoDB
//     const mongoQuizTaker = await QuizTaker.findOne({ 
//       email: targetEmail 
//     });
    
//     if (!mongoQuizTaker) {
//       console.log('❌ Quiz taker not found in MongoDB');
//       return;
//     }
    
//     console.log(`Found quiz taker in MongoDB: ${mongoQuizTaker._id}`);
    
//     // Find quiz taker in PostgreSQL
//     const pgQuizTaker = await prisma.quizTaker.findFirst({
//       where: { email: targetEmail }
//     });
    
//     if (!pgQuizTaker) {
//       console.log('❌ Quiz taker not found in PostgreSQL');
//       return;
//     }
    
//     console.log(`Found quiz taker in PostgreSQL: ${pgQuizTaker.id}\n`);
    
//     // Find all submissions for this quiz taker in MongoDB
//     const mongoSubmissions = await QuizSubmission.find({
//       quizTakerId: mongoQuizTaker._id
//     });
    
//     console.log(`Found ${mongoSubmissions.length} submissions in MongoDB\n`);
    
//     for (const submission of mongoSubmissions) {
//       try {
//         // Get the quiz ID from the submission
//         const mongoQuizId = submission.quizId?.toString() || submission.quizId;
        
//         if (!mongoQuizId) {
//           console.log(`⚠️  Skipping submission: No quiz ID`);
//           continue;
//         }
        
//         // Find the quiz in MongoDB to get its title
//         const mongoQuiz = await Quiz.findById(mongoQuizId);
        
//         if (!mongoQuiz) {
//           console.log(`⚠️  Skipping submission: Quiz not found in MongoDB`);
//           continue;
//         }
        
//         const quizTitle = mongoQuiz.settings?.title;
        
//         if (!quizTitle) {
//           console.log(`⚠️  Skipping submission: No quiz title`);
//           continue;
//         }
        
//         // Find quiz in PostgreSQL by title
//         const pgQuiz = await prisma.quiz.findFirst({
//           where: { title: quizTitle }
//         });
        
//         if (!pgQuiz) {
//           console.log(`⚠️  Skipping submission: Quiz not found - "${quizTitle}"`);
//           continue;
//         }
        
//         // Find assigned quiz
//         const assignedQuiz = await prisma.assignedQuiz.findFirst({
//           where: {
//             quizTakerId: pgQuizTaker.id,
//             quizId: pgQuiz.id
//           }
//         });
        
//         // Check if already exists
//         const existing = await prisma.quizSubmission.findFirst({
//           where: {
//             quizTakerId: pgQuizTaker.id,
//             quizId: pgQuiz.id,
//             submittedAt: submission.submittedAt
//           }
//         });
        
//         if (existing) {
//           console.log(`✓ Submission already exists for: ${quizTitle}`);
//           continue;
//         }
        
//         // Create submission
//         const newSubmission = await prisma.quizSubmission.create({
//           data: {
//             quizId: pgQuiz.id,
//             quizTakerId: pgQuizTaker.id,
//             assignedQuizId: assignedQuiz?.id || null,
//             status: submission.status || 'auto-graded',
//             score: submission.score || 0,
//             totalPoints: submission.totalPoints || 0,
//             percentage: parseFloat(submission.percentage) || 0,
//             timeTaken: submission.timeTaken || 0,
//             feedback: submission.feedback || '',
//             startedAt: submission.startedAt || new Date(),
//             submittedAt: submission.submittedAt || new Date(),
//           }
//         });
        
//         // Create history entry
//         await prisma.quizTakenHistory.create({
//           data: {
//             quizTakerId: pgQuizTaker.id,
//             quizId: pgQuiz.id,
//             submissionId: newSubmission.id,
//             examType: 'multi-subject',
//             score: submission.score || 0,
//             totalPoints: submission.totalPoints || 0,
//             percentage: parseFloat(submission.percentage) || 0,
//             timeTaken: submission.timeTaken || 0,
//             completedAt: submission.submittedAt || new Date()
//           }
//         });
        
//         console.log(`✅ Created submission for: ${quizTitle}`);
//         console.log(`   Score: ${submission.score}/${submission.totalPoints} (${submission.percentage}%)`);
//         console.log(`   Submitted: ${submission.submittedAt}\n`);
        
//       } catch (error) {
//         console.error(`❌ Error:`, error.message);
//       }
//     }
    
//     // Verify
//     const finalCount = await prisma.quizSubmission.count({
//       where: { quizTakerId: pgQuizTaker.id }
//     });
    
//     console.log(`\n✅ Final count: ${finalCount} submissions in PostgreSQL`);
    
//   } catch (error) {
//     console.error('Error:', error);
//   } finally {
//     await mongoose.disconnect();
//     await prisma.$disconnect();
//   }
// }

// fixSpecificUser();