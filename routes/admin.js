const express = require("express");
const router = express.Router();
const { verifyAdmin } = require("../middleware/auth");
const QuizTaker = require("../models/QuizTaker");
const Quiz = require("../models/Quiz");
const multer = require("multer");
const XLSX = require("xlsx");
const { sendAccessCodeEmail } = require("../utils/emailService");

// @route   POST /api/admin/quiztaker
// @desc    Create a new PREMIUM quiz taker
// @access  Private (Admin only)
// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only CSV and Excel files are allowed."));
    }
  },
});

// @route   POST /api/admin/bulk-upload-quiztakers
// @desc    Bulk upload quiz takers from CSV/Excel file
// @access  Private (Admin only)
router.post(
  "/bulk-upload-quiztakers",
  verifyAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please upload a CSV or Excel file",
        });
      }

      // Parse the uploaded file
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      // const headers = data[0]; // First row is headers
      // const jsonData = data.slice(1).map((row) => {
      //   const obj = {};
      //   headers.forEach((header, index) => {
      //     obj[header] = row[index];
      //   });
      //   return obj;
      // });

      if (!data || data.length === 0) {
        return res.status(400).json({
          success: false,
          message: "File is empty or invalid format",
        });
      }

      const results = {
        total: data.length,
        successful: [],
        failed: [],
      };

      const QuestionSet = require("../models/QuestionSet");

      // Process each row
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowNumber = i + 2; // +2 because row 1 is header, and arrays are 0-indexed

        try {
          // Validate required fields
          const email = row.email?.toString().trim().toLowerCase();
          const accountType = row.accountType?.toString().trim().toLowerCase();

          if (!email) {
            results.failed.push({
              row: rowNumber,
              email: email || "N/A",
              reason: "Email is required",
            });
            continue;
          }

          if (!accountType || !["premium", "regular"].includes(accountType)) {
            results.failed.push({
              row: rowNumber,
              email,
              reason: 'Invalid account type. Must be "premium" or "regular"',
            });
            continue;
          }

          // Check for existing quiz taker
          const existingQuizTaker = await QuizTaker.findOne({
            email,
            accountType,
          });

          if (existingQuizTaker) {
            results.failed.push({
              row: rowNumber,
              email,
              reason: `${accountType} quiz taker with this email already exists`,
            });
            continue;
          }

          const name = row.name?.toString().trim() || "";
          let questionSetCombination = [];
          let accessCode = null;

          // Handle premium students
          if (accountType === "premium") {
            // Get question set titles from columns
            const qsTitle1 = row.questionSet1?.toString().trim();
            const qsTitle2 = row.questionSet2?.toString().trim();
            const qsTitle3 = row.questionSet3?.toString().trim();
            const qsTitle4 = row.questionSet4?.toString().trim();

            if (!qsTitle1 || !qsTitle2 || !qsTitle3 || !qsTitle4) {
              results.failed.push({
                row: rowNumber,
                email,
                reason:
                  "Premium students must have all 4 question sets specified",
              });
              continue;
            }

            // Look up question sets by title
            const questionSetTitles = [qsTitle1, qsTitle2, qsTitle3, qsTitle4];
            const questionSets = await QuestionSet.find({
              title: { $in: questionSetTitles },
            });

            // Verify all question sets were found
            if (questionSets.length !== 4) {
              const foundTitles = questionSets.map((qs) => qs.title);
              const missingTitles = questionSetTitles.filter(
                (t) => !foundTitles.includes(t),
              );

              results.failed.push({
                row: rowNumber,
                email,
                reason: `Question set(s) not found: ${missingTitles.join(", ")}`,
              });
              continue;
            }

            // Map titles to IDs in the correct order
            questionSetCombination = questionSetTitles.map((title) => {
              const qs = questionSets.find((q) => q.title === title);
              return qs._id;
            });

            // Generate unique access code
            let isUnique = false;
            while (!isUnique) {
              accessCode = QuizTaker.generateAccessCode();
              const existing = await QuizTaker.findOne({ accessCode });
              if (!existing) isUnique = true;
            }
          }

          // Create quiz taker
          const quizTaker = new QuizTaker({
            accountType,
            email,
            name,
            ...(accountType === "premium" && {
              accessCode,
              questionSetCombination,
            }),
          });

          await quizTaker.save();

          // Send email to premium students with access code
          if (accountType === "premium" && accessCode) {
            try {
              await sendAccessCodeEmail(email, name, accessCode);
            } catch (emailError) {
              console.error(`Failed to send email to ${email}:`, emailError);
              // Don't fail the creation if email fails, just log it
            }
          }

          results.successful.push({
            row: rowNumber,
            email,
            accountType,
            ...(accountType === "premium" && { accessCode }),
          });
        } catch (error) {
          results.failed.push({
            row: rowNumber,
            email: row.email || "N/A",
            reason: error.message,
          });
        }
      }

      res.json({
        success: true,
        message: `Bulk upload completed. ${results.successful.length} successful, ${results.failed.length} failed.`,
        results: {
          total: results.total,
          successCount: results.successful.length,
          failCount: results.failed.length,
          successful: results.successful,
          failed: results.failed,
        },
      });
    } catch (error) {
      console.error("Bulk upload error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during bulk upload",
        error: error.message,
      });
    }
  },
);

