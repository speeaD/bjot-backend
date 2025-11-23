const express = require("express");
const router = express.Router();
const { verifyAdmin } = require("../middleware/auth");
const Quiz = require("../models/Quiz");

// @route   POST /api/quiz
// @desc    Create a new quiz
// @access  Private (Admin only)
router.post("/", verifyAdmin, async (req, res) => {
  try {
    const { settings, questions } = req.body;

    // Validation
    if (!settings || !settings.title) {
      return res.status(400).json({
        success: false,
        message: "Quiz title is required",
      });
    }

    // Create quiz
    const quiz = new Quiz({
      settings,
      questions: questions || [],
      createdBy: req.admin._id,
    });

    await quiz.save();

    res.status(201).json({
      success: true,
      message: "Quiz created successfully",
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

// @route   POST /api/quiz/create-with-upload
// @desc    Create a new quiz with questions from uploaded CSV or Excel file
// @access  Private (Admin only)
router.post('/create-with-upload', verifyAdmin, async (req, res) => {
  const upload = req.app.get('upload');
  
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    try {
      // Parse settings from form data
      let settings;
      try {
        settings = JSON.parse(req.body.settings);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid settings format. Settings must be valid JSON.',
        });
      }

      // Validation
      if (!settings || !settings.title) {
        return res.status(400).json({
          success: false,
          message: 'Quiz title is required',
        });
      }

      let questions = [];

      // If file is provided, parse questions from file
      if (req.file) {
        const fileBuffer = req.file.buffer;
        const mimetype = req.file.mimetype;

        // Parse CSV file
        if (mimetype === 'text/csv') {
          const Papa = require('papaparse');
          const csvString = fileBuffer.toString('utf-8');
          
          const result = Papa.parse(csvString, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim().toLowerCase(),
          });

          if (result.errors.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Error parsing CSV file',
              errors: result.errors,
            });
          }

          questions = parseQuestions(result.data);
        } 
        // Parse Excel file
        else {
          const XLSX = require('node-xlsx');
          const workbook = XLSX.parse(fileBuffer);
          const sheet = workbook[0];
          const data = sheet.data.map(row => {
            const obj = {};
            sheet.data[0].forEach((header, index) => {
              obj[header.trim().toLowerCase()] = row[index];
            });
            return obj;
          });

          // Normalize headers
          const normalizedData = data.map(row => {
            const normalizedRow = {};
            Object.keys(row).forEach(key => {
              normalizedRow[key.trim().toLowerCase()] = row[key];
            });
            return normalizedRow;
          });

          questions = parseQuestions(normalizedData);
        }

        if (questions.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'No valid questions found in file',
          });
        }
      }

      // Create quiz with or without questions
      const quiz = new Quiz({
        settings,
        questions,
        createdBy: req.admin._id,
      });

      await quiz.save();

      res.status(201).json({
        success: true,
        message: `Quiz created successfully${questions.length > 0 ? ` with ${questions.length} questions` : ''}`,
        quiz,
        questionsAdded: questions.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message,
      });
    }
  });
});


// @route   GET /api/quiz
// @desc    Get all quizzes
// @access  Private (Admin only)
router.get("/", verifyAdmin, async (req, res) => {
  try {
    const { isActive, isQuizChallenge } = req.query;

    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (isQuizChallenge !== undefined)
      filter["settings.isQuizChallenge"] = isQuizChallenge === "true";

    const quizzes = await Quiz.find(filter)
      .populate("createdBy", "email")
      .sort({ createdAt: -1 });

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
    const quiz = await Quiz.findById(req.params.id).populate(
      "createdBy",
      "email"
    );

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
// @desc    Update quiz
// @access  Private (Admin only)
router.put("/:id", verifyAdmin, async (req, res) => {
  try {
    const { settings, questions, isActive } = req.body;

    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Update fields
    if (settings) {
      quiz.settings = { ...quiz.settings, ...settings };
    }
    if (questions) {
      quiz.questions = questions;
    }
    if (typeof isActive !== "undefined") {
      quiz.isActive = isActive;
    }

    await quiz.save();

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

// @route   POST /api/quiz/:id/questions
// @desc    Add questions to quiz
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

    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    // Add new questions
    quiz.questions.push(...questions);
    await quiz.save();

    res.json({
      success: true,
      message: "Questions added successfully",
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

// @route   PUT /api/quiz/:id/questions/:questionId
// @desc    Update a specific question
// @access  Private (Admin only)
router.put("/:id/questions/:questionId", verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    const question = quiz.questions.id(req.params.questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

    // Update question fields
    Object.assign(question, req.body);
    await quiz.save();

    res.json({
      success: true,
      message: "Question updated successfully",
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

// @route   DELETE /api/quiz/:id/questions/:questionId
// @desc    Delete a specific question
// @access  Private (Admin only)
router.delete("/:id/questions/:questionId", verifyAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    quiz.questions.pull(req.params.questionId);
    await quiz.save();

    res.json({
      success: true,
      message: "Question deleted successfully",
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
      message: `Quiz ${
        quiz.isActive ? "activated" : "deactivated"
      } successfully`,
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

// @route   POST /api/quiz/:id/bulk-upload
// @desc    Bulk upload questions from CSV or Excel file
// @access  Private (Admin only)
router.post("/:id/bulk-upload", verifyAdmin, async (req, res) => {
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
      const quiz = await Quiz.findById(req.params.id);

      if (!quiz) {
        return res.status(404).json({
          success: false,
          message: "Quiz not found",
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

      // Add questions to quiz
      const startOrder = quiz.questions.length;
      questions.forEach((q, index) => {
        q.order = startOrder + index + 1;
      });

      quiz.questions.push(...questions);
      await quiz.save();

      res.json({
        success: true,
        message: `Successfully uploaded ${questions.length} questions`,
        questionsAdded: questions.length,
        totalQuestions: quiz.questions.length,
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
      const points = parseInt(row.points) || 1;

      // Validate required fields
      if (!type || !question) {
        console.warn(`Skipping row ${index + 1}: Missing type or question`);
        return;
      }

      if (!validTypes.includes(type)) {
        console.warn(
          `Skipping row ${index + 1}: Invalid question type '${type}'`
        );
        return;
      }

      const questionObj = {
        type,
        question,
        points,
        order: index + 1,
      };

      // Handle different question types
      if (type === "multiple-choice") {
        // Options can be in format: "option1|option2|option3|option4"
        const optionsStr = row.options?.trim();
        if (!optionsStr) {
          console.warn(
            `Skipping row ${index + 1}: Multiple choice requires options`
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
            `Skipping row ${
              index + 1
            }: True/False requires 'true' or 'false' answer`
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
        // Essay questions don't need correct answer
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

// @route   GET /api/quiz/template/download
// @desc    Download CSV template for bulk upload
// @access  Private (Admin only)
router.get("/template/download", verifyAdmin, (req, res) => {
  const csvTemplate = `type,question,options,correctanswer,points
multiple-choice,What is 2+2?,1|2|3|4,4,1
true-false,JavaScript is a programming language,,true,1
essay,Explain the concept of closures in JavaScript,,,5
fill-in-the-blanks,The capital of France is ____,Paris,1`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=quiz-questions-template.csv"
  );
  res.send(csvTemplate);
});
module.exports = router;
