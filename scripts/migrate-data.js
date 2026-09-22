// MongoDB to PostgreSQL Data Migration Script
// Run this from inside your backend project (so the relative ../models/* requires resolve)
// after `npx prisma db push` has applied schema.prisma to Postgres.
//
//   node scripts/migrate-data.js
//
// Requires MONGODB_URI and DATABASE_URL (or DIRECT_URL) in your .env.

const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');
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
const Schedule = require('../models/Schedule');
const AttendanceSession = require('../models/AttendanceSession');
const AttendanceRecord = require('../models/AttendanceRecord');

// Mapping for MongoDB IDs to PostgreSQL UUIDs (populated as we go, so later
// migrations can resolve the foreign keys of documents migrated earlier).
const idMap = {
  admins: new Map(),
  questionSets: new Map(),
  batches: new Map(),
  questions: new Map(), // keyed by the question's OWN _id, wherever it lives (legacy or batched)
  quizzes: new Map(),
  quizQuestionSets: new Map(), // `${quizId}-${order}` -> pg id
  quizQuestionsByOwnId: new Map(), // quizQuestion mongo _id -> pg id
  quizQuestionsByOriginal: new Map(), // `${quizId}-${questionSetOrder}-${originalQuestionId}` -> pg id
  quizTakers: new Map(),
  quizSubmissions: new Map(),
  schedules: new Map(),
  attendanceSessions: new Map(),
};

// Counters for the summary printed at the end.
const counts = {};
const bump = (key, n = 1) => (counts[key] = (counts[key] || 0) + n);

// Postgres rejects NUL bytes in text; Mongo occasionally has them from bad copy/paste.
const clean = (s) => (typeof s === 'string' ? s.replace(/\u0000/g, '') : s);

// Mongoose typed phone numbers as `Number`. A number with a country code (e.g.
// 2348012345678) overflows Postgres's 32-bit Int, so the Prisma columns are BigInt.
const toBigIntOrNull = (v) => (v === undefined || v === null || v === '' ? null : BigInt(Math.round(Number(v))));