// @route   GET /api/admin/download-template
// @desc    Download CSV template for bulk upload
// @access  Private (Admin only)
router.get("/download-template", verifyAdmin, (req, res) => {
  try {
    const template = [
      {
        email: "student@example.com",
        name: "John Doe",
        accountType: "premium",
        questionSet1: "Math Basics",
        questionSet2: "Physics 101",
        questionSet3: "Chemistry",
        questionSet4: "Biology",
      },
      {
        email: "regular@example.com",
        name: "Jane Smith",
        accountType: "regular",
        questionSet1: "",
        questionSet2: "",
        questionSet3: "",
        questionSet4: "",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(template);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Quiz Takers");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=quiztaker_upload_template.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(buffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error generating template",
      error: error.message,
    });
  }
});

router.post("/quiztaker", verifyAdmin, async (req, res) => {
  try {
    const { email, name, questionSetCombination } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide email address",
      });
    }

    if (
      !questionSetCombination ||
      !Array.isArray(questionSetCombination) ||
      questionSetCombination.length !== 4
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a valid question set combination (array of 4 question set IDs)",
      });
    }

    // Check if premium quiz taker with this email already exists
    const existingQuizTaker = await QuizTaker.findOne({
      email,
      accountType: "premium",
    });

    if (existingQuizTaker) {
      return res.status(400).json({
        success: false,
        message: "Premium quiz taker with this email already exists",
      });
    }

    // Generate unique access code
    let accessCode;
    let isUnique = false;

    while (!isUnique) {
      accessCode = QuizTaker.generateAccessCode();
      const existing = await QuizTaker.findOne({ accessCode });
      if (!existing) isUnique = true;
    }

    // Create premium quiz taker
    const quizTaker = new QuizTaker({
      accountType: "premium",
      email,
      name: name || "",
      accessCode,
      questionSetCombination,
    });

    await quizTaker.save();

    res.status(201).json({
      success: true,
      message: "Premium quiz taker created successfully",
      quizTaker: {
        id: quizTaker._id,
        accountType: quizTaker.accountType,
        email: quizTaker.email,
        name: quizTaker.name,
        accessCode: quizTaker.accessCode,
        questionSetCombination: quizTaker.questionSetCombination,
        isActive: quizTaker.isActive,
        createdAt: quizTaker.createdAt,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/admin/quiztakers
// @desc    Get all quiz takers (with filter for account type)
// @access  Private (Admin only)
router.get("/quiztakers", verifyAdmin, async (req, res) => {
  try {
    const { accountType } = req.query;

    const filter = {};
    if (accountType && ["premium", "regular"].includes(accountType)) {
      filter.accountType = accountType;
    }

    const quizTakers = await QuizTaker.find(filter)
      .populate("assignedQuizzes.quizId", "settings.title")
      .populate("questionSetCombination", "title")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: quizTakers.length,
      quizTakers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/admin/quiztaker/:id
// @desc    Get single quiz taker
// @access  Private (Admin only)
router.get("/quiztaker/:id", verifyAdmin, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.params.id)
      .populate(
        "assignedQuizzes.quizId",
        "settings.title settings.isQuizChallenge",
      )
      .populate("assignedQuizzes.submissionId")
      .populate("questionSetCombination", "title");

    if (!quizTaker) {
      return res.status(404).json({
        success: false,
        message: "Quiz taker not found",
      });
    }

    res.json({
      success: true,
      quizTaker,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   PUT /api/admin/quiztaker/:id
// @desc    Update quiz taker
// @access  Private (Admin only)
router.put("/quiztaker/:id", verifyAdmin, async (req, res) => {
  try {
    const { email, name, isActive, questionSetCombination } = req.body;

    const quizTaker = await QuizTaker.findById(req.params.id);

    if (!quizTaker) {
      return res.status(404).json({
        success: false,
        message: "Quiz taker not found",
      });
    }

    // Only allow updating premium accounts
    if (quizTaker.accountType !== "premium") {
      return res.status(400).json({
        success: false,
        message: "Cannot update regular student accounts",
      });
    }

    // Update fields
    if (email) quizTaker.email = email;
    if (name) quizTaker.name = name;
    if (typeof isActive !== "undefined") quizTaker.isActive = isActive;

    if (
      questionSetCombination &&
      Array.isArray(questionSetCombination) &&
      questionSetCombination.length === 4
    ) {
      quizTaker.questionSetCombination = questionSetCombination;
    }

    await quizTaker.save();

    res.json({
      success: true,
      message: "Quiz taker updated successfully",
      quizTaker: {
        id: quizTaker._id,
        accountType: quizTaker.accountType,
        email: quizTaker.email,
        name: quizTaker.name,
        accessCode: quizTaker.accessCode,
        questionSetCombination: quizTaker.questionSetCombination,
        isActive: quizTaker.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   DELETE /api/admin/quiztaker/:id
// @desc    Delete quiz taker
// @access  Private (Admin only)
router.delete("/quiztaker/:id", verifyAdmin, async (req, res) => {
  try {
    const quizTaker = await QuizTaker.findById(req.params.id);

    if (!quizTaker) {
      return res.status(404).json({
        success: false,
        message: "Quiz taker not found",
      });
    }

    await quizTaker.deleteOne();

    res.json({
      success: true,
      message: "Quiz taker deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/admin/assign-quiz
// @desc    Assign quiz to PREMIUM quiz taker(s) - with combination validation
// @access  Private (Admin only)
router.post("/assign-quiz", verifyAdmin, async (req, res) => {
  try {
    const { quizId, quizTakerIds } = req.body;

    // Validation
    if (!quizId || !quizTakerIds || !Array.isArray(quizTakerIds)) {
      return res.status(400).json({
        success: false,
        message: "Please provide quizId and quizTakerIds array",
      });
    }

    // Check if quiz exists
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    const results = {
      success: [],
      failed: [],
    };

    for (const takerId of quizTakerIds) {
      try {
        const quizTaker = await QuizTaker.findById(takerId);

        if (!quizTaker) {
          results.failed.push({ takerId, reason: "Quiz taker not found" });
          continue;
        }

        // Only allow assigning to premium students
        if (quizTaker.accountType !== "premium") {
          results.failed.push({
            takerId,
            reason: "Can only assign quizzes to premium students",
          });
          continue;
        }

        // Validate question set combination match
        const quizCombo = quiz.questionSetCombination
          .map((id) => id.toString())
          .sort();
        const takerCombo = quizTaker.questionSetCombination
          .map((id) => id.toString())
          .sort();

        if (JSON.stringify(quizCombo) !== JSON.stringify(takerCombo)) {
          results.failed.push({
            takerId,
            reason: "Question set combination does not match quiz requirements",
          });
          continue;
        }

        // Initialize assignedQuizzes if it doesn't exist
        if (!quizTaker.assignedQuizzes) {
          quizTaker.assignedQuizzes = [];
        }

        // Check if quiz is already assigned
        const alreadyAssigned = quizTaker.assignedQuizzes.some(
          (aq) => aq.quizId.toString() === quizId,
        );

        if (alreadyAssigned) {
          results.failed.push({ takerId, reason: "Quiz already assigned" });
          continue;
        }

        // Assign quiz
        quizTaker.assignedQuizzes.push({
          quizId,
          status: "pending",
        });

        await quizTaker.save();
        results.success.push({ takerId, email: quizTaker.email });
      } catch (error) {
        results.failed.push({ takerId, reason: error.message });
      }
    }

    res.json({
      success: true,
      message: `Quiz assigned to ${results.success.length} quiz taker(s)`,
      results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   DELETE /api/admin/unassign-quiz
// @desc    Unassign quiz from quiz taker
// @access  Private (Admin only)
router.delete("/unassign-quiz", verifyAdmin, async (req, res) => {
  try {
    const { quizId, quizTakerId } = req.body;

    const quizTaker = await QuizTaker.findById(quizTakerId);

    if (!quizTaker) {
      return res.status(404).json({
        success: false,
        message: "Quiz taker not found",
      });
    }

    if (quizTaker.accountType !== "premium") {
      return res.status(400).json({
        success: false,
        message: "Can only unassign quizzes from premium students",
      });
    }

    // Check if quiz is assigned and not completed
    const assignedQuiz = quizTaker.assignedQuizzes.find(
      (aq) => aq.quizId.toString() === quizId,
    );

    if (!assignedQuiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not assigned to this quiz taker",
      });
    }

    if (assignedQuiz.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Cannot unassign completed quiz",
      });
    }

    // Remove quiz assignment
    quizTaker.assignedQuizzes = quizTaker.assignedQuizzes.filter(
      (aq) => aq.quizId.toString() !== quizId,
    );

    await quizTaker.save();

    res.json({
      success: true,
      message: "Quiz unassigned successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/admin/submissions
// @desc    Get all quiz submissions (with filter for account type)
// @access  Private (Admin only)
router.get("/submissions", verifyAdmin, async (req, res) => {
  try {
    const QuizSubmission = require("../models/QuizSubmission");
    const { accountType } = req.query;

    let submissions = await QuizSubmission.find()
      .populate("quizId", "settings.title settings.isOpenQuiz")
      .populate("quizTakerId", "email name accountType accessCode")
      .sort({ submittedAt: -1 });

    // Filter by account type if specified
    if (accountType && ["premium", "regular"].includes(accountType)) {
      submissions = submissions.filter(
        (sub) => sub.quizTakerId && sub.quizTakerId.accountType === accountType,
      );
    }

    res.json({
      success: true,
      count: submissions.length,
      submissions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/admin/submission/:id
// @desc    Get single submission
// @access  Private (Admin only)
router.get("/submission/:id", verifyAdmin, async (req, res) => {
  try {
    const QuizSubmission = require("../models/QuizSubmission");

    const submission = await QuizSubmission.findById(req.params.id)
      .populate("quizId")
      .populate("quizTakerId", "email name accountType accessCode");

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found",
      });
    }

    res.json({
      success: true,
      submission,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   PUT /api/admin/grade-essay/:submissionId
// @desc    Grade essay questions manually
// @access  Private (Admin only)
router.put("/grade-essay/:submissionId", verifyAdmin, async (req, res) => {
  try {
    const { grades, feedback } = req.body;

    const QuizSubmission = require("../models/QuizSubmission");
    const submission = await QuizSubmission.findById(req.params.submissionId);

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found",
      });
    }

    // Update essay grades
    grades.forEach((grade) => {
      const answer = submission.answers.find(
        (a) => a.questionId.toString() === grade.questionId,
      );
      if (answer && answer.questionType === "essay") {
        answer.pointsAwarded = grade.pointsAwarded;
        answer.isCorrect = grade.pointsAwarded > 0;
      }
    });

    // Recalculate total score
    submission.score = submission.answers.reduce(
      (sum, answer) => sum + answer.pointsAwarded,
      0,
    );

    submission.status = "graded";
    submission.gradedBy = req.admin._id;
    submission.gradedAt = new Date();
    submission.feedback = feedback || "";

    await submission.save();

    res.json({
      success: true,
      message: "Essay graded successfully",
      submission,
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
