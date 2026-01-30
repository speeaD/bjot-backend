// MongoDB to PostgreSQL Data Migration Script
// Run this script after setting up PostgreSQL schema

const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

// Import MongoDB models
const Admin = require('../models/Admin');
const QuestionSet = require('../models/QuestionSet');
const Quiz = require('../models/Quiz');
const QuizTaker = require('../models/QuizTaker');
const QuizSubmission = require('../models/QuizSubmission');
const CbtSubmission = require('../models/CbtModel');
const GameSession = require('../models/GameSession');

// Mapping for MongoDB IDs to PostgreSQL UUIDs
const idMap = {
  admins: new Map(),
  questionSets: new Map(),
  questions: new Map(),
  quizzes: new Map(),
  quizQuestionSets: new Map(),
  quizTakers: new Map(),
  quizSubmissions: new Map(),
};

async function migrateAdmins() {
  console.log('📝 Migrating Admins...');
  
  const mongoAdmins = await Admin.find({});
  console.log(`Found ${mongoAdmins.length} admins`);

  for (const admin of mongoAdmins) {
    try {
      const newAdmin = await prisma.admin.create({
        data: {
          email: admin.email,
          password: admin.password, // Already hashed
          role: admin.role,
          createdAt: admin.createdAt,
        },
      });

      idMap.admins.set(admin._id.toString(), newAdmin.id);
      console.log(`✅ Migrated admin: ${admin.email}`);
    } catch (error) {
      console.error(`❌ Error migrating admin ${admin.email}:`, error.message);
    }
  }
}

async function migrateQuestionSets() {
  console.log('\n📚 Migrating Question Sets...');
  
  const mongoQuestionSets = await QuestionSet.find({}).populate('createdBy');
  console.log(`Found ${mongoQuestionSets.length} question sets`);

  for (const qs of mongoQuestionSets) {
    try {
      const createdById = idMap.admins.get(qs.createdBy._id.toString());
      
      if (!createdById) {
        console.error(`❌ Admin not found for question set: ${qs.title}`);
        continue;
      }

      // Create question set
      const newQuestionSet = await prisma.questionSet.create({
        data: {
          title: qs.title,
          totalPoints: qs.totalPoints,
          questionCount: qs.questionCount,
          isActive: qs.isActive,
          createdById: createdById,
          createdAt: qs.createdAt,
          updatedAt: qs.updatedAt,
        },
      });

      idMap.questionSets.set(qs._id.toString(), newQuestionSet.id);

      // Create questions
      for (const question of qs.questions) {
        const newQuestion = await prisma.question.create({
          data: {
            questionSetId: newQuestionSet.id,
            type: question.type,
            question: question.question,
            options: question.options || null,
            correctAnswer: question.correctAnswer || null,
            points: question.points,
            orderNum: question.order,
          },
        });

        idMap.questions.set(question._id.toString(), newQuestion.id);
      }

      console.log(`✅ Migrated question set: ${qs.title} (${qs.questions.length} questions)`);
    } catch (error) {
      console.error(`❌ Error migrating question set ${qs.title}:`, error.message);
    }
  }
}