async function migrateAdmins() {
  console.log('📝 Migrating Admins...');

  const mongoAdmins = await Admin.find({});
  console.log(`Found ${mongoAdmins.length} admins`);

  for (const admin of mongoAdmins) {
    try {
      const newAdmin = await prisma.admin.create({
        data: {
          email: admin.email.trim().toLowerCase(),
          password: admin.password, // already hashed - do NOT hash again
          role: admin.role,
          createdAt: admin.createdAt,
        },
      });

      idMap.admins.set(admin._id.toString(), newAdmin.id);
      bump('admins');
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
      const createdById = qs.createdBy ? idMap.admins.get(qs.createdBy._id.toString()) : null;

      if (!createdById) {
        console.error(`❌ Admin not found for question set: ${qs.title}`);
        continue;
      }

      const usesBatches = qs.usesBatches === true;

      // Create the question set first (batches/questions reference it), then patch
      // totalPoints/questionCount once we know the real numbers.
      const newQuestionSet = await prisma.questionSet.create({
        data: {
          title: qs.title,
          usesBatches,
          totalPoints: 0,
          questionCount: 0,
          isActive: qs.isActive,
          createdById,
          createdAt: qs.createdAt,
          updatedAt: qs.updatedAt,
        },
      });
      idMap.questionSets.set(qs._id.toString(), newQuestionSet.id);

      const createQuestion = async (question, batchPgId, orderFallback) => {
        const newQuestion = await prisma.question.create({
          data: {
            questionSetId: newQuestionSet.id,
            batchId: batchPgId,
            type: question.type,
            question: clean(question.question),
            passage: clean(question.passage) || '',
            diagram: question.diagram || null,
            diagramAlt: clean(question.diagramAlt) || '',
            options: question.options && question.options.length ? question.options : undefined,
            correctAnswer: question.correctAnswer ?? undefined,
            points: question.points ?? 1,
            orderNum: question.order ?? orderFallback,
          },
        });
        idMap.questions.set(question._id.toString(), newQuestion.id);
        bump('questions');
        return newQuestion;
      };

      let setTotalPoints = 0;
      let setQuestionCount = 0;

      if (usesBatches) {
        for (const batch of qs.batches || []) {
          const newBatch = await prisma.batch.create({
            data: {
              questionSetId: newQuestionSet.id,
              batchNumber: batch.batchNumber,
              name: batch.name,
              totalPoints: 0,
              questionCount: 0,
              isActive: batch.isActive,
              createdAt: batch.createdAt,
            },
          });
          idMap.batches.set(batch._id.toString(), newBatch.id);
          bump('batches');

          let batchPoints = 0;
          for (let i = 0; i < (batch.questions || []).length; i++) {
            const q = await createQuestion(batch.questions[i], newBatch.id, i + 1);
            batchPoints += q.points;
          }

          await prisma.batch.update({
            where: { id: newBatch.id },
            data: { totalPoints: batchPoints, questionCount: (batch.questions || []).length },
          });

          if (batch.isActive) {
            setTotalPoints += batchPoints;
            setQuestionCount += (batch.questions || []).length;
          }
        }
      } else {
        for (let i = 0; i < (qs.questions || []).length; i++) {
          const q = await createQuestion(qs.questions[i], null, i + 1);
          setTotalPoints += q.points;
        }
        setQuestionCount = (qs.questions || []).length;
      }

      await prisma.questionSet.update({
        where: { id: newQuestionSet.id },
        data: { totalPoints: setTotalPoints, questionCount: setQuestionCount },
      });

      bump('questionSets');
      console.log(`✅ Migrated question set: ${qs.title} (${setQuestionCount} questions${usesBatches ? `, ${(qs.batches || []).length} batches` : ''})`);
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
      const createdById = quiz.createdBy ? idMap.admins.get(quiz.createdBy._id.toString()) : null;

      if (!createdById) {
        console.error(`❌ Admin not found for quiz: ${quiz.settings.title}`);
        continue;
      }

      const newQuiz = await prisma.quiz.create({
        data: {
          examType: quiz.settings.examType || 'multi-subject',
          title: quiz.settings.title,
          coverImage: quiz.settings.coverImage || null,
          isQuizChallenge: quiz.settings.isQuizChallenge,
          isOpenQuiz: quiz.settings.isOpenQuiz,
          description: quiz.settings.description || null,
          instructions: quiz.settings.instructions || null,
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
          createdById,
          createdAt: quiz.createdAt,
          updatedAt: quiz.updatedAt,
        },
      });
      idMap.quizzes.set(quiz._id.toString(), newQuiz.id);
      bump('quizzes');

      for (const qqs of quiz.questionSets) {
        const questionSetId = idMap.questionSets.get(qqs.questionSetId.toString());

        if (!questionSetId) {
          console.error(`❌ Question set not found for quiz: ${quiz.settings.title}`);
          continue;
        }

        const newQuizQuestionSet = await prisma.quizQuestionSet.create({
          data: {
            quizId: newQuiz.id,
            questionSetId,
            // Batch snapshot - informational only, no live FK (the source batch may have
            // since changed). batchId here is the ORIGINAL Mongo batch id translated
            // through idMap.batches, or left as-is if that batch no longer maps.
            batchNumber: qqs.batchNumber ?? null,
            batchId: qqs.batchId ? idMap.batches.get(qqs.batchId.toString()) || null : null,
            batchName: qqs.batchName || null,
            title: qqs.title,
            orderNum: qqs.order,
            totalPoints: qqs.totalPoints,
          },
        });
        idMap.quizQuestionSets.set(`${quiz._id.toString()}-${qqs.order}`, newQuizQuestionSet.id);

        for (const question of qqs.questions) {
          const newQuizQuestion = await prisma.quizQuestion.create({
            data: {
              quizQuestionSetId: newQuizQuestionSet.id,
              originalQuestionId: question.originalQuestionId
                ? idMap.questions.get(question.originalQuestionId.toString()) || null
                : null,
              type: question.type,
              question: clean(question.question),
              passage: clean(question.passage) || '',
              diagram: question.diagram || null,
              diagramAlt: clean(question.diagramAlt) || '',
              options: question.options && question.options.length ? question.options : undefined,
              correctAnswer: question.correctAnswer ?? undefined,
              points: question.points,
              orderNum: question.order,
            },
          });

          idMap.quizQuestionsByOwnId.set(question._id.toString(), newQuizQuestion.id);
          if (question.originalQuestionId) {
            idMap.quizQuestionsByOriginal.set(
              `${quiz._id.toString()}-${qqs.order}-${question.originalQuestionId.toString()}`,
              newQuizQuestion.id
            );
          }
        }
      }

      bump('quizzes-with-sets');
      console.log(`✅ Migrated quiz: ${quiz.settings.title}`);
    } catch (error) {
      console.error(`❌ Error migrating quiz ${quiz.settings?.title}:`, error.message);
    }
  }
}

