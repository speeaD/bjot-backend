const express = require('express');
const router = express.Router();
const { verifyAdmin } = require('../middleware/auth');
const Quiz = require('../models/Quiz');
const QuestionSet = require('../models/QuestionSet');

// @route   POST /api/quiz
// @desc    Create a new quiz with 4 question sets (with batch support)
// @access  Private (Admin only)
router.post('/', verifyAdmin, async (req, res) => {
  try {
    const { questionSetCombination, batchConfiguration, settings } = req.body;

    // Validation
    if (!settings || !settings.title) {
      return res.status(400).json({
        success: false,
        message: 'Quiz title is required',
      });
    }

    const examType = settings.examType || 'multi-subject';
    const expectedCount = examType === 'single-subject' ? 1 : 4;

    if (!questionSetCombination || !Array.isArray(questionSetCombination) || questionSetCombination.length !== expectedCount) {
      return res.status(400).json({
        success: false,
        message: `Exactly ${expectedCount} question set IDs are required`,
      });
    }

    // Check for duplicates
    const uniqueSetIds = new Set(questionSetCombination);
    if (uniqueSetIds.size !== expectedCount) {
      return res.status(400).json({
        success: false,
        message: 'Cannot use the same question set multiple times',
      });
    }

    // Validate batchConfiguration if provided
    if (batchConfiguration) {
      if (!Array.isArray(batchConfiguration) || batchConfiguration.length !== expectedCount) {
        return res.status(400).json({
          success: false,
          message: `Batch configuration must have exactly ${expectedCount} entries (one per question set)`,
        });
      }
    }

    // Fetch all question sets
    const questionSets = await QuestionSet.find({
      _id: { $in: questionSetCombination },
      isActive: true,
    });

    if (questionSets.length !== 4) {
      return res.status(400).json({
        success: false,
        message: 'One or more question sets not found or inactive',
      });
    }

    // Create quiz question sets with snapshots in the order provided
    const quizQuestionSets = questionSetCombination.map((setId, index) => {
      const questionSet = questionSets.find(qs => qs._id.toString() === setId);
      
      if (!questionSet) {
        throw new Error(`Question set with ID ${setId} not found`);
      }

      // Check if batch is specified for this question set
      const batchConfig = batchConfiguration?.find(bc => bc.questionSetId === setId);
      const batchNumber = batchConfig?.batchNumber;

      let questions = [];
      let batchId = null;
      let batchName = null;
      let totalPoints = 0;

      // If question set uses batches and a batch is specified
      if (questionSet.usesBatches && batchNumber) {
        const batch = questionSet.batches.find(b => b.batchNumber === batchNumber && b.isActive);
        
        if (!batch) {
          throw new Error(`Batch ${batchNumber} not found or inactive in question set "${questionSet.title}"`);
        }

        batchId = batch._id;
        batchName = batch.name;
        totalPoints = batch.totalPoints;

        // Create snapshot of questions from the batch
        questions = batch.questions.map(q => ({
          type: q.type,
          question: q.question,
          options: q.options,
          passage: q.passage,
          diagram: q.diagram,
          diagramAlt: q.diagramAlt,
          correctAnswer: q.correctAnswer,
          points: q.points,
          order: q.order,
          originalQuestionId: q._id,
        }));
      } 
      // Legacy: If question set doesn't use batches
      else if (!questionSet.usesBatches) {
        totalPoints = questionSet.totalPoints;

        // Create snapshot of questions from the main questions array
        questions = questionSet.questions.map(q => ({
          type: q.type,
          question: q.question,
          options: q.options,
          passage: q.passage,
          diagram: q.diagram,
          diagramAlt: q.diagramAlt,
          correctAnswer: q.correctAnswer,
          points: q.points,
          order: q.order,
          originalQuestionId: q._id,
        }));
      } else {
        throw new Error(`Question set "${questionSet.title}" uses batches but no batch number was specified`);
      }

      return {
        questionSetId: questionSet._id,
        batchNumber: batchNumber || undefined,
        batchId: batchId || undefined,
        batchName: batchName || undefined,
        title: batchName ? `${questionSet.title} - ${batchName}` : questionSet.title,
        questions,
        totalPoints,
        order: index + 1,
      };
    });

    // Create quiz with proper structure - INCLUDE questionSetCombination
    const quiz = new Quiz({
      settings: {
        coverImage: settings.coverImage || '',
        title: settings.title,
        examType: settings.examType || 'multi-subject',
        isQuizChallenge: settings.isQuizChallenge || false,
        isOpenQuiz: settings.isOpenQuiz || false,
        description: settings.description || '',
        instructions: settings.instructions || '',
        duration: settings.duration || { hours: 0, minutes: 30, seconds: 0 },
        multipleAttempts: settings.multipleAttempts || false,
        looseFocus: settings.permitLoseFocus || false,
        viewAnswer: settings.viewAnswer !== undefined ? settings.viewAnswer : true,
        viewResults: settings.viewResults !== undefined ? settings.viewResults : true,
        displayCalculator: settings.displayCalculator || false,
      },
      questionSetCombination: questionSetCombination, // ← ADD THIS LINE
      batchConfiguration: batchConfiguration || [], // ← ADD THIS LINE (optional but recommended)
      questionSets: quizQuestionSets,
      createdBy: req.admin._id,
    });

    await quiz.save();

    res.status(201).json({
      success: true,
      message: 'Quiz created successfully',
      quiz,
    });
  } catch (error) {
    console.error('Error creating quiz:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});
// router.post('/', verifyAdmin, async (req, res) => {
//   try {
//     // Destructure the entire body to get settings at root level
//     const { questionSetCombination, batchConfiguration, settings } = req.body;

//     // Validation
//     if (!settings || !settings.title) {
//       return res.status(400).json({
//         success: false,
//         message: 'Quiz title is required',
//       });
//     }

//     if (!questionSetCombination || !Array.isArray(questionSetCombination) || questionSetCombination.length !== 4) {
//       return res.status(400).json({
//         success: false,
//         message: 'Exactly 4 question set IDs are required',
//       });
//     }

//     // Check for duplicates
//     const uniqueSetIds = new Set(questionSetCombination);
//     if (uniqueSetIds.size !== 4) {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot use the same question set multiple times',
//       });
//     }

//     // Validate batchConfiguration if provided
//     if (batchConfiguration) {
//       if (!Array.isArray(batchConfiguration) || batchConfiguration.length !== 4) {
//         return res.status(400).json({
//           success: false,
//           message: 'Batch configuration must have exactly 4 entries (one per question set)',
//         });
//       }
//     }

//     // Fetch all question sets
//     const questionSets = await QuestionSet.find({
//       _id: { $in: questionSetCombination },
//       isActive: true,
//     });

//     if (questionSets.length !== 4) {
//       return res.status(400).json({
//         success: false,
//         message: 'One or more question sets not found or inactive',
//       });
//     }

//     // Create quiz question sets with snapshots in the order provided
//     const quizQuestionSets = questionSetCombination.map((setId, index) => {
//       const questionSet = questionSets.find(qs => qs._id.toString() === setId);
      
//       if (!questionSet) {
//         throw new Error(`Question set with ID ${setId} not found`);
//       }

//       // Check if batch is specified for this question set
//       const batchConfig = batchConfiguration?.find(bc => bc.questionSetId === setId);
//       const batchNumber = batchConfig?.batchNumber;

//       let questions = [];
//       let batchId = null;
//       let batchName = null;
//       let totalPoints = 0;

//       // If question set uses batches and a batch is specified
//       if (questionSet.usesBatches && batchNumber) {
//         const batch = questionSet.batches.find(b => b.batchNumber === batchNumber && b.isActive);
        
//         if (!batch) {
//           throw new Error(`Batch ${batchNumber} not found or inactive in question set "${questionSet.title}"`);
//         }

//         batchId = batch._id;
//         batchName = batch.name;
//         totalPoints = batch.totalPoints;

//         // Create snapshot of questions from the batch
//         questions = batch.questions.map(q => ({
//           type: q.type,
//           question: q.question,
//           options: q.options,
//           correctAnswer: q.correctAnswer,
//           points: q.points,
//           order: q.order,
//           originalQuestionId: q._id,
//         }));
//       } 
//       // Legacy: If question set doesn't use batches
//       else if (!questionSet.usesBatches) {
//         totalPoints = questionSet.totalPoints;

//         // Create snapshot of questions from the main questions array
//         questions = questionSet.questions.map(q => ({
//           type: q.type,
//           question: q.question,
//           options: q.options,
//           correctAnswer: q.correctAnswer,
//           points: q.points,
//           order: q.order,
//           originalQuestionId: q._id,
//         }));
//       } else {
//         throw new Error(`Question set "${questionSet.title}" uses batches but no batch number was specified`);
//       }

//       return {
//         questionSetId: questionSet._id,
//         batchNumber: batchNumber || undefined,
//         batchId: batchId || undefined,
//         batchName: batchName || undefined,
//         title: batchName ? `${questionSet.title} - ${batchName}` : questionSet.title,
//         questions,
//         totalPoints,
//         order: index + 1,
//       };
//     });

//     // Create quiz with proper structure
//     const quiz = new Quiz({
//       settings: {
//         coverImage: settings.coverImage || '',
//         title: settings.title,
//         isQuizChallenge: settings.isQuizChallenge || false,
//         isOpenQuiz: settings.isOpenQuiz || false,
//         description: settings.description || '',
//         instructions: settings.instructions || '',
//         duration: settings.duration || { hours: 0, minutes: 30, seconds: 0 },
//         multipleAttempts: settings.multipleAttempts || false,
//         looseFocus: settings.permitLoseFocus || false,
//         viewAnswer: settings.viewAnswer !== undefined ? settings.viewAnswer : true,
//         viewResults: settings.viewResults !== undefined ? settings.viewResults : true,
//         displayCalculator: settings.displayCalculator || false,
//       },
//       questionSets: quizQuestionSets,
//       createdBy: req.admin._id,
//     });

//     await quiz.save();

//     res.status(201).json({
//       success: true,
//       message: 'Quiz created successfully',
//       quiz,
//     });
//   } catch (error) {
//     console.error('Error creating quiz:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message,
//     });
//   }
// });

// @route   GET /api/quiz
// @desc    Get all quizzes
// @access  Private (Admin only)
router.get('/', verifyAdmin, async (req, res) => {
  try {
    const { isActive, isQuizChallenge } = req.query;

    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (isQuizChallenge !== undefined) filter['settings.isQuizChallenge'] = isQuizChallenge === 'true';

    const quizzes = await Quiz.find(filter)
      .populate('createdBy', 'email')
      .populate('questionSets.questionSetId', 'title')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: quizzes.length,
      quizzes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/quiz/:id
// @desc    Get single quiz by ID
// @access  Private (Admin only)
router.get('/:id', verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .populate('createdBy', 'email')
      .populate('questionSets.questionSetId', 'title questionCount totalPoints usesBatches');

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    res.json({
      success: true,
      quiz,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   PUT /api/quiz/:id
// @desc    Update quiz settings (not question sets)
// @access  Private (Admin only)
router.put('/:id', verifyAdmin, async (req, res) => {
  try {
    const { settings, isActive } = req.body;

    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    // Update only settings and isActive, not question sets
    if (settings) {
      quiz.settings = { ...quiz.settings.toObject(), ...settings };
    }
    if (typeof isActive !== 'undefined') {
      quiz.isActive = isActive;
    }

    await quiz.save();

    res.json({
      success: true,
      message: 'Quiz updated successfully',
      quiz,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   PUT /api/quiz/:id/question-sets
// @desc    Replace question sets in a quiz (recreates snapshots with batch support)
// @access  Private (Admin only)
router.put('/:id/question-sets', verifyAdmin, async (req, res) => {
  try {
    const { questionSetIds, batchConfiguration } = req.body;

    const examType = settings.examType || 'multi-subject';
    const expectedCount = examType === 'single-subject' ? 1 : 4;

    if (!questionSetIds || !Array.isArray(questionSetIds) || questionSetIds.length !== expectedCount) {
      return res.status(400).json({
        success: false,
        message: `Exactly ${expectedCount} question set IDs are required`,
      });
    }

    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    // Validate batchConfiguration if provided
    if (batchConfiguration) {
      if (!Array.isArray(batchConfiguration) || batchConfiguration.length !== expectedCount) {
        return res.status(400).json({
          success: false,
          message: `Batch configuration must have exactly ${expectedCount} entries (one per question set)`,
        });
      }
    }

    // Fetch all question sets
    const questionSets = await QuestionSet.find({
      _id: { $in: questionSetIds },
      isActive: true,
    });

    if (questionSets.length !== expectedCount) {
      return res.status(400).json({
        success: false,
        message: `One or more question sets not found or inactive`,
      });
    }

    // Create new quiz question sets with snapshots
    const quizQuestionSets = questionSetIds.map((setId, index) => {
      const questionSet = questionSets.find(qs => qs._id.toString() === setId);
      
      if (!questionSet) {
        throw new Error(`Question set with ID ${setId} not found`);
      }

      // Check if batch is specified for this question set
      const batchConfig = batchConfiguration?.find(bc => bc.questionSetId === setId);
      const batchNumber = batchConfig?.batchNumber;

      let questions = [];
      let batchId = null;
      let batchName = null;
      let totalPoints = 0;

      // If question set uses batches and a batch is specified
      if (questionSet.usesBatches && batchNumber) {
        const batch = questionSet.batches.find(b => b.batchNumber === batchNumber && b.isActive);
        
        if (!batch) {
          throw new Error(`Batch ${batchNumber} not found or inactive in question set "${questionSet.title}"`);
        }

        batchId = batch._id;
        batchName = batch.name;
        totalPoints = batch.totalPoints;

        questions = batch.questions.map(q => ({
          type: q.type,
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          points: q.points,
          order: q.order,
          originalQuestionId: q._id,
        }));
      } 
      // Legacy: If question set doesn't use batches
      else if (!questionSet.usesBatches) {
        totalPoints = questionSet.totalPoints;

        questions = questionSet.questions.map(q => ({
          type: q.type,
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          points: q.points,
          order: q.order,
          originalQuestionId: q._id,
        }));
      } else {
        throw new Error(`Question set "${questionSet.title}" uses batches but no batch number was specified`);
      }

      return {
        questionSetId: questionSet._id,
        batchNumber: batchNumber || undefined,
        batchId: batchId || undefined,
        batchName: batchName || undefined,
        title: batchName ? `${questionSet.title} - ${batchName}` : questionSet.title,
        questions,
        totalPoints,
        order: index + 1,
      };
    });

    quiz.questionSets = quizQuestionSets;
    await quiz.save();

    res.json({
      success: true,
      message: 'Quiz question sets updated successfully',
      quiz,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   DELETE /api/quiz/:id
// @desc    Delete quiz
// @access  Private (Admin only)
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    await quiz.deleteOne();

    res.json({
      success: true,
      message: 'Quiz deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   PATCH /api/quiz/:id/toggle-active
// @desc    Toggle quiz active status
// @access  Private (Admin only)
router.patch('/:id/toggle-active', verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    quiz.isActive = !quiz.isActive;
    await quiz.save();

    res.json({
      success: true,
      message: `Quiz ${quiz.isActive ? 'activated' : 'deactivated'} successfully`,
      quiz,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/quiz/:id/statistics
// @desc    Get quiz statistics (total questions, points per set, batch info, etc.)
// @access  Private (Admin only)
router.get('/:id/statistics', verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .populate('questionSets.questionSetId', 'title');

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
      });
    }

    const statistics = {
      totalQuestionSets: quiz.questionSets.length,
      totalQuestions: quiz.questionSets.reduce((sum, qs) => sum + qs.questions.length, 0),
      totalPoints: quiz.totalPoints,
      questionSetBreakdown: quiz.questionSets.map(qs => ({
        title: qs.title,
        questionCount: qs.questions.length,
        totalPoints: qs.totalPoints,
        order: qs.order,
        batchNumber: qs.batchNumber || null,
        batchName: qs.batchName || null,
        usesBatch: !!qs.batchNumber,
      })),
      duration: quiz.getTotalDurationInSeconds(),
      batchConfiguration: quiz.batchConfiguration,
    };

    res.json({
      success: true,
      statistics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/quiz/by-combination/:setId1/:setId2/:setId3/:setId4
// @desc    Get all quizzes using a specific question set combination (ignoring batches)
// @access  Private (Admin only)
router.get('/by-combination/:setId1/:setId2/:setId3/:setId4', verifyAdmin, async (req, res) => {
  try {
    const { setId1, setId2, setId3, setId4 } = req.params;
    const combination = [setId1, setId2, setId3, setId4];

    const quizzes = await Quiz.find({
      questionSetCombination: { $all: combination },
      isActive: true,
    })
      .populate('createdBy', 'email')
      .populate('questionSets.questionSetId', 'title');

    // Filter to ensure exact match (all 4 sets, no more, no less)
    const exactMatches = quizzes.filter(quiz => 
      quiz.questionSetCombination.length === 4 &&
      combination.every(id => quiz.questionSetCombination.some(qsId => qsId.toString() === id))
    );

    res.json({
      success: true,
      count: exactMatches.length,
      quizzes: exactMatches,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

module.exports = router;