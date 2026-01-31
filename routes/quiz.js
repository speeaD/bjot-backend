const express = require("express");
const router = express.Router();
const { verifyAdmin } = require("../middleware/auth");
const prisma = require("../utils/database");

router.post("/", verifyAdmin, async (req, res) => {
  try {
    const { questionSetCombination, questionFilters, settings } = req.body;

    // Validation
    if (!settings || !settings.title) {
      return res.status(400).json({
        success: false,
        message: "Quiz title is required",
      });
    }

    if (
      !questionSetCombination ||
      !Array.isArray(questionSetCombination) ||
      questionSetCombination.length !== 4
    ) {
      return res.status(400).json({
        success: false,
        message: "Exactly 4 question set IDs are required",
      });
    }

    // Fetch question sets
    const questionSets = await prisma.questionSet.findMany({
      where: {
        id: { in: questionSetCombination },
        isActive: true,
      },
      include: {
        questions: {
          where: { isArchived: false },
          orderBy: { orderNum: "asc" },
        },
      },
    });

    if (questionSets.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "One or more question sets not found or inactive",
      });
    }

    // Filter questions based on provided criteria
    const quizQuestionSets = await Promise.all(
      questionSetCombination.map(async (setId, index) => {
        const questionSet = questionSets.find((qs) => qs.id === setId);

        if (!questionSet) {
          throw new Error(`Question set with ID ${setId} not found`);
        }

        // Get filter for this question set (if provided)
        const filter = questionFilters?.[index] || questionFilters?.[setId];

        // Filter questions based on criteria
        let questionsToInclude = questionSet.questions;

        if (filter) {
          // Apply batch filter
          if (filter.batchNumber !== undefined) {
            questionsToInclude = questionsToInclude.filter(
              (q) => q.batchNumber === filter.batchNumber,
            );
          }

          // Apply version filter
          if (filter.version) {
            questionsToInclude = questionsToInclude.filter(
              (q) => q.version === filter.version,
            );
          }

          // Apply date range filter
          if (filter.dateFrom || filter.dateTo) {
            questionsToInclude = questionsToInclude.filter((q) => {
              const addedDate = new Date(q.addedDate);
              const passesFrom =
                !filter.dateFrom || addedDate >= new Date(filter.dateFrom);
              const passesTo =
                !filter.dateTo || addedDate <= new Date(filter.dateTo);
              return passesFrom && passesTo;
            });
          }

          // Apply tag filter
          if (filter.tags && Array.isArray(filter.tags)) {
            questionsToInclude = questionsToInclude.filter((q) => {
              const questionTags = Array.isArray(q.tags) ? q.tags : [];
              return filter.tags.some((tag) => questionTags.includes(tag));
            });
          }

          // Apply specific question IDs filter
          if (filter.questionIds && Array.isArray(filter.questionIds)) {
            questionsToInclude = questionsToInclude.filter((q) =>
              filter.questionIds.includes(q.id),
            );
          }

          // Apply limit (max number of questions)
          if (filter.limit && filter.limit > 0) {
            questionsToInclude = questionsToInclude.slice(0, filter.limit);
          }
        }

        if (questionsToInclude.length === 0) {
          throw new Error(
            `No questions found matching filters for question set: ${questionSet.title}`,
          );
        }

        // Create snapshot of filtered questions
        const questions = questionsToInclude.map((q) => ({
          type: q.type,
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          points: q.points,
          order: q.orderNum,
          originalQuestionId: q.id,
        }));

        return {
          questionSetId: questionSet.id,
          title: questionSet.title,
          questions,
          totalPoints: questions.reduce((sum, q) => sum + (q.points || 0), 0),
          order: index + 1,
        };
      }),
    );

    // Calculate total points
    const totalPoints = quizQuestionSets.reduce((sum, qqs) => sum + qqs.totalPoints, 0);

    // Create quiz with filtered question snapshots
    const quiz = await prisma.quiz.create({
      data: {
        title: settings.title,
        coverImage: settings.coverImage || null,
        isQuizChallenge: settings.isQuizChallenge || false,
        isOpenQuiz: settings.isOpenQuiz || false,
        description: settings.description || null,
        instructions: settings.instructions || null,
        durationHours: settings.duration?.hours || 0,
        durationMinutes: settings.duration?.minutes || 30,
        durationSeconds: settings.duration?.seconds || 0,
        multipleAttempts: settings.multipleAttempts || false,
        looseFocus: settings.permitLoseFocus || false,
        viewAnswer: settings.viewAnswer !== undefined ? settings.viewAnswer : true,
        viewResults: settings.viewResults !== undefined ? settings.viewResults : true,
        displayCalculator: settings.displayCalculator || false,
        totalPoints: totalPoints,
        createdById: req.admin.id,
        questionSets: {
          create: quizQuestionSets.map((qqs) => ({
            questionSetId: qqs.questionSetId,
            title: qqs.title,
            orderNum: qqs.order,
            totalPoints: qqs.totalPoints,
            questions: {
              create: qqs.questions.map((q, idx) => ({
                originalQuestionId: q.originalQuestionId,
                type: q.type,
                question: q.question,
                options: q.options || null,
                correctAnswer: q.correctAnswer || null,
                points: q.points,
                orderNum: idx + 1,
              })),
            },
          })),
        },
      },
      include: {
        questionSets: {
          include: {
            questions: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: "Quiz created successfully with filtered questions",
      quiz,
      filtersApplied: questionFilters || null,
    });
  } catch (error) {
    console.error("Error creating quiz:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/quiz/preview-questions
// @desc    Preview questions that will be included based on filters (before creating quiz)
// @access  Private (Admin only)
router.post("/preview-questions", verifyAdmin, async (req, res) => {
  try {
    const { questionSetId, filter } = req.body;

    if (!questionSetId) {
      return res.status(400).json({
        success: false,
        message: "Question set ID is required",
      });
    }

    const where = {
      questionSetId: questionSetId,
      isArchived: false,
    };

    // Apply filters
    if (filter) {
      if (filter.batchNumber !== undefined) {
        where.batchNumber = filter.batchNumber;
      }

      if (filter.version) {
        where.version = filter.version;
      }

      if (filter.dateFrom || filter.dateTo) {
        where.addedDate = {};
        if (filter.dateFrom) where.addedDate.gte = new Date(filter.dateFrom);
        if (filter.dateTo) where.addedDate.lte = new Date(filter.dateTo);
      }
    }

    // Handle tag filtering with raw query if tags are provided
    let questions;
    if (filter?.tags && Array.isArray(filter.tags)) {
      // Use raw SQL for JSONB array containment check
      const tagsJson = JSON.stringify(filter.tags);
      const batchCondition = filter.batchNumber !== undefined 
        ? prisma.sql`AND batch_number = ${filter.batchNumber}` 
        : prisma.sql``;
      const versionCondition = filter.version 
        ? prisma.sql`AND version = ${filter.version}` 
        : prisma.sql``;
      
      questions = await prisma.$queryRaw`
        SELECT * FROM questions
        WHERE question_set_id = ${questionSetId}::uuid
        AND is_archived = false
        ${batchCondition}
        ${versionCondition}
        AND tags @> ${tagsJson}::jsonb
        ORDER BY order_num ASC
      `;
    } else {
      questions = await prisma.question.findMany({
        where,
        orderBy: { orderNum: "asc" },
      });
    }

    // Apply limit if provided
    if (filter?.limit && filter.limit > 0) {
      questions = questions.slice(0, filter.limit);
    }

    // Apply specific question IDs filter
    if (filter?.questionIds && Array.isArray(filter.questionIds)) {
      questions = questions.filter((q) => filter.questionIds.includes(q.id));
    }

    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 0), 0);

    res.json({
      success: true,
      questionCount: questions.length,
      totalPoints,
      filter: filter || null,
      questions: questions.map((q) => ({
        id: q.id,
        question:
          q.question.substring(0, 100) + (q.question.length > 100 ? "..." : ""),
        type: q.type,
        points: q.points,
        batchNumber: q.batchNumber || q.batch_number, // Handle snake_case from raw query
        version: q.version,
        tags: q.tags,
        addedDate: q.addedDate || q.added_date, // Handle snake_case from raw query
      })),
    });
  } catch (error) {
    console.error("Error previewing questions:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiz
// @desc    Get all quizzes
// @access  Private (Admin only)
router.get("/", verifyAdmin, async (req, res) => {
  try {
    const { isActive, isQuizChallenge, isOpenQuiz } = req.query;

    const where = {};
    
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }
    
    if (isQuizChallenge !== undefined) {
      where.isQuizChallenge = isQuizChallenge === 'true';
    }
    
    if (isOpenQuiz !== undefined) {
      where.isOpenQuiz = isOpenQuiz === 'true';
    }

    const quizzes = await prisma.quiz.findMany({
      where,
      include: {
        createdBy: {
          select: {
            email: true,
          }
        },
        questionSets: {
          select: {
            questionSetId: true,
            title: true,
            totalPoints: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json({
      success: true,
      count: quizzes.length,
      quizzes,
    });
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiz/:id
// @desc    Get single quiz by ID
// @access  Private (Admin only)
router.get("/:id", verifyAdmin, async (req, res) => {
  try {
    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { email: true } },
        questionSets: {
          select: {
            questionSetId: true,
            title: true,
            totalPoints: true,
          },
        },
      },
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    res.json({
      success: true,
      quiz,
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

// @route   PUT /api/quiz/:id
// @desc    Update quiz settings (not question sets)
// @access  Private (Admin only)
router.put("/:id", verifyAdmin, async (req, res) => {
  try {
    const { settings, isActive } = req.body;

    const quiz = await prisma.quiz.findUnique({ 
      where: { id: req.params.id } 
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Build update data object
    const updateData = {};
    
    if (settings) {
      if (settings.title !== undefined) updateData.title = settings.title;
      if (settings.coverImage !== undefined) updateData.coverImage = settings.coverImage;
      if (settings.description !== undefined) updateData.description = settings.description;
      if (settings.instructions !== undefined) updateData.instructions = settings.instructions;
      if (settings.isQuizChallenge !== undefined) updateData.isQuizChallenge = settings.isQuizChallenge;
      if (settings.isOpenQuiz !== undefined) updateData.isOpenQuiz = settings.isOpenQuiz;
      if (settings.multipleAttempts !== undefined) updateData.multipleAttempts = settings.multipleAttempts;
      if (settings.looseFocus !== undefined) updateData.looseFocus = settings.looseFocus;
      if (settings.viewAnswer !== undefined) updateData.viewAnswer = settings.viewAnswer;
      if (settings.viewResults !== undefined) updateData.viewResults = settings.viewResults;
      if (settings.displayCalculator !== undefined) updateData.displayCalculator = settings.displayCalculator;
      
      if (settings.duration) {
        if (settings.duration.hours !== undefined) updateData.durationHours = settings.duration.hours;
        if (settings.duration.minutes !== undefined) updateData.durationMinutes = settings.duration.minutes;
        if (settings.duration.seconds !== undefined) updateData.durationSeconds = settings.duration.seconds;
      }
    }
    
    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    const updatedQuiz = await prisma.quiz.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        questionSets: {
          select: {
            questionSetId: true,
            title: true,
            totalPoints: true,
          }
        }
      }
    });

    res.json({
      success: true,
      message: "Quiz updated successfully",
      quiz: updatedQuiz,
    });
  } catch (error) {
    console.error("Error updating quiz:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   PUT /api/quiz/:id/question-sets
// @desc    Replace question sets in a quiz (recreates snapshots)
// @access  Private (Admin only)
router.put("/:id/question-sets", verifyAdmin, async (req, res) => {
  try {
    const { questionSetIds } = req.body;

    if (
      !questionSetIds ||
      !Array.isArray(questionSetIds) ||
      questionSetIds.length !== 4
    ) {
      return res.status(400).json({
        success: false,
        message: "Exactly 4 question set IDs are required",
      });
    }

    // Changed from: Quiz.findById()
    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.id }
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Fetch all question sets
    // Changed from: QuestionSet.find({ _id: { $in: questionSetIds }, isActive: true })
    const questionSets = await prisma.questionSet.findMany({
      where: {
        id: { in: questionSetIds },
        isActive: true,
      },
      include: {
        questions: {
          where: { isArchived: false },
          orderBy: { orderNum: 'asc' }
        }
      }
    });

    if (questionSets.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "One or more question sets not found or inactive",
      });
    }

    // Create new quiz question sets with snapshots
    const quizQuestionSets = questionSetIds.map((setId, index) => {
      const questionSet = questionSets.find((qs) => qs.id === setId);

      if (!questionSet) {
        throw new Error(`Question set with ID ${setId} not found`);
      }

      const questions = questionSet.questions.map((q) => ({
        type: q.type,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: q.points,
        orderNum: q.orderNum,
        originalQuestionId: q.id,
      }));

      const totalPoints = questions.reduce((sum, q) => sum + (q.points || 0), 0);

      return {
        questionSetId: questionSet.id,
        title: questionSet.title,
        questions,
        totalPoints,
        orderNum: index + 1,
      };
    });

    // Calculate new total points
    const newTotalPoints = quizQuestionSets.reduce((sum, qqs) => sum + qqs.totalPoints, 0);

    // Use transaction to replace question sets atomically
    const updatedQuiz = await prisma.$transaction(async (tx) => {
      // Delete existing quiz question sets (cascade will delete questions)
      await tx.quizQuestionSet.deleteMany({
        where: { quizId: req.params.id }
      });

      // Create new question sets with questions
      await tx.quizQuestionSet.createMany({
        data: quizQuestionSets.map(qqs => ({
          quizId: req.params.id,
          questionSetId: qqs.questionSetId,
          title: qqs.title,
          orderNum: qqs.orderNum,
          totalPoints: qqs.totalPoints,
        }))
      });

      // Get the created quiz question sets
      const createdQuizQuestionSets = await tx.quizQuestionSet.findMany({
        where: { quizId: req.params.id },
        orderBy: { orderNum: 'asc' }
      });

      // Create questions for each quiz question set
      for (let i = 0; i < createdQuizQuestionSets.length; i++) {
        const quizQS = createdQuizQuestionSets[i];
        const questions = quizQuestionSets[i].questions;

        await tx.quizQuestion.createMany({
          data: questions.map(q => ({
            quizQuestionSetId: quizQS.id,
            originalQuestionId: q.originalQuestionId,
            type: q.type,
            question: q.question,
            options: q.options,
            correctAnswer: q.correctAnswer,
            points: q.points,
            orderNum: q.orderNum,
          }))
        });
      }

      // Update quiz total points
      return tx.quiz.update({
        where: { id: req.params.id },
        data: { totalPoints: newTotalPoints },
        include: {
          questionSets: {
            include: {
              questions: true
            }
          }
        }
      });
    });

    res.json({
      success: true,
      message: "Quiz question sets updated successfully",
      quiz: updatedQuiz,
    });
  } catch (error) {
    console.error("Error updating quiz question sets:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   DELETE /api/quiz/:id
// @desc    Delete quiz
// @access  Private (Admin only)
router.delete("/:id", verifyAdmin, async (req, res) => {
  try {
    // Changed from: Quiz.findById()
    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.id }
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Changed from: quiz.deleteOne()
    await prisma.quiz.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: "Quiz deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting quiz:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   PATCH /api/quiz/:id/toggle-active
// @desc    Toggle quiz active status
// @access  Private (Admin only)
router.patch("/:id/toggle-active", verifyAdmin, async (req, res) => {
  try {
    // Changed from: Quiz.findById()
    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.id }
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Changed from: quiz.isActive = !quiz.isActive; quiz.save()
    const updatedQuiz = await prisma.quiz.update({
      where: { id: req.params.id },
      data: { isActive: !quiz.isActive }
    });

    res.json({
      success: true,
      message: `Quiz ${updatedQuiz.isActive ? "activated" : "deactivated"} successfully`,
      quiz: updatedQuiz,
    });
  } catch (error) {
    console.error("Error toggling quiz status:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/quiz/:id/statistics
// @desc    Get quiz statistics (total questions, points per set, etc.)
// @access  Private (Admin only)
router.get("/:id/statistics", verifyAdmin, async (req, res) => {
  try {
    // Changed from: Quiz.findById().populate()
    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.id },
      include: {
        questionSets: {
          include: {
            questions: true,
            questionSet: {
              select: {
                title: true
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

    // Calculate total duration in seconds
    const totalDurationInSeconds = 
      (quiz.durationHours * 3600) + 
      (quiz.durationMinutes * 60) + 
      quiz.durationSeconds;

    const statistics = {
      totalQuestionSets: quiz.questionSets.length,
      totalQuestions: quiz.questionSets.reduce(
        (sum, qs) => sum + qs.questions.length,
        0,
      ),
      totalPoints: quiz.totalPoints,
      questionSetBreakdown: quiz.questionSets.map((qs) => ({
        title: qs.title,
        questionCount: qs.questions.length,
        totalPoints: qs.totalPoints,
        order: qs.orderNum,
      })),
      duration: totalDurationInSeconds,
    };

    res.json({
      success: true,
      statistics,
    });
  } catch (error) {
    console.error("Error fetching quiz statistics:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});
module.exports = router;