async function migrateQuizzes() {
  console.log('\n🎯 Migrating Quizzes...');
  
  const mongoQuizzes = await Quiz.find({}).populate('createdBy');
  console.log(`Found ${mongoQuizzes.length} quizzes`);

  for (const quiz of mongoQuizzes) {
    try {
      const createdById = idMap.admins.get(quiz.createdBy._id.toString());
      
      if (!createdById) {
        console.error(`❌ Admin not found for quiz: ${quiz.settings.title}`);
        continue;
      }

      // Create quiz
      const newQuiz = await prisma.quiz.create({
        data: {
          title: quiz.settings.title,
          coverImage: quiz.settings.coverImage,
          isQuizChallenge: quiz.settings.isQuizChallenge,
          isOpenQuiz: quiz.settings.isOpenQuiz,
          description: quiz.settings.description,
          instructions: quiz.settings.instructions,
          durationHours: quiz.settings.duration.hours,
          durationMinutes: quiz.settings.duration.minutes,
          durationSeconds: quiz.settings.duration.seconds,
          multipleAttempts: quiz.settings.multipleAttempts,
          looseFocus: quiz.settings.looseFocus,
          viewAnswer: quiz.settings.viewAnswer,
          viewResults: quiz.settings.viewResults,
          displayCalculator: quiz.settings.displayCalculator,
          totalPoints: quiz.totalPoints,
          isActive: quiz.isActive,
          createdById: createdById,
          createdAt: quiz.createdAt,
          updatedAt: quiz.updatedAt,
        },
      });

      idMap.quizzes.set(quiz._id.toString(), newQuiz.id);

      // Create quiz question sets
      for (const qqs of quiz.questionSets) {
        const questionSetId = idMap.questionSets.get(qqs.questionSetId.toString());
        
        if (!questionSetId) {
          console.error(`❌ Question set not found for quiz: ${quiz.settings.title}`);
          continue;
        }

        const newQuizQuestionSet = await prisma.quizQuestionSet.create({
          data: {
            quizId: newQuiz.id,
            questionSetId: questionSetId,
            title: qqs.title,
            orderNum: qqs.order,
            totalPoints: qqs.totalPoints,
          },
        });

        idMap.quizQuestionSets.set(
          `${quiz._id.toString()}-${qqs.order}`,
          newQuizQuestionSet.id
        );

        // Create quiz questions (snapshots)
        for (const question of qqs.questions) {
          const originalQuestionId = question.originalQuestionId 
            ? idMap.questions.get(question.originalQuestionId.toString())
            : null;

          await prisma.quizQuestion.create({
            data: {
              quizQuestionSetId: newQuizQuestionSet.id,
              originalQuestionId: originalQuestionId,
              type: question.type,
              question: question.question,
              options: question.options || null,
              correctAnswer: question.correctAnswer || null,
              points: question.points,
              orderNum: question.order,
            },
          });
        }
      }

      console.log(`✅ Migrated quiz: ${quiz.settings.title}`);
    } catch (error) {
      console.error(`❌ Error migrating quiz ${quiz.settings?.title}:`, error.message);
    }
  }
}

