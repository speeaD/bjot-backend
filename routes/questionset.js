const express = require("express");
const router = express.Router();
const { verifyAdmin } = require("../middleware/auth");
const QuestionSet = require("../models/QuestionSet");

function parseQuestions(data) {
  const questions = [];
  const validTypes = [
    "multiple-choice",
    "essay",
    "true-false",
    "fill-in-the-blanks",
  ];

  data.forEach((row, index) => {
    try {
      const type = row.type?.trim().toLowerCase();
      const questionText = row.question?.trim();
      const passage = row.passage?.trim() || "";
      const diagram = row.diagram?.trim() || null;
      const diagramAlt =
        row.diagramalt?.trim() || row["diagram alt"]?.trim() || "";
      const points = parseInt(row.points) || 1;

      if (!type || !questionText) {
        console.warn(`Skipping row ${index + 1}: Missing type or question`);
        return;
      }

      if (!validTypes.includes(type)) {
        console.warn(
          `Skipping row ${index + 1}: Invalid question type '${type}'`,
        );
        return;
      }

      const questionObj = {
        type,
        question: questionText,
        passage,
        diagram: diagram || null,
        diagramAlt,
        points,
        order: index + 1,
      };

      if (type === "multiple-choice") {
        const optionsStr = row.options?.trim();
        if (!optionsStr) {
          console.warn(
            `Skipping row ${index + 1}: Multiple choice requires options`,
          );
          return;
        }
        questionObj.options = optionsStr
          .split("|")
          .map((opt) => opt.trim())
          .filter((opt) => opt);

        questionObj.correctAnswer =
          row.correctanswer?.trim() || row["correct answer"]?.trim();

        if (!questionObj.correctAnswer) {
          console.warn(`Skipping row ${index + 1}: Missing correct answer`);
          return;
        }
      } else if (type === "true-false") {
        const answer = (
          row.correctanswer?.trim() || row["correct answer"]?.trim()
        )?.toLowerCase();
        if (answer === "true" || answer === "t" || answer === "1") {
          questionObj.correctAnswer = true;
        } else if (answer === "false" || answer === "f" || answer === "0") {
          questionObj.correctAnswer = false;
        } else {
          console.warn(
            `Skipping row ${index + 1}: True/False requires 'true' or 'false'`,
          );
          return;
        }
      } else if (type === "fill-in-the-blanks" || type === "essay") {
        questionObj.correctAnswer =
          row.correctanswer?.trim() || row["correct answer"]?.trim() || "";
      }

      questions.push(questionObj);
    } catch (error) {
      console.error(`Error parsing row ${index + 1}:`, error.message);
    }
  });

  return questions;
}
// @route   POST /api/questionset/bulk-upload
// @desc    Create a new question set via bulk upload (Excel/CSV)
// @access  Private (Admin only)
router.post("/bulk-upload", verifyAdmin, async (req, res) => {
  const upload = req.app.get("upload");

  upload.single("file")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a CSV or Excel file",
      });
    }

    try {
      // Get title and batch info from form data
      const title = req.body.title?.trim();
      const usesBatches = req.body.usesBatches === "true";
      const batchNumber = parseInt(req.body.batchNumber) || 1;
      const batchName = req.body.batchName?.trim() || `Batch ${batchNumber}`;

      if (!title) {
        return res.status(400).json({
          success: false,
          message: "Question set title is required",
        });
      }

      let questions = [];
      const fileBuffer = req.file.buffer;
      const mimetype = req.file.mimetype;

      // Parse CSV file
      if (mimetype === "text/csv") {
        const Papa = require("papaparse");
        const csvString = fileBuffer.toString("utf-8");

        const result = Papa.parse(csvString, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim().toLowerCase(),
        });

        if (result.errors.length > 0) {
          return res.status(400).json({
            success: false,
            message: "Error parsing CSV file",
            errors: result.errors,
          });
        }

        questions = parseQuestions(result.data);
      }
      // Parse Excel file
      else {
        const XLSX = require("node-xlsx");
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, {
          raw: false,
          defval: "",
        });

        // Normalize headers
        const normalizedData = data.map((row) => {
          const normalizedRow = {};
          Object.keys(row).forEach((key) => {
            normalizedRow[key.trim().toLowerCase()] = row[key];
          });
          return normalizedRow;
        });

        questions = parseQuestions(normalizedData);
      }

      if (questions.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid questions found in file",
        });
      }

      // Create question set with batch structure
      const questionSetData = {
        title,
        createdBy: req.admin._id,
        usesBatches,
      };

      if (usesBatches) {
        questionSetData.batches = [
          {
            batchNumber,
            name: batchName,
            questions,
          },
        ];
      } else {
        // Legacy structure
        questionSetData.questions = questions;
      }

      const questionSet = new QuestionSet(questionSetData);
      await questionSet.save();

      res.status(201).json({
        success: true,
        message: `Question set created successfully with ${questions.length} questions`,
        questionSet,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  });
});