async function migrateSchedules() {
  console.log('\n📅 Migrating Schedules...');

  const mongoSchedules = await Schedule.find({}).populate('createdBy');
  console.log(`Found ${mongoSchedules.length} schedules`);

  for (const sch of mongoSchedules) {
    try {
      const createdById = sch.createdBy ? idMap.admins.get(sch.createdBy._id.toString()) : null;

      if (!createdById) {
        console.error(`❌ Admin not found for schedule: ${sch.department}`);
        continue;
      }

      const newSchedule = await prisma.schedule.create({
        data: {
          department: sch.department,
          createdById,
          isActive: sch.isActive,
          createdAt: sch.createdAt,
          updatedAt: sch.updatedAt,
        },
      });
      idMap.schedules.set(sch._id.toString(), newSchedule.id);
      bump('schedules');

      for (const cs of sch.weeklySchedule || []) {
        const questionSetId = idMap.questionSets.get(cs.questionSet.toString());
        if (!questionSetId) {
          console.error(`❌ Question set not found for weekly class in schedule: ${sch.department}`);
          continue;
        }
        await prisma.weeklyClassSession.create({
          data: {
            scheduleId: newSchedule.id,
            dayOfWeek: cs.dayOfWeek,
            dayName: cs.dayName,
            questionSetId,
            questionSetTitle: cs.questionSetTitle,
            startTime: cs.startTime,
            endTime: cs.endTime,
            isActive: cs.isActive,
          },
        });
        bump('weeklyClassSessions');
      }

      for (const ov of sch.overrides || []) {
        const cs = ov.classSession || {};
        const questionSetId = cs.questionSet ? idMap.questionSets.get(cs.questionSet.toString()) : null;
        if (!questionSetId) {
          console.error(`❌ Question set not found for schedule override in: ${sch.department}`);
          continue;
        }
        await prisma.scheduleOverride.create({
          data: {
            scheduleId: newSchedule.id,
            date: ov.date,
            questionSetId,
            questionSetTitle: cs.questionSetTitle,
            startTime: cs.startTime,
            endTime: cs.endTime,
            isActive: cs.isActive,
            reason: ov.reason || '',
          },
        });
        bump('scheduleOverrides');
      }

      console.log(`✅ Migrated schedule: ${sch.department}`);
    } catch (error) {
      console.error(`❌ Error migrating schedule ${sch.department}:`, error.message);
    }
  }
}