async function migrateQuizTakers() {
  console.log('\n👥 Migrating Quiz Takers...');
  
  const mongoQuizTakers = await QuizTaker.find({});
  console.log(`Found ${mongoQuizTakers.length} quiz takers`);

  for (const taker of mongoQuizTakers) {
    try {
      // Create quiz taker
      const newQuizTaker = await prisma.quizTaker.create({
        data: {
          accountType: taker.accountType,
          name: taker.name,
          email: taker.email,
          accessCode: taker.accessCode,
          isActive: taker.isActive,
          createdAt: taker.createdAt,
        },
      });

      idMap.quizTakers.set(taker._id.toString(), newQuizTaker.id);

      // Migrate question set combinations
      if (taker.questionSetCombination && taker.questionSetCombination.length > 0) {
        for (const qsId of taker.questionSetCombination) {
          const questionSetId = idMap.questionSets.get(qsId.toString());
          
          if (questionSetId) {
            await prisma.quizTakerQuestionSet.create({
              data: {
                quizTakerId: newQuizTaker.id,
                questionSetId: questionSetId,
              },
            });
          }
        }
      }

      // Migrate assigned quizzes (for premium students)
      if (taker.assignedQuizzes && taker.assignedQuizzes.length > 0) {
        for (const aq of taker.assignedQuizzes) {
          const quizId = idMap.quizzes.get(aq.quizId.toString());
          
          if (!quizId) continue;

          const assignedQuiz = await prisma.assignedQuiz.create({
            data: {
              quizTakerId: newQuizTaker.id,
              quizId: quizId,
              status: aq.status,
              currentQuestionSetOrder: aq.currentQuestionSetOrder,
              assignedAt: aq.assignedAt,
              startedAt: aq.startedAt,
              completedAt: aq.completedAt,
            },
          });

          // Migrate question set order
          if (aq.selectedQuestionSetOrder && aq.selectedQuestionSetOrder.length > 0) {
            for (let i = 0; i < aq.selectedQuestionSetOrder.length; i++) {
              await prisma.questionSetOrder.create({
                data: {
                  assignedQuizId: assignedQuiz.id,
                  position: i + 1,
                  orderValue: aq.selectedQuestionSetOrder[i],
                },
              });
            }
          }

          // Migrate question set progress
          if (aq.questionSetProgress && aq.questionSetProgress.length > 0) {
            for (const progress of aq.questionSetProgress) {
              await prisma.questionSetProgress.create({
                data: {
                  assignedQuizId: assignedQuiz.id,
                  questionSetOrder: progress.questionSetOrder,
                  selectedOrder: progress.selectedOrder,
                  status: progress.status,
                  score: progress.score,
                  totalPoints: progress.totalPoints,
                  startedAt: progress.startedAt,
                  completedAt: progress.completedAt,
                },
              });
            }
          }
        }
      }

      // Migrate quiz history
      if (taker.quizzesTaken && taker.quizzesTaken.length > 0) {
        for (const history of taker.quizzesTaken) {
          const quizId = history.quizId ? idMap.quizzes.get(history.quizId.toString()) : null;

          const quizHistory = await prisma.quizTakenHistory.create({
            data: {
              quizTakerId: newQuizTaker.id,
              quizId: quizId,
              examType: history.examType,
              score: history.score,
              totalPoints: history.totalPoints,
              percentage: history.percentage,
              timeTaken: history.timeTaken,
              completedAt: history.completedAt,
            },
          });

          // Add question sets for history
          if (history.questionSets && history.questionSets.length > 0) {
            for (const qs of history.questionSets) {
              await prisma.quizHistoryQuestionSet.create({
                data: {
                  quizHistoryId: quizHistory.id,
                  questionSetId: qs.questionSetId ? idMap.questionSets.get(qs.questionSetId.toString()) : null,
                  title: qs.title,
                },
              });
            }
          }
        }
      }

      console.log(`✅ Migrated quiz taker: ${taker.email}`);
    } catch (error) {
      console.error(`❌ Error migrating quiz taker ${taker.email}:`, error.message);
    }
  }
}

async function migrateQuizSubmissions() {
  console.log('\n📄 Migrating Quiz Submissions...');
  
  const mongoSubmissions = await QuizSubmission.find({});
  console.log(`Found ${mongoSubmissions.length} quiz submissions`);

  for (const submission of mongoSubmissions) {
    try {
      const quizId = idMap.quizzes.get(submission.quizId.toString());
      const quizTakerId = idMap.quizTakers.get(submission.quizTakerId.toString());
      const gradedById = submission.gradedBy 
        ? idMap.admins.get(submission.gradedBy.toString()) 
        : null;

      if (!quizId || !quizTakerId) {
        console.error('❌ Quiz or QuizTaker not found for submission');
        continue;
      }

      // Create submission
      const newSubmission = await prisma.quizSubmission.create({
        data: {
          quizId: quizId,
          quizTakerId: quizTakerId,
          status: submission.status,
          score: submission.score,
          totalPoints: submission.totalPoints,
          percentage: submission.percentage,
          timeTaken: submission.timeTaken,
          feedback: submission.feedback,
          gradedById: gradedById,
          gradedAt: submission.gradedAt,
          startedAt: submission.startedAt,
          submittedAt: submission.submittedAt,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt,
        },
      });

      idMap.quizSubmissions.set(submission._id.toString(), newSubmission.id);

      // Note: Answers migration would require mapping quiz questions
      // This is complex and may need manual handling based on your data
      // You'd need to query the quiz, find the corresponding quiz questions,
      // and create submission answers

      // Migrate question set submissions
      if (submission.questionSetSubmissions && submission.questionSetSubmissions.length > 0) {
        for (const qss of submission.questionSetSubmissions) {
          await prisma.questionSetSubmission.create({
            data: {
              quizSubmissionId: newSubmission.id,
              questionSetOrder: qss.questionSetOrder,
              orderAnswered: qss.orderAnswered,
              score: qss.score,
              totalPoints: qss.totalPoints,
              percentage: qss.percentage,
              submittedAt: qss.submittedAt,
            },
          });
        }
      }

      // Migrate question set order used
      if (submission.questionSetOrderUsed && submission.questionSetOrderUsed.length > 0) {
        for (let i = 0; i < submission.questionSetOrderUsed.length; i++) {
          await prisma.submissionQuestionSetOrder.create({
            data: {
              quizSubmissionId: newSubmission.id,
              position: i + 1,
              orderValue: submission.questionSetOrderUsed[i],
            },
          });
        }
      }

      console.log(`✅ Migrated quiz submission for quiz taker ${quizTakerId}`);
    } catch (error) {
      console.error(`❌ Error migrating quiz submission:`, error.message);
    }
  }
}

