const express = require('express');
const router = express.Router();
const { verifyAdmin } = require('../middleware/auth');
const prisma = require('../utils/database');

// @route   POST /api/questionset/:id/questions/batch
// @desc    Add new questions to existing question set with metadata
// @access  Private (Admin only)
router.post('/:id/questions/batch', verifyAdmin, async (req, res) => {
  try {
    const { questions, metadata } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Questions array is required',
      });
    }

    const questionSet = await prisma.questionSet.findUnique({
      where: { id: req.params.id },
      include: {
        questions: {
          orderBy: { orderNum: 'desc' },
          take: 1,
        },
      },
    });

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: 'Question set not found',
      });
    }

    // Get next order number and batch number
    const startOrderNum = questionSet.questions.length > 0 
      ? questionSet.questions[0].orderNum + 1 
      : 1;

    // Get next batch number using raw query
    const batchResult = await prisma.$queryRaw`
      SELECT COALESCE(MAX(batch_number), 0) + 1 as next_batch
      FROM questions 
      WHERE question_set_id = ${req.params.id}::uuid
    `;
    const nextBatchNumber = metadata?.batchNumber || batchResult[0].next_batch;

    // Prepare questions with metadata
    const questionsToCreate = questions.map((q, index) => ({
      questionSetId: req.params.id,
      type: q.type,
      question: q.question,
      options: q.options || null,
      correctAnswer: q.correctAnswer || null,
      points: q.points || 1,
      orderNum: startOrderNum + index,
      
      // Metadata fields
      tags: metadata?.tags || ['new'],
      batchNumber: nextBatchNumber,
      version: metadata?.version || `v${nextBatchNumber}.0`,
      addedDate: new Date(),
      isArchived: false,
      metadata: metadata?.additionalData || null,
    }));

    // Create questions
    await prisma.question.createMany({
      data: questionsToCreate,
    });

    // Update question set totals
    const updatedQuestionSet = await prisma.questionSet.update({
      where: { id: req.params.id },
      data: {
        questionCount: {
          increment: questions.length,
        },
        totalPoints: {
          increment: questions.reduce((sum, q) => sum + (q.points || 1), 0),
        },
      },
      include: {
        questions: {
          where: { batchNumber: nextBatchNumber },
          orderBy: { orderNum: 'asc' },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: `Added ${questions.length} questions to batch ${nextBatchNumber}`,
      batchNumber: nextBatchNumber,
      questionSet: updatedQuestionSet,
    });
  } catch (error) {
    console.error('Error adding questions batch:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/questionset/:id/questions/filter
// @desc    Get questions with filtering options
// @access  Private (Admin only)
router.get('/:id/questions/filter', verifyAdmin, async (req, res) => {
  try {
    const {
      batch,
      version,
      tags,
      dateFrom,
      dateTo,
      archived,
    } = req.query;

    // Build where clause
    const where = {
      questionSetId: req.params.id,
    };

    if (batch) {
      where.batchNumber = parseInt(batch);
    }

    if (version) {
      where.version = version;
    }

    if (dateFrom || dateTo) {
      where.addedDate = {};
      if (dateFrom) where.addedDate.gte = new Date(dateFrom);
      if (dateTo) where.addedDate.lte = new Date(dateTo);
    }

    if (archived !== undefined) {
      where.isArchived = archived === 'true';
    }

    // Handle tag filtering with raw query (for JSON contains)
    let questions;
    if (tags) {
      const tagArray = tags.split(',').map(t => t.trim());
      questions = await prisma.$queryRaw`
        SELECT * FROM questions
        WHERE question_set_id = ${req.params.id}::uuid
        ${batch ? prisma.sql`AND batch_number = ${parseInt(batch)}` : prisma.sql``}
        ${version ? prisma.sql`AND version = ${version}` : prisma.sql``}
        ${archived !== undefined ? prisma.sql`AND is_archived = ${archived === 'true'}` : prisma.sql``}
        AND tags @> ${JSON.stringify(tagArray)}::jsonb
        ORDER BY order_num ASC
      `;
    } else {
      questions = await prisma.question.findMany({
        where,
        orderBy: { orderNum: 'asc' },
      });
    }

    res.json({
      success: true,
      count: questions.length,
      filters: { batch, version, tags, dateFrom, dateTo, archived },
      questions,
    });
  } catch (error) {
    console.error('Error filtering questions:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   GET /api/questionset/:id/batches
// @desc    Get list of all batches in a question set
// @access  Private (Admin only)
router.get('/:id/batches', verifyAdmin, async (req, res) => {
  try {
    const batches = await prisma.$queryRaw`
      SELECT 
        batch_number,
        version,
        COUNT(*)::int as question_count,
        SUM(points)::int as total_points,
        MIN(added_date) as first_added,
        MAX(added_date) as last_added,
        array_agg(DISTINCT tag) FILTER (WHERE tag IS NOT NULL) as all_tags
      FROM questions,
        jsonb_array_elements_text(tags) as tag
      WHERE question_set_id = ${req.params.id}::uuid
      AND is_archived = false
      GROUP BY batch_number, version
      ORDER BY batch_number DESC
    `;

    res.json({
      success: true,
      batches,
    });
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   PATCH /api/questionset/:id/questions/:questionId/archive
// @desc    Archive/unarchive a question
// @access  Private (Admin only)
router.patch('/:id/questions/:questionId/archive', verifyAdmin, async (req, res) => {
  try {
    const { archive } = req.body; // true to archive, false to unarchive

    const question = await prisma.question.update({
      where: { id: req.params.questionId },
      data: { isArchived: archive === true },
    });

    res.json({
      success: true,
      message: `Question ${archive ? 'archived' : 'unarchived'} successfully`,
      question,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// @route   PUT /api/questionset/:id/questions/:questionId/metadata
// @desc    Update question metadata (tags, version, etc.)
// @access  Private (Admin only)
router.put('/:id/questions/:questionId/metadata', verifyAdmin, async (req, res) => {
  try {
    const { tags, batchNumber, version, metadata } = req.body;

    const updateData = {};
    if (tags !== undefined) updateData.tags = tags;
    if (batchNumber !== undefined) updateData.batchNumber = batchNumber;
    if (version !== undefined) updateData.version = version;
    if (metadata !== undefined) updateData.metadata = metadata;

    const question = await prisma.question.update({
      where: { id: req.params.questionId },
      data: updateData,
    });

    res.json({
      success: true,
      message: 'Question metadata updated successfully',
      question,
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


// const express = require("express");
// const router = express.Router();
// const { verifyAdmin } = require("../middleware/auth");
// const prisma = require("../utils/database");

// // @route   POST /api/questionset/bulk-upload
// // @desc    Create a new question set via bulk upload (Excel/CSV)
// // @access  Private (Admin only)
// router.post("/bulk-upload", verifyAdmin, async (req, res) => {
//   const upload = req.app.get("upload");

//   upload.single("file")(req, res, async (err) => {
//     if (err) {
//       return res.status(400).json({
//         success: false,
//         message: err.message,
//       });
//     }

//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: "Please upload a CSV or Excel file",
//       });
//     }

//     try {
//       // Get title from form data
//       const title = req.body.title?.trim();

//       if (!title) {
//         return res.status(400).json({
//           success: false,
//           message: "Question set title is required",
//         });
//       }

//       let questions = [];
//       const fileBuffer = req.file.buffer;
//       const mimetype = req.file.mimetype;

//       // Parse CSV file
//       if (mimetype === "text/csv") {
//         const Papa = require("papaparse");
//         const csvString = fileBuffer.toString("utf-8");

//         const result = Papa.parse(csvString, {
//           header: true,
//           skipEmptyLines: true,
//           transformHeader: (header) => header.trim().toLowerCase(),
//         });

//         if (result.errors.length > 0) {
//           return res.status(400).json({
//             success: false,
//             message: "Error parsing CSV file",
//             errors: result.errors,
//           });
//         }

//         questions = parseQuestions(result.data);
//       }
//       // Parse Excel file
//       else {
//         const XLSX = require("node-xlsx");
//         const workbook = XLSX.read(fileBuffer, { type: "buffer" });
//         const sheetName = workbook.SheetNames[0];
//         const worksheet = workbook.Sheets[sheetName];
//         const data = XLSX.utils.sheet_to_json(worksheet, {
//           raw: false,
//           defval: "",
//         });

//         // Normalize headers
//         const normalizedData = data.map((row) => {
//           const normalizedRow = {};
//           Object.keys(row).forEach((key) => {
//             normalizedRow[key.trim().toLowerCase()] = row[key];
//           });
//           return normalizedRow;
//         });

//         questions = parseQuestions(normalizedData);
//       }

//       if (questions.length === 0) {
//         return res.status(400).json({
//           success: false,
//           message: "No valid questions found in file",
//         });
//       }

//       // Create question set
//       const questionSet = new QuestionSet({
//         title,
//         questions,
//         createdBy: req.admin._id,
//       });

//       await questionSet.save();

//       res.status(201).json({
//         success: true,
//         message: `Question set created successfully with ${questions.length} questions`,
//         questionSet,
//       });
//     } catch (error) {
//       res.status(500).json({
//         success: false,
//         message: "Server error",
//         error: error.message,
//       });
//     }
//   });
// });

// // @route   GET /api/questionset
// // @desc    Get all question sets
// // @access  Private (Admin only)
// router.get("/", async (req, res) => {
//   try {
//     const { isActive, search } = req.query;

//     const where = {};
//     if (isActive !== undefined) where.isActive = isActive === "true";
//     if (search) {
//       where.title = {
//         contains: search,
//         mode: "insensitive",
//       };
//     }

//     const questionSets = await prisma.questionSet.findMany({
//       where,
//       include: {
//         createdBy: {
//           select: { id: true, email: true },
//         },
//         _count: {
//           select: { questions: true },
//         },
//       },
//       orderBy: {
//         createdAt: "desc",
//       },
//     });

//     res.json({
//       success: true,
//       count: questionSets.length,
//       questionSets,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// });

// // @route   GET /api/questionset/:id
// // @desc    Get single question set by ID
// // @access  Private (Admin only)
// router.get("/:id", verifyAdmin, async (req, res) => {
//   try {
//     const questionSet = await prisma.questionSet.findUnique({
//       where: { id: req.params.id },
//       include: {
//         createdBy: {
//           select: { email: true },
//         },
//         questions: {
//           orderBy: { orderNum: 'asc'}
//         }
//       },
//     });

//     if (!questionSet) {
//       return res.status(404).json({
//         success: false,
//         message: "Question set not found",
//       });
//     }

//     res.json({
//       success: true,
//       questionSet,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// });

// // @route   PUT /api/questionset/:id
// // @desc    Update question set
// // @access  Private (Admin only)
// router.put("/:id", verifyAdmin, async (req, res) => {
//   try {
//     const { title, questions, isActive } = req.body;

//     const questionSet = await prisma.questionSet.update({
//       where: { id: req.params.id },
//       data: {
//         title,
//         questions,
//         isActive,
//       },
//     });


//     if (!questionSet) {
//       return res.status(404).json({
//         success: false,
//         message: "Question set not found",
//       });
//     }
//     res.json({
//       success: true,
//       message: "Question set updated successfully",
//       questionSet,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// });

// // @route   DELETE /api/questionset/:id
// // @desc    Delete question set
// // @access  Private (Admin only)
// router.delete("/:id", verifyAdmin, async (req, res) => {
//   try {
//     const questionSet = await QuestionSet.findById(req.params.id);

//     if (!questionSet) {
//       return res.status(404).json({
//         success: false,
//         message: "Question set not found",
//       });
//     }

//     // Check if question set is being used in any quiz
//     const Quiz = require("../models/Quiz");
//     const quizzesUsingSet = await Quiz.countDocuments({
//       "questionSets.questionSetId": req.params.id,
//     });

//     if (quizzesUsingSet > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Cannot delete question set. It is being used in ${quizzesUsingSet} quiz(zes). Please remove it from those quizzes first or deactivate it instead.`,
//       });
//     }

//     await questionSet.deleteOne();

//     res.json({
//       success: true,
//       message: "Question set deleted successfully",
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// });

// // @route   PATCH /api/questionset/:id/toggle-active
// // @desc    Toggle question set active status
// // @access  Private (Admin only)
// router.patch("/:id/toggle-active", verifyAdmin, async (req, res) => {
//   try {
//     const questionSet = await QuestionSet.findById(req.params.id);

//     if (!questionSet) {
//       return res.status(404).json({
//         success: false,
//         message: "Question set not found",
//       });
//     }

//     questionSet.isActive = !questionSet.isActive;
//     await questionSet.save();

//     res.json({
//       success: true,
//       message: `Question set ${questionSet.isActive ? "activated" : "deactivated"} successfully`,
//       questionSet,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// });

// // @route   POST /api/questionset/:id/questions
// // @desc    Add questions to existing question set
// // @access  Private (Admin only)
// router.post("/:id/questions", verifyAdmin, async (req, res) => {
//   try {
//     const { questions } = req.body;

//     if (!questions || !Array.isArray(questions)) {
//       return res.status(400).json({
//         success: false,
//         message: "Questions array is required",
//       });
//     }

//     const questionSet = await QuestionSet.findById(req.params.id);

//     if (!questionSet) {
//       return res.status(404).json({
//         success: false,
//         message: "Question set not found",
//       });
//     }

//     // Add new questions with proper order
//     const startOrder = questionSet.questions.length;
//     questions.forEach((q, index) => {
//       q.order = startOrder + index + 1;
//     });

//     questionSet.questions.push(...questions);
//     await questionSet.save();

//     res.json({
//       success: true,
//       message: "Questions added successfully",
//       questionSet,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// });

// // @route   PUT /api/questionset/:id/questions/:questionId
// // @desc    Update a specific question in a question set
// // @access  Private (Admin only)
// router.put("/:id/questions/:questionId", verifyAdmin, async (req, res) => {
//   try {
//     const questionSet = await QuestionSet.findById(req.params.id);

//     if (!questionSet) {
//       return res.status(404).json({
//         success: false,
//         message: "Question set not found",
//       });
//     }

//     const question = questionSet.questions.id(req.params.questionId);

//     if (!question) {
//       return res.status(404).json({
//         success: false,
//         message: "Question not found",
//       });
//     }

//     // Update question fields
//     Object.assign(question, req.body);
//     await questionSet.save();

//     res.json({
//       success: true,
//       message: "Question updated successfully",
//       questionSet,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// });

// // @route   DELETE /api/questionset/:id/questions/:questionId
// // @desc    Delete a specific question from a question set
// // @access  Private (Admin only)
// router.delete("/:id/questions/:questionId", verifyAdmin, async (req, res) => {
//   try {
//     const questionSet = await QuestionSet.findById(req.params.id);

//     if (!questionSet) {
//       return res.status(404).json({
//         success: false,
//         message: "Question set not found",
//       });
//     }

//     questionSet.questions.pull(req.params.questionId);
//     await questionSet.save();

//     res.json({
//       success: true,
//       message: "Question deleted successfully",
//       questionSet,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// });

// // @route   GET /api/questionset/template/download
// // @desc    Download CSV template for bulk upload
// // @access  Private (Admin only)
// router.get("/template/download", verifyAdmin, (req, res) => {
//   const csvTemplate = `type,question,options,correctanswer,points
// multiple-choice,What is 2+2?,1|2|3|4,4,1
// true-false,JavaScript is a programming language,,true,1
// essay,Explain the concept of closures in JavaScript,,,5
// fill-in-the-blanks,The capital of France is ____,,Paris,1`;

//   res.setHeader("Content-Type", "text/csv");
//   res.setHeader(
//     "Content-Disposition",
//     "attachment; filename=questionset-template.csv",
//   );
//   res.send(csvTemplate);
// });

// // Helper function to parse questions from data
// function parseQuestions(data) {
//   const questions = [];
//   const validTypes = [
//     "multiple-choice",
//     "essay",
//     "true-false",
//     "fill-in-the-blanks",
//   ];

//   data.forEach((row, index) => {
//     try {
//       const type = row.type?.trim().toLowerCase();
//       const question = row.question?.trim();
//       const points = parseInt(row.points) || 1;

//       // Validate required fields
//       if (!type || !question) {
//         console.warn(`Skipping row ${index + 1}: Missing type or question`);
//         return;
//       }

//       if (!validTypes.includes(type)) {
//         console.warn(
//           `Skipping row ${index + 1}: Invalid question type '${type}'`,
//         );
//         return;
//       }

//       const questionObj = {
//         type,
//         question,
//         points,
//         order: index + 1,
//       };

//       // Handle different question types
//       if (type === "multiple-choice") {
//         const optionsStr = row.options?.trim();
//         if (!optionsStr) {
//           console.warn(
//             `Skipping row ${index + 1}: Multiple choice requires options`,
//           );
//           return;
//         }

//         questionObj.options = optionsStr
//           .split("|")
//           .map((opt) => opt.trim())
//           .filter((opt) => opt);
//         questionObj.correctAnswer =
//           row.correctanswer?.trim() || row["correct answer"]?.trim();

//         if (!questionObj.correctAnswer) {
//           console.warn(`Skipping row ${index + 1}: Missing correct answer`);
//           return;
//         }
//       } else if (type === "true-false") {
//         const answer = (
//           row.correctanswer?.trim() || row["correct answer"]?.trim()
//         )?.toLowerCase();

//         if (answer === "true" || answer === "t" || answer === "1") {
//           questionObj.correctAnswer = true;
//         } else if (answer === "false" || answer === "f" || answer === "0") {
//           questionObj.correctAnswer = false;
//         } else {
//           console.warn(
//             `Skipping row ${index + 1}: True/False requires 'true' or 'false' answer`,
//           );
//           return;
//         }
//       } else if (type === "fill-in-the-blanks") {
//         questionObj.correctAnswer =
//           row.correctanswer?.trim() || row["correct answer"]?.trim();

//         if (!questionObj.correctAnswer) {
//           console.warn(`Skipping row ${index + 1}: Missing correct answer`);
//           return;
//         }
//       } else if (type === "essay") {
//         questionObj.correctAnswer =
//           row.correctanswer?.trim() || row["correct answer"]?.trim() || "";
//       }

//       questions.push(questionObj);
//     } catch (error) {
//       console.error(`Error parsing row ${index + 1}:`, error.message);
//     }
//   });

//   return questions;
// }

// module.exports = router;