// @route   POST /api/questionset/:id/batches
// @desc    Add a new batch to an existing question set
// @access  Private (Admin only)
router.post("/:id/batches", verifyAdmin, async (req, res) => {
  const upload = req.app.get("upload");
  const uploadMiddleware = upload.single("file");

  uploadMiddleware(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "File upload error",
      });
    }

    try {
      // Get batch info from body
      const batchNumber = parseInt(req.body.batchNumber);
      const batchName = req.body.name?.trim();

      if (isNaN(batchNumber) || batchNumber < 1) {
        return res.status(400).json({
          success: false,
          message: "Valid batchNumber (positive integer) is required",
        });
      }

      if (!batchName) {
        return res.status(400).json({
          success: false,
          message: "Batch name is required",
        });
      }

      let questions = [];

      // Priority: if file uploaded, parse it
      if (req.file) {
        const fileBuffer = req.file.buffer;
        const mimetype = req.file.mimetype;
        let parsedData = [];

        if (mimetype === "text/csv") {
          const Papa = require("papaparse");
          const csvString = fileBuffer.toString("utf-8");
          const result = Papa.parse(csvString, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim().toLowerCase(),
          });

          if (result.errors.length > 0) {
            return res.status(400).json({
              success: false,
              message: "Error parsing CSV file",
              errors: result.errors,
            });
          }

          parsedData = result.data;
        } else if (
          mimetype ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          mimetype === "application/vnd.ms-excel" ||
          mimetype.includes("spreadsheet")
        ) {
          const XLSX = require("node-xlsx");
          const workbook = XLSX.read(fileBuffer, { type: "buffer" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          parsedData = XLSX.utils.sheet_to_json(worksheet, {
            raw: false,
            defval: "",
          });

          // Normalize headers to lowercase/trim
          parsedData = parsedData.map((row) => {
            const normalized = {};
            Object.keys(row).forEach((key) => {
              normalized[key.trim().toLowerCase()] = row[key];
            });
            return normalized;
          });
        } else {
          return res.status(400).json({
            success: false,
            message: "Unsupported file type. Use .csv, .xlsx, or .xls",
          });
        }

        questions = parseQuestions(parsedData);

        if (questions.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No valid questions found in the uploaded file",
          });
        }
      }
      // Fallback: if no file but questions in body (JSON array)
      else if (req.body.questions) {
        try {
          questions = JSON.parse(req.body.questions);
          if (!Array.isArray(questions) || questions.length === 0) {
            return res.status(400).json({
              success: false,
              message: "Questions must be a non-empty array",
            });
          }
        } catch (parseErr) {
          return res.status(400).json({
            success: false,
            message: "Invalid questions JSON format",
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          message:
            "Either a file upload or a questions array in the body is required",
        });
      }

      // Now proceed with adding the batch
      const questionSet = await QuestionSet.findById(req.params.id);

      if (!questionSet) {
        return res.status(404).json({
          success: false,
          message: "Question set not found",
        });
      }

      // Check for duplicate batch number
      if (questionSet.usesBatches) {
        const existing = questionSet.batches.find(
          (b) => b.batchNumber === batchNumber,
        );
        if (existing) {
          return res.status(400).json({
            success: false,
            message: `Batch number ${batchNumber} already exists`,
          });
        }
      } else {
        // Auto-convert legacy set to batches if this is the first batch
        questionSet.usesBatches = true;
        if (questionSet.questions?.length > 0) {
          questionSet.batches = [
            {
              batchNumber: 1,
              name: "Batch 1 (Legacy Questions)",
              questions: questionSet.questions,
              isActive: true,
            },
          ];
          questionSet.questions = [];
        }
      }

      // Add the new batch
      questionSet.batches.push({
        batchNumber,
        name: batchName,
        questions,
        isActive: true, // Default to active; adjust in schema if needed
      });

      await questionSet.save();

      res.status(201).json({
        success: true,
        message: `Batch added successfully with ${questions.length} questions`,
        questionSet,
      });
    } catch (error) {
      console.error("Error adding batch:", error);
      res.status(500).json({
        success: false,
        message: "Server error while adding batch",
        error: error.message,
      });
    }
  });
});