async function migrateGameSessions() {
  console.log('\n🎮 Migrating Game Sessions...');
  
  const mongoSessions = await GameSession.find({});
  console.log(`Found ${mongoSessions.length} game sessions`);

  for (const session of mongoSessions) {
    try {
      const userId = idMap.quizTakers.get(session.userId.toString());
      const questionSetId = idMap.questionSets.get(session.questionSetId.toString());

      if (!userId || !questionSetId) {
        console.error('❌ User or QuestionSet not found for game session');
        continue;
      }

      const newSession = await prisma.gameSession.create({
        data: {
          userId: userId,
          gameType: session.gameType,
          questionSetId: questionSetId,
          subject: session.subject,
          currentScore: session.currentScore,
          goalScore: session.goalScore,
          questionsAnswered: session.questionsAnswered,
          correctAnswers: session.correctAnswers,
          status: session.status,
          duration: session.duration,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      });

      // Migrate used questions
      if (session.usedQuestionIds && session.usedQuestionIds.length > 0) {
        for (const questionId of session.usedQuestionIds) {
          const pgQuestionId = idMap.questions.get(questionId.toString());
          
          if (pgQuestionId) {
            await prisma.gameUsedQuestion.create({
              data: {
                gameSessionId: newSession.id,
                questionId: pgQuestionId,
              },
            });
          }
        }
      }

      // Migrate history
      if (session.history && session.history.length > 0) {
        for (const h of session.history) {
          await prisma.gameHistory.create({
            data: {
              gameSessionId: newSession.id,
              questionId: h.questionId.toString(),
              question: h.question,
              selectedAnswer: h.selectedAnswer,
              correctAnswer: h.correctAnswer,
              wager: h.wager,
              isCorrect: h.isCorrect,
              pointsChange: h.pointsChange,
              timestamp: h.timestamp,
            },
          });
        }
      }

      console.log(`✅ Migrated game session for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error migrating game session:`, error.message);
    }
  }
}

async function main() {
  try {
    console.log('🚀 Starting migration from MongoDB to PostgreSQL...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/examination-portal');
    console.log('✅ Connected to MongoDB\n');

    // Run migrations in order (due to foreign key constraints)
    await migrateAdmins();
    await migrateQuestionSets();
    await migrateQuizzes();
    await migrateQuizTakers();
    await migrateQuizSubmissions();
    await migrateGameSessions();

    console.log('\n🎉 Migration completed successfully!');
    console.log('\n📊 Migration Summary:');
    console.log(`   Admins: ${idMap.admins.size}`);
    console.log(`   Question Sets: ${idMap.questionSets.size}`);
    console.log(`   Questions: ${idMap.questions.size}`);
    console.log(`   Quizzes: ${idMap.quizzes.size}`);
    console.log(`   Quiz Takers: ${idMap.quizTakers.size}`);
    console.log(`   Quiz Submissions: ${idMap.quizSubmissions.size}`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    await prisma.$disconnect();
  }
}

main();