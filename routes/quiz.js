const express = require("express");
const router = express.Router();
const { verifyAdmin } = require("../middleware/auth");
const prisma = require("../utils/database");

// @route   POST /api/quiz
// @desc    Create a new quiz with filtered questions
// @access  Private (Admin only)
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

    // Create quiz with filtered question snapshots
    const quiz = await prisma.quiz.create({
      data: {
        title: settings.title,
        coverImage: settings.coverImage || "",
        isQuizChallenge: settings.isQuizChallenge || false,
        isOpenQuiz: settings.isOpenQuiz || false,
        description: settings.description || "",
        instructions: settings.instructions || "",
        durationHours: settings.duration?.hours || 0,
        durationMinutes: settings.duration?.minutes || 30,
        durationSeconds: settings.duration?.seconds || 0,
        multipleAttempts: settings.multipleAttempts || false,
        looseFocus: settings.permitLoseFocus || false,
        viewAnswer:
          settings.viewAnswer !== undefined ? settings.viewAnswer : true,
        viewResults:
          settings.viewResults !== undefined ? settings.viewResults : true,
        displayCalculator: settings.displayCalculator || false,
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
      questions = await prisma.$queryRaw`
        SELECT * FROM questions
        WHERE question_set_id = ${questionSetId}::uuid
        AND is_archived = false
        ${filter.batchNumber !== undefined ? prisma.sql`AND batch_number = ${filter.batchNumber}` : prisma.sql``}
        ${filter.version ? prisma.sql`AND version = ${filter.version}` : prisma.sql``}
        AND tags @> ${JSON.stringify(filter.tags)}::jsonb
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
        batchNumber: q.batchNumber,
        version: q.version,
        tags: q.tags,
        addedDate: q.addedDate,
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
    const { isActive, isQuizChallenge } = req.query;

    const where = {
      isActive: isActive !== undefined ? isActive === "true" : undefined,
      isQuizChallenge:
        isQuizChallenge !== undefined ? isQuizChallenge === "true" : undefined,
    };

    const quizzes = await prisma.quiz.findMany({
      where: {
        isActive: where.isActive,
        isQuizChallenge: where.isQuizChallenge,
      },
      include: {
        createdBy: { select: { email: true } },
        questionSets: { select: { questionSetId: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      count: quizzes.length,
      quizzes,
    });
  } catch (error) {
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

    const quiz = await prisma.quiz.findUnique({ where: { id: req.params.id } });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Update only settings and isActive, not question sets
    if (settings) {
      await prisma.quiz.update({
        where: { id: quiz.id },
        data: {...quiz.settings.toObject(), ...settings },
      });
    }
    if (typeof isActive !== "undefined") {
      await prisma.quiz.update({
        where: { id: quiz.id },
        data: { isActive },
      });
    }

   
    res.json({
      success: true,
      message: "Quiz updated successfully",
      quiz,
    });
  } catch (error) {
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

    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Fetch all question sets
    const questionSets = await QuestionSet.find({
      _id: { $in: questionSetIds },
      isActive: true,
    });

    if (questionSets.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "One or more question sets not found or inactive",
      });
    }

    // Create new quiz question sets with snapshots
    const quizQuestionSets = questionSetIds.map((setId, index) => {
      const questionSet = questionSets.find(
        (qs) => qs._id.toString() === setId,
      );

      if (!questionSet) {
        throw new Error(`Question set with ID ${setId} not found`);
      }

      const questions = questionSet.questions.map((q) => ({
        type: q.type,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: q.points,
        order: q.order,
        originalQuestionId: q._id,
      }));

      return {
        questionSetId: questionSet._id,
        title: questionSet.title,
        questions,
        totalPoints: questionSet.totalPoints,
        order: index + 1,
      };
    });

    quiz.questionSets = quizQuestionSets;
    await quiz.save();

    res.json({
      success: true,
      message: "Quiz question sets updated successfully",
      quiz,
    });
  } catch (error) {
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
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    await quiz.deleteOne();

    res.json({
      success: true,
      message: "Quiz deleted successfully",
    });
  } catch (error) {
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
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    quiz.isActive = !quiz.isActive;
    await quiz.save();

    res.json({
      success: true,
      message: `Quiz ${quiz.isActive ? "activated" : "deactivated"} successfully`,
      quiz,
    });
  } catch (error) {
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
    const quiz = await Quiz.findById(req.params.id).populate(
      "questionSets.questionSetId",
      "title",
    );

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

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
        order: qs.order,
      })),
      duration: quiz.getTotalDurationInSeconds(),
    };

    res.json({
      success: true,
      statistics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;