async function migrateQuizTakers() {
  console.log('\n👥 Migrating Quiz Takers...');

  const mongoQuizTakers = await QuizTaker.find({});
  console.log(`Found ${mongoQuizTakers.length} quiz takers`);

  for (const taker of mongoQuizTakers) {
    try {
      const newQuizTaker = await prisma.quizTaker.create({
        data: {
          accountType: taker.accountType,
          name: taker.name,
          phone: toBigIntOrNull(taker.phone),
          firstJamb: taker.firstJamb ?? true,
          lastJambScore: taker.lastJambScore ?? 0,
          parentName: taker.parentName || null,
          parentPhone: toBigIntOrNull(taker.parentPhone),
          department: taker.department || null,
          course: taker.course || null,
          email: taker.email.trim().toLowerCase(),
          accessCode: taker.accessCode || null,
          isActive: taker.isActive,
          createdAt: taker.createdAt,
        },
      });

      idMap.quizTakers.set(taker._id.toString(), newQuizTaker.id);
      bump('quizTakers');

      // Question set combination
      if (taker.questionSetCombination && taker.questionSetCombination.length > 0) {
        for (const qsId of taker.questionSetCombination) {
          const questionSetId = idMap.questionSets.get(qsId.toString());
          if (questionSetId) {
            await prisma.quizTakerQuestionSet.create({
              data: { quizTakerId: newQuizTaker.id, questionSetId },
            });
          }
        }
      }

      // Assigned quizzes (premium students)
      if (taker.assignedQuizzes && taker.assignedQuizzes.length > 0) {
        for (const aq of taker.assignedQuizzes) {
          const quizId = idMap.quizzes.get(aq.quizId.toString());
          if (!quizId) continue;

          const assignedQuiz = await prisma.assignedQuiz.create({
            data: {
              quizTakerId: newQuizTaker.id,
              quizId,
              status: aq.status,
              currentQuestionSetOrder: aq.currentQuestionSetOrder,
              assignedAt: aq.assignedAt,
              startedAt: aq.startedAt,
              completedAt: aq.completedAt,
            },
          });

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

      // Quiz history
      if (taker.quizzesTaken && taker.quizzesTaken.length > 0) {
        for (const history of taker.quizzesTaken) {
          const quizId = history.quizId ? idMap.quizzes.get(history.quizId.toString()) : null;

          const quizHistory = await prisma.quizTakenHistory.create({
            data: {
              quizTakerId: newQuizTaker.id,
              quizId,
              examType: history.examType,
              score: history.score,
              totalPoints: history.totalPoints,
              percentage: history.percentage,
              timeTaken: history.timeTaken,
              completedAt: history.completedAt,
            },
          });

          if (history.questionSets && history.questionSets.length > 0) {
            for (const qs of history.questionSets) {
              await prisma.quizHistoryQuestionSet.create({
                data: {
                  quizHistoryId: quizHistory.id,
                  questionSetId: qs.questionSetId ? idMap.questionSets.get(qs.questionSetId.toString()) || null : null,
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
      const gradedById = submission.gradedBy ? idMap.admins.get(submission.gradedBy.toString()) || null : null;

      if (!quizId || !quizTakerId) {
        console.error('❌ Quiz or QuizTaker not found for submission');
        continue;
      }

      const newSubmission = await prisma.quizSubmission.create({
        data: {
          quizId,
          quizTakerId,
          status: submission.status,
          score: submission.score,
          totalPoints: submission.totalPoints,
          percentage: submission.percentage,
          timeTaken: submission.timeTaken,
          feedback: submission.feedback || null,
          gradedById,
          gradedAt: submission.gradedAt,
          startedAt: submission.startedAt,
          submittedAt: submission.submittedAt,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt,
        },
      });
      idMap.quizSubmissions.set(submission._id.toString(), newSubmission.id);
      bump('quizSubmissions');

      // Answers - match against the quiz-question snapshot either by its own id, or
      // (older data) by the ORIGINAL question id it was generated from.
      for (const answer of submission.answers || []) {
        const answerQuestionId = answer.questionId.toString();
        const quizQuestionId =
          idMap.quizQuestionsByOwnId.get(answerQuestionId) ||
          idMap.quizQuestionsByOriginal.get(`${submission.quizId.toString()}-${answer.questionSetOrder}-${answerQuestionId}`);

        if (!quizQuestionId) {
          console.error(`❌ Quiz question not found for answer in submission ${submission._id}`);
          continue;
        }

        await prisma.submissionAnswer.create({
          data: {
            submissionId: newSubmission.id,
            quizQuestionId,
            questionSetOrder: answer.questionSetOrder,
            questionType: answer.questionType,
            answer: answer.answer ?? undefined,
            isCorrect: answer.isCorrect,
            pointsAwarded: answer.pointsAwarded,
            pointsPossible: answer.pointsPossible,
          },
        });
        bump('submissionAnswers');
      }

      // Question set submissions - Mongoose's duplicate-order guard doesn't actually
      // abort a save (`return new Error(...)` inside a pre-save hook is a no-op), so
      // duplicates can exist; keep the latest and let Postgres's unique constraint
      // reject the rest (caught below, per-record).
      const seenOrders = new Set();
      for (const qss of submission.questionSetSubmissions || []) {
        if (seenOrders.has(qss.questionSetOrder)) {
          console.error(`❌ Duplicate questionSetOrder ${qss.questionSetOrder} in submission ${submission._id} - skipping extra`);
          continue;
        }
        seenOrders.add(qss.questionSetOrder);
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

async function migrateCbtSubmissions() {
  console.log('\n🖥️  Migrating CBT Submissions...');

  const mongoSubmissions = await CbtSubmission.find({});
  console.log(`Found ${mongoSubmissions.length} CBT submissions`);

  for (const submission of mongoSubmissions) {
    try {
      const quizTakerId = idMap.quizTakers.get(submission.quizTakerId.toString());
      if (!quizTakerId) {
        console.error('❌ QuizTaker not found for CBT submission');
        continue;
      }

      const newSubmission = await prisma.cbtSubmission.create({
        data: {
          quizTakerId,
          score: submission.score,
          totalPoints: submission.totalPoints,
          percentage: submission.percentage,
          timeTaken: submission.timeTaken,
          startedAt: submission.startedAt,
          submittedAt: submission.submittedAt,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt,
        },
      });
      idMap.quizSubmissions.set(`cbt-${submission._id.toString()}`, newSubmission.id);
      bump('cbtSubmissions');

      for (const qs of submission.questionSets || []) {
        const questionSetId = idMap.questionSets.get(qs.questionSetId.toString());
        if (!questionSetId) {
          console.error(`❌ Question set not found for CBT submission ${submission._id}`);
          continue;
        }
        await prisma.cbtQuestionSet.create({
          data: {
            cbtSubmissionId: newSubmission.id,
            questionSetId,
            title: qs.title,
            orderNum: qs.order,
          },
        });
      }

      for (const answer of submission.answers || []) {
        const questionId = answer.questionId ? idMap.questions.get(answer.questionId.toString()) || null : null;
        if (answer.questionId && !questionId) {
          console.error(`❌ Question ${answer.questionId} deleted - CBT answer question_id set to null`);
        }
        await prisma.cbtAnswer.create({
          data: {
            cbtSubmissionId: newSubmission.id,
            questionId,
            questionSetId: answer.questionSetId ? idMap.questionSets.get(answer.questionSetId.toString()) || null : null,
            answer: answer.answer ?? undefined,
            isCorrect: answer.isCorrect,
            pointsAwarded: answer.pointsAwarded,
            pointsPossible: answer.pointsPossible,
          },
        });
      }

      console.log(`✅ Migrated CBT submission for quiz taker ${quizTakerId}`);
    } catch (error) {
      console.error(`❌ Error migrating CBT submission:`, error.message);
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
          userId,
          gameType: session.gameType,
          questionSetId,
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
      bump('gameSessions');

      const usedSeen = new Set();
      for (const questionId of session.usedQuestionIds || []) {
        const pgQuestionId = idMap.questions.get(questionId.toString());
        if (!pgQuestionId || usedSeen.has(pgQuestionId)) continue;
        usedSeen.add(pgQuestionId);
        await prisma.gameUsedQuestion.create({
          data: { gameSessionId: newSession.id, questionId: pgQuestionId },
        });
      }

      for (const h of session.history || []) {
        const pgQuestionId = idMap.questions.get(h.questionId.toString());
        if (!pgQuestionId) {
          console.error(`❌ Question ${h.questionId} not found for game history entry`);
          continue;
        }
        await prisma.gameHistory.create({
          data: {
            gameSessionId: newSession.id,
            questionId: pgQuestionId,
            question: h.question,
            selectedAnswer: h.selectedAnswer,
            correctAnswer: h.correctAnswer ?? undefined,
            wager: h.wager,
            isCorrect: h.isCorrect,
            pointsChange: h.pointsChange,
            timestamp: h.timestamp,
          },
        });
      }

      console.log(`✅ Migrated game session for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error migrating game session:`, error.message);
    }
  }
}

async function migrateAttendanceSessions() {
  console.log('\n🗓️  Migrating Attendance Sessions...');

  const mongoSessions = await AttendanceSession.find({}).populate('createdBy');
  console.log(`Found ${mongoSessions.length} attendance sessions`);

  for (const session of mongoSessions) {
    try {
      const questionSetId = idMap.questionSets.get(session.questionSet.toString());
      const createdById = session.createdBy ? idMap.admins.get(session.createdBy._id.toString()) : null;

      if (!questionSetId || !createdById) {
        console.error(`❌ Question set or admin not found for attendance session ${session._id}`);
        continue;
      }

      const w = session.attendanceWindow || {};
      const newSession = await prisma.attendanceSession.create({
        data: {
          department: session.department,
          questionSetId,
          questionSetTitle: session.questionSetTitle,
          date: session.date,
          scheduledStartTime: session.scheduledStartTime,
          scheduledEndTime: session.scheduledEndTime,
          windowIsOpen: w.isOpen ?? false,
          windowOpenedAt: w.openedAt || null,
          windowClosedAt: w.closedAt || null,
          windowOpenedById: w.openedBy ? idMap.admins.get(w.openedBy.toString()) || null : null,
          windowClosedById: w.closedBy ? idMap.admins.get(w.closedBy.toString()) || null : null,
          windowDurationMinutes: w.durationMinutes ?? 30,
          windowBufferMinutes: w.bufferMinutes ?? 15,
          status: session.status,
          totalStudents: session.totalStudents,
          presentCount: session.presentCount,
          absentCount: session.absentCount,
          createdById,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      });
      idMap.attendanceSessions.set(session._id.toString(), newSession.id);
      bump('attendanceSessions');

      for (const event of session.windowHistory || []) {
        await prisma.attendanceWindowEvent.create({
          data: {
            sessionId: newSession.id,
            action: event.action,
            timestamp: event.timestamp,
            adminId: event.admin ? idMap.admins.get(event.admin.toString()) || null : null,
          },
        });
      }

      console.log(`✅ Migrated attendance session: ${session.department} ${session.date.toISOString().slice(0, 10)}`);
    } catch (error) {
      console.error(`❌ Error migrating attendance session ${session._id}:`, error.message);
    }
  }
}

async function migrateAttendanceRecords() {
  console.log('\n🧾 Migrating Attendance Records...');

  const mongoRecords = await AttendanceRecord.find({});
  console.log(`Found ${mongoRecords.length} attendance records`);

  let migrated = 0;
  for (const record of mongoRecords) {
    try {
      const sessionId = idMap.attendanceSessions.get(record.session.toString());
      const studentId = idMap.quizTakers.get(record.student.toString());

      if (!sessionId || !studentId) {
        console.error(`❌ Session or student not found for attendance record ${record._id}`);
        continue;
      }

      await prisma.attendanceRecord.create({
        data: {
          sessionId,
          studentId,
          studentName: record.studentName,
          studentEmail: record.studentEmail,
          department: record.department,
          status: record.status,
          markedBy: record.markedBy,
          adminId: record.admin ? idMap.admins.get(record.admin.toString()) || null : null,
          markedAt: record.markedAt,
          isLate: record.isLate,
          minutesLate: record.minutesLate,
          notes: record.notes || '',
          createdAt: record.createdAt,
        },
      });
      migrated++;
      if (migrated % 500 === 0) console.log(`  ...${migrated}/${mongoRecords.length} attendance records`);
    } catch (error) {
      console.error(`❌ Error migrating attendance record ${record._id}:`, error.message);
    }
  }
  counts.attendanceRecords = migrated;
  console.log(`✅ Migrated ${migrated} attendance records`);
}

async function main() {
  try {
    console.log('🚀 Starting migration from MongoDB to PostgreSQL...\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Run in FK-safe order.
    await migrateAdmins();
    await migrateQuestionSets();
    await migrateQuizzes();
    await migrateSchedules();
    await migrateGameSessions();
    await migrateAttendanceSessions();
    await migrateAttendanceRecords();

    console.log('\n🎉 Migration completed!');
    console.log('\n📊 Migration Summary:');
    for (const [key, n] of Object.entries(counts)) {
      console.log(`   ${key}: ${n}`);
    }
    console.log('\n⚠️  Review the ❌ lines above (if any) - those rows were skipped, not migrated.');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    await prisma.$disconnect();
  }
}

main();