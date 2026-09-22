const express = require("express");
const router = express.Router();
const { verifyQuizTaker } = require("../middleware/auth");
const prisma = require('../utils/database');

// @route   GET /api/quiztaker/dashboard
// @desc    Get quiz taker dashboard data
// @access  Private (Quiz taker only)
router.get("/dashboard", verifyQuizTaker, async (req, res) => {
  try {
    // Changed from: QuizTaker.findById().select().populate()
    const quizTaker = await prisma.quizTaker.findUnique({
      where: { id: req.quizTaker.id },
      include: {
        assignedQuizzes: {
          include: {
            quiz: {
              select: {
                id: true,
                title: true,
                isQuizChallenge: true,
                isOpenQuiz: true,
                description: true,
              }
            },
            submissions: {
              select: {
                id: true,
                score: true,
                totalPoints: true,
                percentage: true,
                submittedAt: true,
                status: true,
              },
              orderBy: {
                submittedAt: 'desc'
              },
              take: 1 // Get latest submission
            }
          }
        }
      }
    });
    res.json({
      success: true,
      quizTaker: {
        id: quizTaker.id,
        email: quizTaker.email,
        accessCode: quizTaker.accessCode,
        assignedQuizzes: quizTaker.assignedQuizzes,
        createdAt: quizTaker.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/profile
// @desc    Get quiz taker profile
// @access  Private (Quiz taker only)
router.get("/profile", verifyQuizTaker, async (req, res) => {
  try {
    // Changed from: using req.quizTaker with embedded arrays
    const [quizTaker, completedCount] = await Promise.all([
      prisma.quizTaker.findUnique({
        where: { id: req.quizTaker.id },
        include: {
          assignedQuizzes: {
            select: {
              id: true,
              status: true,
            }
          }
        }
      }),
      prisma.assignedQuiz.count({
        where: {
          quizTakerId: req.quizTaker.id,
          status: 'completed'
        }
      })
    ]);

    res.json({
      success: true,
      profile: {
        id: quizTaker.id,
        email: quizTaker.email,
        accessCode: quizTaker.accessCode,
        totalQuizzesAssigned: quizTaker.assignedQuizzes.length,
        completedQuizzes: completedCount,
        memberSince: quizTaker.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/quiz/:quizId
// @desc    Get quiz details with all question sets (without answers)
// @access  Private (Quiz taker only)
router.get("/quiz/:quizId", verifyQuizTaker, async (req, res) => {
  try {
    // Check if quiz is assigned to this quiz taker
    // Changed from: QuizTaker.findById() then checking embedded array
    const assignedQuiz = await prisma.assignedQuiz.findFirst({
      where: {
        quizTakerId: req.quizTaker.id,
        quizId: req.params.quizId
      },
      include: {
        questionSetOrder: {
          orderBy: {
            position: 'asc'
          }
        }
      }
    });

    if (!assignedQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not assigned to you",
      });
    }

    if (assignedQuiz.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "You have already completed this quiz",
      });
    }

    // Changed from: Quiz.findById()
    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.quizId },
      include: {
        questionSets: {
          include: {
            questions: true
          },
          orderBy: {
            orderNum: 'asc'
          }
        }
      }
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    if (!quiz.isActive) {
      return res.status(400).json({
        success: false,
        message: "This quiz is not currently active",
      });
    }

    const questionSetsOverview = quiz.questionSets.map((qs) => ({
      id: qs.id,
      questionSetId: qs.questionSetId,
      title: qs.title,
      order: qs.orderNum,
      totalPoints: qs.totalPoints,
      questionCount: qs.questions.length,
    }));

    // Get selected question set order
    const selectedQuestionSetOrder = assignedQuiz.questionSetOrder.length > 0
      ? assignedQuiz.questionSetOrder.map(qso => qso.orderValue)
      : null;

    res.json({
      success: true,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        coverImage: quiz.coverImage,
        description: quiz.description,
        instructions: quiz.instructions,
        durationHours: quiz.durationHours,
        durationMinutes: quiz.durationMinutes,
        durationSeconds: quiz.durationSeconds,
        multipleAttempts: quiz.multipleAttempts,
        looseFocus: quiz.looseFocus,
        viewAnswer: quiz.viewAnswer,
        viewResults: quiz.viewResults,
        displayCalculator: quiz.displayCalculator,
        questionSets: questionSetsOverview,
        totalPoints: quiz.totalPoints,
      },
      assignmentStatus: assignedQuiz.status,
      selectedQuestionSetOrder: selectedQuestionSetOrder,
    });
  } catch (error) {
    console.error("Error fetching quiz:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/quiz/:quizId/question-set/:questionSetOrder
// @desc    Get specific question set questions (without answers)
// @access  Private (Quiz taker only)
router.get("/quiz/:quizId/question-set/:questionSetOrder", verifyQuizTaker, async (req, res) => {
  try {
    const questionSetOrder = parseInt(req.params.questionSetOrder);

    // Changed from: QuizTaker.findById() then checking embedded array
    const assignedQuiz = await prisma.assignedQuiz.findFirst({
      where: {
        quizTakerId: req.quizTaker.id,
        quizId: req.params.quizId
      }
    });

    if (!assignedQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not assigned to you",
      });
    }

    // Changed from: Quiz.findById()
    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.quizId },
      include: {
        questionSets: {
          where: {
            orderNum: questionSetOrder
          },
          include: {
            questions: {
              orderBy: {
                orderNum: 'asc'
              }
            }
          }
        }
      }
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    const questionSet = quiz.questionSets[0];

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    const questionsWithoutAnswers = questionSet.questions.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      options: q.options,
      points: q.points,
      order: q.orderNum,
    }));

    res.json({
      success: true,
      questionSet: {
        id: questionSet.id,
        title: questionSet.title,
        order: questionSet.orderNum,
        totalPoints: questionSet.totalPoints,
        questions: questionsWithoutAnswers,
      },
    });
  } catch (error) {
    console.error("Error fetching question set:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/quiztaker/quiz/:quizId/set-question-order
// @desc    Set custom question set order for quiz taker
// @access  Private (Quiz taker only)
router.post("/quiz/:quizId/set-question-order", verifyQuizTaker, async (req, res) => {
  try {
    const { questionSetOrder } = req.body;

    if (!questionSetOrder || !Array.isArray(questionSetOrder)) {
      return res.status(400).json({
        success: false,
        message: "questionSetOrder must be an array of question-set order numbers",
      });
    }

    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.quizId },
      select: { questionSets: { select: { orderNum: true }, orderBy: { orderNum: 'asc' } } },
    });
    const validOrder = quiz?.questionSets.map(({ orderNum }) => orderNum) || [];
    const sorted = [...questionSetOrder].sort((a, b) => a - b);
    if (sorted.length !== validOrder.length || sorted.join(',') !== validOrder.join(',')) {
      return res.status(400).json({
        success: false,
        message: `questionSetOrder must contain [${validOrder.join(',')}] in any order`,
      });
    }

    // Changed from: QuizTaker.findById() then checking embedded array
    const assignedQuiz = await prisma.assignedQuiz.findFirst({
      where: {
        quizTakerId: req.quizTaker.id,
        quizId: req.params.quizId
      },
      include: {
        questionSetProgress: true
      }
    });

    if (!assignedQuiz) {
      return res.status(403).json({
        success: false,
        message: "This quiz is not assigned to you",
      });
    }

    if (assignedQuiz.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Cannot change order for completed quiz",
      });
    }

    if (assignedQuiz.status === "in-progress" && assignedQuiz.questionSetProgress.length > 0) {
      const anyCompleted = assignedQuiz.questionSetProgress.some(
        qsp => qsp.status === 'completed'
      );
      
      if (anyCompleted) {
        return res.status(400).json({
          success: false,
          message: "Cannot change order after submitting question sets",
        });
      }
    }

    // Update using transaction
    await prisma.$transaction(async (tx) => {
      // Delete existing order
      await tx.questionSetOrder.deleteMany({
        where: { assignedQuizId: assignedQuiz.id }
      });

      // Create new order
      await tx.questionSetOrder.createMany({
        data: questionSetOrder.map((orderValue, index) => ({
          assignedQuizId: assignedQuiz.id,
          position: index,
          orderValue: orderValue
        }))
      });

      // Delete and recreate progress to match new order
      await tx.questionSetProgress.deleteMany({
        where: { assignedQuizId: assignedQuiz.id }
      });

      await tx.questionSetProgress.createMany({
        data: questionSetOrder.map((orderValue, index) => ({
          assignedQuizId: assignedQuiz.id,
          questionSetOrder: orderValue,
          selectedOrder: index + 1,
          status: 'not-started',
          score: 0,
          totalPoints: 0
        }))
      });

      await tx.assignedQuiz.update({
        where: { id: assignedQuiz.id },
        data: { currentQuestionSetOrder: questionSetOrder[0] },
      });
    });

    res.json({
      success: true,
      message: "Question set order saved successfully",
      questionSetOrder,
      currentQuestionSetOrder: questionSetOrder[0],
    });
  } catch (error) {
    console.error("Error setting question order:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

async function ensureQuestionSetProgress(tx, assignedQuiz, quiz) {
  const orderRows = await tx.questionSetOrder.findMany({
    where: { assignedQuizId: assignedQuiz.id },
    orderBy: { position: 'asc' },
  });
  const order = orderRows.length
    ? orderRows.map(({ orderValue }) => orderValue)
    : quiz.questionSets.map(({ orderNum }) => orderNum);
  await tx.questionSetProgress.createMany({
    data: order.map((questionSetOrder, index) => ({
      assignedQuizId: assignedQuiz.id,
      questionSetOrder,
      selectedOrder: index + 1,
      status: 'not-started',
      score: 0,
      totalPoints: 0,
    })),
    skipDuplicates: true,
  });
  return order;
}

// @route   GET /api/quiztaker/quiz/:quizId/progress
// @desc    Get detailed quiz progress (restored from prod).
router.get('/quiz/:quizId/progress', verifyQuizTaker, async (req, res) => {
  try {
    const progress = await prisma.$transaction(async (tx) => {
      const assignedQuiz = await tx.assignedQuiz.findFirst({
        where: { quizTakerId: req.quizTaker.id, quizId: req.params.quizId },
      });
      if (!assignedQuiz) return null;
      const quiz = await tx.quiz.findUnique({
        where: { id: req.params.quizId },
        include: { questionSets: { include: { questions: true }, orderBy: { orderNum: 'asc' } } },
      });
      if (!quiz) throw new Error('Quiz not found');
      const selectedQuestionSetOrder = await ensureQuestionSetProgress(tx, assignedQuiz, quiz);
      const rows = await tx.questionSetProgress.findMany({
        where: { assignedQuizId: assignedQuiz.id },
        orderBy: { selectedOrder: 'asc' },
      });
      return {
        quizId: quiz.id,
        quizTitle: quiz.title,
        status: assignedQuiz.status,
        startedAt: assignedQuiz.startedAt,
        completedAt: assignedQuiz.completedAt,
        selectedQuestionSetOrder,
        currentQuestionSetOrder: assignedQuiz.currentQuestionSetOrder,
        questionSets: rows.map((row) => {
          const details = quiz.questionSets.find((set) => set.orderNum === row.questionSetOrder);
          return {
            questionSetOrder: row.questionSetOrder,
            title: details?.title || 'Unknown',
            selectedOrder: row.selectedOrder,
            status: row.status,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            score: row.score,
            totalPoints: row.totalPoints || details?.totalPoints || 0,
            questionCount: details?.questions.length || 0,
            percentage: row.totalPoints ? Math.round((row.score / row.totalPoints) * 100) : 0,
          };
        }),
        overallProgress: {
          completed: rows.filter((row) => row.status === 'completed').length,
          total: quiz.questionSets.length,
          percentage: quiz.questionSets.length ? Math.round((rows.filter((row) => row.status === 'completed').length / quiz.questionSets.length) * 100) : 0,
        },
      };
    });
    if (!progress) return res.status(403).json({ success: false, message: 'This quiz is not assigned to you' });
    res.json({ success: true, progress });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   POST /api/quiztaker/quiz/:quizId/start
router.post('/quiz/:quizId/start', verifyQuizTaker, async (req, res) => {
  try {
    const started = await prisma.$transaction(async (tx) => {
      const assignment = await tx.assignedQuiz.findFirst({ where: { quizTakerId: req.quizTaker.id, quizId: req.params.quizId } });
      if (!assignment) return null;
      if (assignment.status === 'completed') return { completed: true };
      if (assignment.status === 'in-progress') return { alreadyStarted: true, startedAt: assignment.startedAt };
      const quiz = await tx.quiz.findUnique({ where: { id: req.params.quizId }, include: { questionSets: { orderBy: { orderNum: 'asc' } } } });
      if (!quiz) throw new Error('Quiz not found');
      const now = new Date();
      await tx.assignedQuiz.update({ where: { id: assignment.id }, data: { status: 'in-progress', startedAt: now } });
      await ensureQuestionSetProgress(tx, assignment, quiz);
      return { startedAt: now };
    });
    if (!started) return res.status(403).json({ success: false, message: 'This quiz is not assigned to you' });
    if (started.completed) return res.status(400).json({ success: false, message: 'You have already completed this quiz' });
    if (started.alreadyStarted) return res.json({ success: true, message: 'Quiz already in progress', startedAt: started.startedAt });
    res.json({ success: true, message: 'Quiz started successfully', startedAt: started.startedAt });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   POST /api/quiztaker/quiz/:quizId/question-set/:questionSetOrder/start
router.post('/quiz/:quizId/question-set/:questionSetOrder/start', verifyQuizTaker, async (req, res) => {
  try {
    const questionSetOrder = Number.parseInt(req.params.questionSetOrder, 10);
    const result = await prisma.$transaction(async (tx) => {
      const assignment = await tx.assignedQuiz.findFirst({ where: { quizTakerId: req.quizTaker.id, quizId: req.params.quizId } });
      if (!assignment) return null;
      if (assignment.status === 'completed') return { completed: true };
      const quiz = await tx.quiz.findUnique({ where: { id: req.params.quizId }, include: { questionSets: { orderBy: { orderNum: 'asc' } } } });
      if (!quiz || !quiz.questionSets.some((set) => set.orderNum === questionSetOrder)) return { missing: true };
      await ensureQuestionSetProgress(tx, assignment, quiz);
      const row = await tx.questionSetProgress.findFirst({ where: { assignedQuizId: assignment.id, questionSetOrder } });
      if (row.status === 'completed') return { alreadyCompleted: true };
      const now = new Date();
      await tx.questionSetProgress.update({ where: { id: row.id }, data: { status: 'in-progress', startedAt: row.startedAt || now } });
      await tx.assignedQuiz.update({ where: { id: assignment.id }, data: { status: 'in-progress', startedAt: assignment.startedAt || now, currentQuestionSetOrder: questionSetOrder } });
      return { startedAt: row.startedAt || now };
    });
    if (!result) return res.status(403).json({ success: false, message: 'This quiz is not assigned to you' });
    if (result.completed) return res.status(400).json({ success: false, message: 'Quiz already completed' });
    if (result.missing) return res.status(404).json({ success: false, message: 'Question set not found' });
    if (result.alreadyCompleted) return res.status(400).json({ success: false, message: 'This question set has already been completed' });
    res.json({ success: true, message: 'Question set started successfully', questionSetOrder, startedAt: result.startedAt });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   GET /api/quiztaker/quiz/:quizId/next-question-set
router.get('/quiz/:quizId/next-question-set', verifyQuizTaker, async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const assignment = await tx.assignedQuiz.findFirst({ where: { quizTakerId: req.quizTaker.id, quizId: req.params.quizId } });
      if (!assignment) return null;
      if (assignment.status === 'completed') return { completed: true };
      const quiz = await tx.quiz.findUnique({ where: { id: req.params.quizId }, include: { questionSets: { orderBy: { orderNum: 'asc' } } } });
      if (!quiz) throw new Error('Quiz not found');
      const customOrder = await ensureQuestionSetProgress(tx, assignment, quiz);
      const progress = await tx.questionSetProgress.findMany({ where: { assignedQuizId: assignment.id } });
      return { customOrder, nextQuestionSetOrder: customOrder.find((order) => progress.find((row) => row.questionSetOrder === order)?.status !== 'completed') || null };
    });
    if (!result) return res.status(403).json({ success: false, message: 'This quiz is not assigned to you' });
    if (result.completed) return res.status(400).json({ success: false, message: 'Quiz already completed' });
    if (!result.nextQuestionSetOrder) return res.json({ success: true, message: 'All question sets completed', nextQuestionSetOrder: null, allCompleted: true });
    res.json({ success: true, nextQuestionSetOrder: result.nextQuestionSetOrder, allCompleted: false, customOrder: result.customOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Helper function to auto-grade an answer
function autoGradeAnswer(questionType, userAnswer, correctAnswer) {
  if (questionType === 'essay') {
    return { isCorrect: null, pointsAwarded: 0 }; // Needs manual grading
  }

  if (questionType === 'multiple-choice') {
    const isCorrect = userAnswer === correctAnswer;
    return { isCorrect };
  }

  if (questionType === 'true-false') {
    const isCorrect = userAnswer === correctAnswer;
    return { isCorrect };
  }

  if (questionType === 'fill-in-the-blank' || questionType === 'fill-in-the-blanks') {
    const normalizedUserAnswer = String(userAnswer).trim().toLowerCase();
    const normalizedCorrectAnswer = String(correctAnswer).trim().toLowerCase();
    const isCorrect = normalizedUserAnswer === normalizedCorrectAnswer;
    return { isCorrect };
  }

  return { isCorrect: false };
}

// @route   POST /api/quiztaker/quiz/:quizId/submit
// @desc    Submit quiz answers (one question set at a time or full quiz)
// @access  Private (Quiz taker only)
router.post("/quiz/:quizId/submit", verifyQuizTaker, async (req, res) => {
  try {
    const { answers, questionSetOrder, isFinalSubmission } = req.body;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "Answers array is required",
      });
    }

    if (questionSetOrder === undefined) {
      return res.status(400).json({
        success: false,
        message: "Question set order is required",
      });
    }

    // Use Prisma transactions for atomic operations
    const result = await prisma.$transaction(async (tx) => {
      // Get assigned quiz with lock
      const assignedQuiz = await tx.assignedQuiz.findFirst({
        where: {
          quizTakerId: req.quizTaker.id,
          quizId: req.params.quizId
        },
        include: {
          questionSetProgress: true
        }
      });

      if (!assignedQuiz) {
        throw new Error("This quiz is not assigned to you");
      }

      // Get quiz with questions
      const quiz = await tx.quiz.findUnique({
        where: { id: req.params.quizId },
        include: {
          questionSets: {
            include: {
              questions: true
            },
            orderBy: {
              orderNum: 'asc'
            }
          }
        }
      });

      if (!quiz) {
        throw new Error("Quiz not found");
      }

      // Find the question set being submitted
      const questionSet = quiz.questionSets.find(qs => qs.orderNum === questionSetOrder);
      
      if (!questionSet) {
        throw new Error(`Question set with order ${questionSetOrder} not found`);
      }

      // Find or create submission
      let submission = await tx.quizSubmission.findFirst({
        where: {
          quizId: req.params.quizId,
          quizTakerId: req.quizTaker.id,
          status: 'in-progress'
        },
        include: {
          answers: true
        }
      });

      const isNewSubmission = !submission;
      
      if (isNewSubmission) {
        // Start new submission
        const now = new Date();
        submission = await tx.quizSubmission.create({
          data: {
            quizId: req.params.quizId,
            quizTakerId: req.quizTaker.id,
            assignedQuizId: assignedQuiz.id,
            status: 'in-progress',
            score: 0,
            totalPoints: quiz.totalPoints,
            percentage: 0,
            timeTaken: 0,
            startedAt: now,
            submittedAt: now, // Will be updated on final submission
          },
          include: {
            answers: true
          }
        });

        // Update assigned quiz status
        await tx.assignedQuiz.update({
          where: { id: assignedQuiz.id },
          data: {
            status: 'in-progress',
            startedAt: now
          }
        });
      }

      // Process answers for this question set
      let questionSetScore = 0;

      for (const answerData of answers) {
        const question = questionSet.questions.find(q => q.id === answerData.questionId);
        
        if (!question) {
          console.warn(`Question ${answerData.questionId} not found in question set`);
          continue;
        }

        // Auto-grade the answer
        const gradeResult = autoGradeAnswer(
          question.type,
          answerData.answer,
          question.correctAnswer
        );

        const pointsAwarded = gradeResult.isCorrect === true ? question.points : 0;
        
        // Check if answer already exists
        const existingAnswer = await tx.submissionAnswer.findFirst({
          where: {
            submissionId: submission.id,
            quizQuestionId: question.id
          }
        });

        if (existingAnswer) {
          // Update existing answer
          await tx.submissionAnswer.update({
            where: { id: existingAnswer.id },
            data: {
              answer: answerData.answer,
              isCorrect: gradeResult.isCorrect,
              pointsAwarded: pointsAwarded
            }
          });
        } else {
          // Create new answer
          await tx.submissionAnswer.create({
            data: {
              submissionId: submission.id,
              quizQuestionId: question.id,
              questionSetOrder: questionSetOrder,
              questionType: question.type,
              answer: answerData.answer,
              isCorrect: gradeResult.isCorrect,
              pointsAwarded: pointsAwarded,
              pointsPossible: question.points
            }
          });
        }
      }

      // Recalculate from persisted answers so a partial re-submission cannot
      // discard points that were awarded in an earlier request.
      const questionSetAnswers = await tx.submissionAnswer.findMany({
        where: { submissionId: submission.id, questionSetOrder },
      });
      questionSetScore = questionSetAnswers.reduce((sum, answer) => sum + answer.pointsAwarded, 0);

      await tx.questionSetSubmission.upsert({
        where: {
          unique_submission_qs_order: {
            quizSubmissionId: submission.id,
            questionSetOrder,
          },
        },
        create: {
          quizSubmissionId: submission.id,
          questionSetOrder,
          orderAnswered: (await tx.questionSetProgress.count({ where: { assignedQuizId: assignedQuiz.id, status: 'completed' } })) + 1,
          score: questionSetScore,
          totalPoints: questionSet.totalPoints,
          percentage: questionSet.totalPoints ? (questionSetScore / questionSet.totalPoints) * 100 : 0,
          submittedAt: new Date(),
        },
        update: {
          score: questionSetScore,
          totalPoints: questionSet.totalPoints,
          percentage: questionSet.totalPoints ? (questionSetScore / questionSet.totalPoints) * 100 : 0,
          submittedAt: new Date(),
        },
      });

      // Update question set progress
      const existingProgress = await tx.questionSetProgress.findFirst({
        where: {
          assignedQuizId: assignedQuiz.id,
          questionSetOrder: questionSetOrder
        }
      });

      if (existingProgress) {
        await tx.questionSetProgress.update({
          where: { id: existingProgress.id },
          data: {
            status: 'completed',
            score: questionSetScore,
            totalPoints: questionSet.totalPoints,
            completedAt: new Date()
          }
        });
      } else {
        await tx.questionSetProgress.create({
          data: {
            assignedQuizId: assignedQuiz.id,
            questionSetOrder: questionSetOrder,
            status: 'completed',
            score: questionSetScore,
            totalPoints: questionSet.totalPoints,
            completedAt: new Date()
          }
        });
      }

      // Calculate total score from all answers
      const allAnswers = await tx.submissionAnswer.findMany({
        where: { submissionId: submission.id }
      });

      const totalScore = allAnswers.reduce((sum, ans) => sum + ans.pointsAwarded, 0);
      const percentage = quiz.totalPoints > 0 ? (totalScore / quiz.totalPoints) * 100 : 0;

      // Handle final submission
      if (isFinalSubmission) {
        const endTime = new Date();
        const timeTaken = Math.floor((endTime - submission.startedAt) / 1000);
        
        const hasEssay = allAnswers.some((answer) => answer.questionType === 'essay');
        const finalStatus = hasEssay ? "pending-manual-grading" : "auto-graded";

        await tx.quizSubmission.update({
          where: { id: submission.id },
          data: {
            score: totalScore,
            percentage: percentage,
            timeTaken: timeTaken,
            submittedAt: endTime,
            status: finalStatus
          }
        });

        await tx.assignedQuiz.update({
          where: { id: assignedQuiz.id },
          data: {
            status: 'completed',
            completedAt: endTime
          }
        });

        // Create quiz history entry
        await tx.quizTakenHistory.create({
          data: {
            quizTakerId: req.quizTaker.id,
            quizId: quiz.id,
            submissionId: submission.id,
            examType: quiz.examType,
            score: totalScore,
            totalPoints: quiz.totalPoints,
            percentage: percentage,
            timeTaken: timeTaken,
            completedAt: endTime
          }
        });
      } else {
        // Just update the current scores
        await tx.quizSubmission.update({
          where: { id: submission.id },
          data: {
            score: totalScore,
            percentage: percentage
          }
        });
      }

      return {
        submissionId: submission.id,
        questionSetScore,
        questionSetTotalPoints: questionSet.totalPoints,
        overallScore: totalScore,
        overallTotalPoints: quiz.totalPoints,
        percentage: percentage,
        isFinalSubmission: isFinalSubmission || false,
        status: isFinalSubmission ? (hasEssay ? "pending-manual-grading" : "auto-graded") : "in-progress"
      };
    }, {
      maxWait: 5000, // Maximum time to wait for a transaction slot
      timeout: 10000 // Maximum time for the transaction
    });

    res.json({
      success: true,
      message: result.isFinalSubmission ? "Quiz submitted successfully" : "Question set submitted successfully",
      submission: result
    });

  } catch (error) {
    console.error("Submit quiz error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/submission/:submissionId
// @desc    Get submission results
// @access  Private (Quiz taker only)
router.get("/submission/:submissionId", verifyQuizTaker, async (req, res) => {
  try {
    // Changed from: QuizSubmission.findById().populate()
    const submission = await prisma.quizSubmission.findUnique({
      where: { id: req.params.submissionId },
      include: {
        quiz: {
          include: {
            questionSets: {
              include: {
                questions: true
              },
              orderBy: {
                orderNum: 'asc'
              }
            }
          }
        },
        answers: true
      }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found",
      });
    }

    // Verify submission belongs to this quiz taker
    if (submission.quizTakerId !== req.quizTaker.id) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const quiz = submission.quiz;

    // Check quiz settings for what to show
    const canViewAnswers = quiz.viewAnswer;
    const canViewResults = quiz.viewResults;

    if (!canViewResults) {
      return res.status(403).json({
        success: false,
        message: "Results viewing is not allowed for this quiz",
      });
    }

    let responseData = {
      success: true,
      submission: {
        id: submission.id,
        score: submission.score,
        totalPoints: submission.totalPoints,
        percentage: submission.percentage,
        timeTaken: submission.timeTaken,
        submittedAt: submission.submittedAt,
        status: submission.status,
        feedback: submission.feedback,
      },
    };

    // Include answers if allowed - organized by question set
    if (canViewAnswers) {
      const answersByQuestionSet = [];

      // Iterate through ALL question sets in the quiz
      for (const questionSet of quiz.questionSets) {
        const questionSetData = {
          questionSetTitle: questionSet.title,
          order: questionSet.orderNum,
          answers: []
        };

        // Get all questions in this question set
        for (const question of questionSet.questions) {
          // Find the submitted answer for this question
          const submittedAnswer = submission.answers.find(
            ans => ans.quizQuestionId === question.id
          );

          if (submittedAnswer) {
            // Question was answered
            questionSetData.answers.push({
              question: question.question,
              type: submittedAnswer.questionType,
              yourAnswer: submittedAnswer.answer,
              correctAnswer: question.correctAnswer,
              isCorrect: submittedAnswer.isCorrect,
              pointsAwarded: submittedAnswer.pointsAwarded,
              pointsPossible: submittedAnswer.pointsPossible,
              wasAnswered: true,
            });
          } else {
            // Question was NOT answered - show as unanswered
            questionSetData.answers.push({
              question: question.question,
              type: question.type,
              yourAnswer: null,
              correctAnswer: question.correctAnswer,
              isCorrect: false,
              pointsAwarded: 0,
              pointsPossible: question.points,
              wasAnswered: false,
            });
          }
        }

        answersByQuestionSet.push(questionSetData);
      }

      // Already sorted by questionSet order
      responseData.submission.answersByQuestionSet = answersByQuestionSet;
    }

    res.json(responseData);
  } catch (error) {
    console.error('Submission results error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiztaker/my-submissions
// @desc    Get all submissions from quiz history
// @access  Private (Quiz taker only)
router.get("/my-submissions", verifyQuizTaker, async (req, res) => {
  try {
    // Changed from: QuizTaker.findById().select().populate()
    const submissions = await prisma.quizTakenHistory.findMany({
      where: {
        quizTakerId: req.quizTaker.id
      },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            isQuizChallenge: true
          }
        }
      },
      orderBy: {
        completedAt: 'desc'
      }
    });

    res.json({
      success: true,
      count: submissions.length,
      submissions: submissions.map((entry) => ({
        id: entry.id,
        quizId: entry.quiz?.id,
        quizTitle: entry.quiz?.title || 'CBT Exam',
        score: entry.score || 0,
        totalPoints: entry.totalPoints || 0,
        percentage: entry.percentage || 0,
        completedAt: entry.completedAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching submissions:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;