// @route   PUT /api/questionset/:id/batches/:batchId
// @desc    Update a specific batch in a question set
// @access  Private (Admin only)
router.put("/:id/batches/:batchId", verifyAdmin, async (req, res) => {
  try {
    const { name, questions, isActive } = req.body;

    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    if (!questionSet.usesBatches) {
      return res.status(400).json({
        success: false,
        message: "This question set does not use batches",
      });
    }

    const batch = questionSet.batches.id(req.params.batchId);

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    // Update batch fields
    if (name) batch.name = name;
    if (questions) batch.questions = questions;
    if (typeof isActive !== "undefined") batch.isActive = isActive;

    await questionSet.save();

    res.json({
      success: true,
      message: "Batch updated successfully",
      questionSet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   DELETE /api/questionset/:id/batches/:batchId
// @desc    Delete a specific batch from a question set
// @access  Private (Admin only)
router.delete("/:id/batches/:batchId", verifyAdmin, async (req, res) => {
  try {
    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    if (!questionSet.usesBatches) {
      return res.status(400).json({
        success: false,
        message: "This question set does not use batches",
      });
    }

    const batch = questionSet.batches.id(req.params.batchId);

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    // Check if batch is being used in any quiz
    const Quiz = require("../models/Quiz");
    const quizzesUsingBatch = await Quiz.countDocuments({
      "questionSets.questionSetId": req.params.id,
      "questionSets.batchId": req.params.batchId,
    });

    if (quizzesUsingBatch > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete batch. It is being used in ${quizzesUsingBatch} quiz(zes). Please remove it from those quizzes first or deactivate it instead.`,
      });
    }

    questionSet.batches.pull(req.params.batchId);
    await questionSet.save();

    res.json({
      success: true,
      message: "Batch deleted successfully",
      questionSet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   PATCH /api/questionset/:id/batches/:batchId/toggle-active
// @desc    Toggle batch active status
// @access  Private (Admin only)
router.patch(
  "/:id/batches/:batchId/toggle-active",
  verifyAdmin,
  async (req, res) => {
    try {
      const questionSet = await QuestionSet.findById(req.params.id);

      if (!questionSet) {
        return res.status(404).json({
          success: false,
          message: "Question set not found",
        });
      }

      if (!questionSet.usesBatches) {
        return res.status(400).json({
          success: false,
          message: "This question set does not use batches",
        });
      }

      const batch = questionSet.batches.id(req.params.batchId);

      if (!batch) {
        return res.status(404).json({
          success: false,
          message: "Batch not found",
        });
      }

      batch.isActive = !batch.isActive;
      await questionSet.save();

      res.json({
        success: true,
        message: `Batch ${batch.isActive ? "activated" : "deactivated"} successfully`,
        questionSet,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  },
);

// @route   GET /api/questionset/:id/batches
// @desc    Get all batches for a question set
// @access  Private (Admin only)
router.get("/:id/batches", verifyAdmin, async (req, res) => {
  try {
    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    if (!questionSet.usesBatches) {
      return res.json({
        success: true,
        usesBatches: false,
        batches: [],
        message: "This question set does not use batches",
      });
    }

    res.json({
      success: true,
      usesBatches: true,
      batches: questionSet.batches,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/questionset/:id/convert-to-batches
// @desc    Convert a legacy question set to use batches
// @access  Private (Admin only)
router.post("/:id/convert-to-batches", verifyAdmin, async (req, res) => {
  try {
    const questionSet = await QuestionSet.convertToBatches(req.params.id);

    res.json({
      success: true,
      message: "Question set converted to batch structure successfully",
      questionSet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
});

// @route   GET /api/questionset
// @desc    Get all question sets
// @access  Private (Admin only)
router.get("/", async (req, res) => {
  try {
    const { isActive, search } = req.query;

    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (search) {
      filter.title = { $regex: search, $options: "i" };
    }

    const questionSets = await QuestionSet.find(filter)
      .populate("createdBy", "email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: questionSets.length,
      questionSets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/questionset/:id
// @desc    Get single question set by ID
// @access  Private (Admin only)
router.get("/:id", verifyAdmin, async (req, res) => {
  try {
    const questionSet = await QuestionSet.findById(req.params.id).populate(
      "createdBy",
      "email",
    );

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    res.json({
      success: true,
      questionSet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   PUT /api/questionset/:id
// @desc    Update question set
// @access  Private (Admin only)
router.put("/:id", verifyAdmin, async (req, res) => {
  try {
    const { title, questions, isActive } = req.body;

    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    // Update fields
    if (title) questionSet.title = title;
    if (questions && !questionSet.usesBatches) {
      // Only allow direct question updates for non-batched question sets
      questionSet.questions = questions;
    }
    if (typeof isActive !== "undefined") questionSet.isActive = isActive;

    await questionSet.save();

    res.json({
      success: true,
      message: "Question set updated successfully",
      questionSet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   DELETE /api/questionset/:id
// @desc    Delete question set
// @access  Private (Admin only)
router.delete("/:id", verifyAdmin, async (req, res) => {
  try {
    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    // Check if question set is being used in any quiz
    const Quiz = require("../models/Quiz");
    const quizzesUsingSet = await Quiz.countDocuments({
      "questionSets.questionSetId": req.params.id,
    });

    if (quizzesUsingSet > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete question set. It is being used in ${quizzesUsingSet} quiz(zes). Please remove it from those quizzes first or deactivate it instead.`,
      });
    }

    await questionSet.deleteOne();

    res.json({
      success: true,
      message: "Question set deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   PATCH /api/questionset/:id/toggle-active
// @desc    Toggle question set active status
// @access  Private (Admin only)
router.patch("/:id/toggle-active", verifyAdmin, async (req, res) => {
  try {
    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    questionSet.isActive = !questionSet.isActive;
    await questionSet.save();

    res.json({
      success: true,
      message: `Question set ${questionSet.isActive ? "activated" : "deactivated"} successfully`,
      questionSet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/questionset/:id/questions
// @desc    Add questions to existing question set (legacy only)
// @access  Private (Admin only)
router.post("/:id/questions", verifyAdmin, async (req, res) => {
  try {
    const { questions } = req.body;

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({
        success: false,
        message: "Questions array is required",
      });
    }

    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    if (questionSet.usesBatches) {
      return res.status(400).json({
        success: false,
        message:
          "This question set uses batches. Please add questions to a specific batch instead.",
      });
    }

    // Add new questions with proper order
    const startOrder = questionSet.questions.length;
    questions.forEach((q, index) => {
      q.order = startOrder + index + 1;
    });

    questionSet.questions.push(...questions);
    await questionSet.save();

    res.json({
      success: true,
      message: "Questions added successfully",
      questionSet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   PUT /api/questionset/:id/questions/:questionId
// @desc    Update a specific question in a question set (legacy only)
// @access  Private (Admin only)
router.put("/:id/questions/:questionId", verifyAdmin, async (req, res) => {
  try {
    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    if (questionSet.usesBatches) {
      return res.status(400).json({
        success: false,
        message:
          "This question set uses batches. Please update questions within a specific batch.",
      });
    }

    const question = questionSet.questions.id(req.params.questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

    // Update question fields
    Object.assign(question, req.body);
    await questionSet.save();

    res.json({
      success: true,
      message: "Question updated successfully",
      questionSet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   DELETE /api/questionset/:id/questions/:questionId
// @desc    Delete a specific question from a question set (legacy only)
// @access  Private (Admin only)
router.delete("/:id/questions/:questionId", verifyAdmin, async (req, res) => {
  try {
    const questionSet = await QuestionSet.findById(req.params.id);

    if (!questionSet) {
      return res.status(404).json({
        success: false,
        message: "Question set not found",
      });
    }

    if (questionSet.usesBatches) {
      return res.status(400).json({
        success: false,
        message:
          "This question set uses batches. Please delete questions from a specific batch.",
      });
    }

    questionSet.questions.pull(req.params.questionId);
    await questionSet.save();

    res.json({
      success: true,
      message: "Question deleted successfully",
      questionSet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/questionset/:id/batches/:batchId/questions
// @desc    Add questions to a specific batch
// @access  Private (Admin only)
router.post(
  "/:id/batches/:batchId/questions",
  verifyAdmin,
  async (req, res) => {
    try {
      const { questions } = req.body;

      if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({
          success: false,
          message: "Questions array is required",
        });
      }

      const questionSet = await QuestionSet.findById(req.params.id);

      if (!questionSet) {
        return res.status(404).json({
          success: false,
          message: "Question set not found",
        });
      }

      if (!questionSet.usesBatches) {
        return res.status(400).json({
          success: false,
          message: "This question set does not use batches",
        });
      }

      const batch = questionSet.batches.id(req.params.batchId);

      if (!batch) {
        return res.status(404).json({
          success: false,
          message: "Batch not found",
        });
      }

      // Add new questions with proper order
      const startOrder = batch.questions.length;
      questions.forEach((q, index) => {
        q.order = startOrder + index + 1;
      });

      batch.questions.push(...questions);
      await questionSet.save();

      res.json({
        success: true,
        message: "Questions added to batch successfully",
        questionSet,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  },
);

// @route   PUT /api/questionset/:id/batches/:batchId/questions/:questionId
// @desc    Update a specific question in a batch
// @access  Private (Admin only)
router.put(
  "/:id/batches/:batchId/questions/:questionId",
  verifyAdmin,
  async (req, res) => {
    try {
      const questionSet = await QuestionSet.findById(req.params.id);

      if (!questionSet) {
        return res.status(404).json({
          success: false,
          message: "Question set not found",
        });
      }

      if (!questionSet.usesBatches) {
        return res.status(400).json({
          success: false,
          message: "This question set does not use batches",
        });
      }

      const batch = questionSet.batches.id(req.params.batchId);

      if (!batch) {
        return res.status(404).json({
          success: false,
          message: "Batch not found",
        });
      }

      const question = batch.questions.id(req.params.questionId);

      if (!question) {
        return res.status(404).json({
          success: false,
          message: "Question not found in batch",
        });
      }

      // Update question fields
      Object.assign(question, req.body);
      await questionSet.save();

      res.json({
        success: true,
        message: "Question updated successfully",
        questionSet,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  },
);

// @route   DELETE /api/questionset/:id/batches/:batchId/questions/:questionId
// @desc    Delete a specific question from a batch
// @access  Private (Admin only)
router.delete(
  "/:id/batches/:batchId/questions/:questionId",
  verifyAdmin,
  async (req, res) => {
    try {
      const questionSet = await QuestionSet.findById(req.params.id);

      if (!questionSet) {
        return res.status(404).json({
          success: false,
          message: "Question set not found",
        });
      }

      if (!questionSet.usesBatches) {
        return res.status(400).json({
          success: false,
          message: "This question set does not use batches",
        });
      }

      const batch = questionSet.batches.id(req.params.batchId);

      if (!batch) {
        return res.status(404).json({
          success: false,
          message: "Batch not found",
        });
      }

      batch.questions.pull(req.params.questionId);
      await questionSet.save();

      res.json({
        success: true,
        message: "Question deleted from batch successfully",
        questionSet,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  },
);

// @route   GET /api/questionset/template/download
// @desc    Download CSV template for bulk upload
// @access  Private (Admin only)
router.get("/template/download", verifyAdmin, (req, res) => {
  const csvTemplate = `type,question,passage,diagram,diagramAlt,options,correctanswer,points
multiple-choice,What is 2+2?,,,,1|2|3|4,4,1
true-false,JavaScript is a programming language,,,,,true,1
essay,Explain the concept of closures in JavaScript,"JavaScript closures are functions that have access to variables from an outer function scope.",,,,5
fill-in-the-blanks,The capital of France is ____,,,,,Paris,1`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=questionset-template.csv",
  );
  res.send(csvTemplate);
});

// Helper function to parse questions from data
function parseQuestions(data) {
  const questions = [];
  const validTypes = [
    "multiple-choice",
    "essay",
    "true-false",
    "fill-in-the-blanks",
  ];

  data.forEach((row, index) => {
    try {
      const type = row.type?.trim().toLowerCase();
      const question = row.question?.trim();
      const passage = row.passage?.trim() || "";
      const diagram = row.diagram?.trim() || null;
      const diagramAlt =
        row.diagramalt?.trim() || row["diagram alt"]?.trim() || "";
      const points = parseInt(row.points) || 1;

      // Validate required fields
      if (!type || !question) {
        console.warn(`Skipping row ${index + 1}: Missing type or question`);
        return;
      }

      if (!validTypes.includes(type)) {
        console.warn(
          `Skipping row ${index + 1}: Invalid question type '${type}'`,
        );
        return;
      }

      const questionObj = {
        type,
        question,
        passage,
        diagram: diagram || null,
        diagramAlt,
        points,
        order: index + 1,
      };

      // Handle different question types
      if (type === "multiple-choice") {
        const optionsStr = row.options?.trim();
        if (!optionsStr) {
          console.warn(
            `Skipping row ${index + 1}: Multiple choice requires options`,
          );
          return;
        }

        questionObj.options = optionsStr
          .split("|")
          .map((opt) => opt.trim())
          .filter((opt) => opt);
        questionObj.correctAnswer =
          row.correctanswer?.trim() || row["correct answer"]?.trim();

        if (!questionObj.correctAnswer) {
          console.warn(`Skipping row ${index + 1}: Missing correct answer`);
          return;
        }
      } else if (type === "true-false") {
        const answer = (
          row.correctanswer?.trim() || row["correct answer"]?.trim()
        )?.toLowerCase();

        if (answer === "true" || answer === "t" || answer === "1") {
          questionObj.correctAnswer = true;
        } else if (answer === "false" || answer === "f" || answer === "0") {
          questionObj.correctAnswer = false;
        } else {
          console.warn(
            `Skipping row ${index + 1}: True/False requires 'true' or 'false' answer`,
          );
          return;
        }
      } else if (type === "fill-in-the-blanks") {
        questionObj.correctAnswer =
          row.correctanswer?.trim() || row["correct answer"]?.trim();

        if (!questionObj.correctAnswer) {
          console.warn(`Skipping row ${index + 1}: Missing correct answer`);
          return;
        }
      } else if (type === "essay") {
        questionObj.correctAnswer =
          row.correctanswer?.trim() || row["correct answer"]?.trim() || "";
      }

      questions.push(questionObj);
    } catch (error) {
      console.error(`Error parsing row ${index + 1}:`, error.message);
    }
  });

  return questions;
}

module.exports = router;
