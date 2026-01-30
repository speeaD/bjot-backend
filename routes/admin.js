const express = require("express");
const router = express.Router();
const { verifyAdmin } = require("../middleware/auth");
const prisma = require("../utils/database");
const multer = require("multer");
const XLSX = require("xlsx");
// const { sendAccessCodeEmail } = require("../utils/emailService");


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

// Helper function to generate unique access code
// NOTE: You'll need to implement this based on your original QuizTaker.generateAccessCode() method
// This is a sample implementation
const generateAccessCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excludes similar looking chars
  let code = '';
  for (let i = 0; i < 9; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

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
          // Changed from: QuizTaker.findOne({ email, accountType })
          const existingQuizTaker = await prisma.quizTaker.findFirst({
            where: {
              email,
              accountType,
            }
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
          let questionSetIds = [];
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
            
            // Changed from: QuestionSet.find({ title: { $in: questionSetTitles } })
            const questionSets = await prisma.questionSet.findMany({
              where: {
                title: {
                  in: questionSetTitles
                }
              }
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
            questionSetIds = questionSetTitles.map((title) => {
              const qs = questionSets.find((q) => q.title === title);
              return qs.id;
            });

            // Generate unique access code
            let isUnique = false;
            while (!isUnique) {
              accessCode = generateAccessCode();
              
              // Changed from: QuizTaker.findOne({ accessCode })
              const existing = await prisma.quizTaker.findUnique({
                where: { accessCode }
              });
              
              if (!existing) isUnique = true;
            }
          }

          // Create quiz taker with question sets
          // Changed from: new QuizTaker({ ... }) then quizTaker.save()
          // In Prisma, we need to create the quiz taker and related records in a transaction
          const quizTaker = await prisma.$transaction(async (tx) => {
            // Create the quiz taker
            const newQuizTaker = await tx.quizTaker.create({
              data: {
                accountType,
                email,
                name,
                ...(accountType === "premium" && { accessCode }),
              },
            });

            // If premium, create the question set associations
            if (accountType === "premium" && questionSetIds.length > 0) {
              await tx.quizTakerQuestionSet.createMany({
                data: questionSetIds.map(questionSetId => ({
                  quizTakerId: newQuizTaker.id,
                  questionSetId: questionSetId,
                })),
              });
            }

            return newQuizTaker;
          });

          // Send email to premium students with access code
          // if (accountType === "premium" && accessCode) {
          //   try {
          //     await sendAccessCodeEmail(email, name, accessCode);
          //   } catch (emailError) {
          //     console.error(`Failed to send email to ${email}:`, emailError);
          //     // Don't fail the creation if email fails, just log it
          //   }
          // }

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
      "attachment; filename=quiz-takers-template.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(buffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/admin/quiztaker
// @desc    Create a new quiz taker (single)
// @access  Private (Admin only)
router.post("/quiztaker", verifyAdmin, async (req, res) => {
  try {
    const { email, name, accountType, questionSetIds } = req.body;

    // Validation
    if (!email || !accountType) {
      return res.status(400).json({
        success: false,
        message: "Email and account type are required",
      });
    }

    if (!["premium", "regular"].includes(accountType)) {
      return res.status(400).json({
        success: false,
        message: 'Account type must be "premium" or "regular"',
      });
    }

    // Check for existing quiz taker
    // Changed from: QuizTaker.findOne({ email, accountType })
    const existingQuizTaker = await prisma.quizTaker.findFirst({
      where: {
        email,
        accountType,
      }
    });

    if (existingQuizTaker) {
      return res.status(400).json({
        success: false,
        message: `${accountType} quiz taker with this email already exists`,
      });
    }

    let accessCode = null;

    // Generate access code for premium students
    if (accountType === "premium") {
      let isUnique = false;
      while (!isUnique) {
        accessCode = generateAccessCode();
        
        // Changed from: QuizTaker.findOne({ accessCode })
        const existing = await prisma.quizTaker.findUnique({
          where: { accessCode }
        });
        
        if (!existing) isUnique = true;
      }
    }

    // Create quiz taker with optional question sets
    // Changed from: new QuizTaker({ ... }) then quizTaker.save()
    const quizTaker = await prisma.$transaction(async (tx) => {
      // Create the quiz taker
      const newQuizTaker = await tx.quizTaker.create({
        data: {
          accountType,
          email,
          name: name || null,
          ...(accountType === "premium" && { accessCode }),
        },
      });

      // If question sets provided, create associations
      if (questionSetIds && Array.isArray(questionSetIds) && questionSetIds.length > 0) {
        await tx.quizTakerQuestionSet.createMany({
          data: questionSetIds.map(questionSetId => ({
            quizTakerId: newQuizTaker.id,
            questionSetId: questionSetId,
          })),
          skipDuplicates: true, // Skip if already exists
        });
      }

      // Fetch the complete quiz taker with relations
      return tx.quizTaker.findUnique({
        where: { id: newQuizTaker.id },
        include: {
          questionSets: {
            include: {
              questionSet: {
                select: {
                  id: true,
                  title: true,
                }
              }
            }
          }
        }
      });
    });

    res.status(201).json({
      success: true,
      message: "Quiz taker created successfully",
      quizTaker,
    });
  } catch (error) {
    console.error("Create quiz taker error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   GET /api/admin/quiztakers
// @desc    Get all quiz takers with optional filters
// @access  Private (Admin only)
router.get("/quiztakers", verifyAdmin, async (req, res) => {
  try {
    const { accountType, search, page = 1, limit = 50 } = req.query;

    // Build where clause
    const where = {};
    
    if (accountType && ["premium", "regular"].includes(accountType)) {
      where.accountType = accountType;
    }

    if (search) {
      // Changed from: MongoDB $regex to Prisma contains (case-insensitive)
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        ...(accountType === "premium" ? [{ accessCode: { contains: search, mode: 'insensitive' } }] : [])
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Changed from: QuizTaker.find().populate()
    const [quizTakers, total] = await Promise.all([
      prisma.quizTaker.findMany({
        where,
        include: {
          questionSets: {
            include: {
              questionSet: {
                select: {
                  id: true,
                  title: true,
                }
              }
            }
          },
          assignedQuizzes: {
            include: {
              quiz: {
                select: {
                  id: true,
                  title: true,
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: parseInt(limit),
      }),
      prisma.quizTaker.count({ where })
    ]);

    res.json({
      success: true,
      count: quizTakers.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      quizTakers,
    });
  } catch (error) {
    console.error("Get quiz takers error:", error);
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
    // Changed from: QuizTaker.findById(req.params.id).populate()
    const quizTaker = await prisma.quizTaker.findUnique({
      where: { id: req.params.id },
      include: {
        questionSets: {
          include: {
            questionSet: true
          }
        },
        assignedQuizzes: {
          include: {
            quiz: true,
            questionSetProgress: true,
          }
        },
        submissions: {
          include: {
            quiz: {
              select: {
                id: true,
                title: true,
              }
            }
          },
          orderBy: {
            submittedAt: 'desc'
          },
          take: 10, // Get last 10 submissions
        }
      }
    });

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
    console.error("Get quiz taker error:", error);
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
    const { email, name, isActive, questionSetIds } = req.body;

    // Check if quiz taker exists
    // Changed from: QuizTaker.findById(req.params.id)
    const existingQuizTaker = await prisma.quizTaker.findUnique({
      where: { id: req.params.id }
    });

    if (!existingQuizTaker) {
      return res.status(404).json({
        success: false,
        message: "Quiz taker not found",
      });
    }

    // If email is being changed, check it's not taken
    if (email && email !== existingQuizTaker.email) {
      const emailTaken = await prisma.quizTaker.findFirst({
        where: {
          email,
          accountType: existingQuizTaker.accountType,
          NOT: {
            id: req.params.id
          }
        }
      });

      if (emailTaken) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another quiz taker",
        });
      }
    }

    // Update quiz taker
    // Changed from: QuizTaker.findByIdAndUpdate()
    const quizTaker = await prisma.$transaction(async (tx) => {
      // Update basic fields
      const updated = await tx.quizTaker.update({
        where: { id: req.params.id },
        data: {
          ...(email && { email }),
          ...(name !== undefined && { name }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      // If question sets provided, update them
      if (questionSetIds && Array.isArray(questionSetIds)) {
        // Delete existing question set associations
        await tx.quizTakerQuestionSet.deleteMany({
          where: { quizTakerId: req.params.id }
        });

        // Create new associations
        if (questionSetIds.length > 0) {
          await tx.quizTakerQuestionSet.createMany({
            data: questionSetIds.map(questionSetId => ({
              quizTakerId: req.params.id,
              questionSetId: questionSetId,
            })),
          });
        }
      }

      // Fetch updated quiz taker with relations
      return tx.quizTaker.findUnique({
        where: { id: req.params.id },
        include: {
          questionSets: {
            include: {
              questionSet: {
                select: {
                  id: true,
                  title: true,
                }
              }
            }
          }
        }
      });
    });

    res.json({
      success: true,
      message: "Quiz taker updated successfully",
      quizTaker,
    });
  } catch (error) {
    console.error("Update quiz taker error:", error);
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
    // Check if quiz taker exists
    // Changed from: QuizTaker.findById(req.params.id)
    const quizTaker = await prisma.quizTaker.findUnique({
      where: { id: req.params.id }
    });

    if (!quizTaker) {
      return res.status(404).json({
        success: false,
        message: "Quiz taker not found",
      });
    }

    // Delete quiz taker (cascade will handle related records)
    // Changed from: QuizTaker.findByIdAndDelete()
    await prisma.quizTaker.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: "Quiz taker deleted successfully",
    });
  } catch (error) {
    console.error("Delete quiz taker error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// @route   POST /api/admin/quiztakers/assign
// @desc    Assign quiz to multiple quiz takers (bulk operation)
// @access  Private (Admin only)
router.post("/quiztakers/assign", verifyAdmin, async (req, res) => {
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
    // Changed from: Quiz.findById(quizId)
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId }
    });

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
        // Changed from: QuizTaker.findById(takerId)
        const quizTaker = await prisma.quizTaker.findUnique({
          where: { id: takerId },
          include: {
            assignedQuizzes: true
          }
        });

        if (!quizTaker) {
          results.failed.push({ takerId, reason: "Quiz taker not found" });
          continue;
        }

        // Only allow assigning to premium students
        if (quizTaker.accountType !== "premium") {
          results.failed.push({
            takerId,
            email: quizTaker.email,
            reason: "Can only assign quizzes to premium students",
          });
          continue;
        }

        // Check if quiz is already assigned
        // Changed from checking array with .some()
        const alreadyAssigned = quizTaker.assignedQuizzes.some(
          (aq) => aq.quizId === quizId
        );

        if (alreadyAssigned) {
          results.failed.push({ takerId, reason: "Quiz already assigned" });
          continue;
        }

        // Assign quiz
        // Changed from: pushing to array then save()
        await prisma.assignedQuiz.create({
          data: {
            quizTakerId: takerId,
            quizId: quizId,
            status: "pending",
          }
        });

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

// @route   POST /api/admin/quiztakers/unassign
// @desc    Unassign quiz from multiple quiz takers (bulk operation)
// @access  Private (Admin only)
router.post("/quiztakers/unassign", verifyAdmin, async (req, res) => {
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
    // Changed from: Quiz.findById(quizId)
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId }
    });

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
        // Changed from: QuizTaker.findById(takerId)
        const quizTaker = await prisma.quizTaker.findUnique({
          where: { id: takerId },
          include: {
            assignedQuizzes: {
              where: {
                quizId: quizId
              }
            }
          }
        });

        if (!quizTaker) {
          results.failed.push({ 
            quizTakerId: takerId, 
            reason: "Quiz taker not found" 
          });
          continue;
        }

        // Only allow unassigning from premium students
        if (quizTaker.accountType !== "premium") {
          results.failed.push({
            quizTakerId: takerId,
            email: quizTaker.email,
            reason: "Can only unassign quizzes from premium students",
          });
          continue;
        }

        // Check if quiz is assigned
        const assignedQuiz = quizTaker.assignedQuizzes[0];

        if (!assignedQuiz) {
          results.failed.push({
            quizTakerId: takerId,
            email: quizTaker.email,
            reason: "Quiz not assigned to this quiz taker",
          });
          continue;
        }

        // Check if quiz is completed
        if (assignedQuiz.status === "completed") {
          results.failed.push({
            quizTakerId: takerId,
            email: quizTaker.email,
            reason: "Cannot unassign completed quiz",
          });
          continue;
        }

        // Remove quiz assignment
        // Changed from: splicing array then save()
        await prisma.assignedQuiz.delete({
          where: {
            id: assignedQuiz.id
          }
        });
        
        results.success.push({ 
          quizTakerId: takerId, 
          email: quizTaker.email 
        });
      } catch (error) {
        results.failed.push({ 
          quizTakerId: takerId, 
          reason: error.message 
        });
      }
    }

    res.json({
      success: true,
      message: `Quiz unassigned from ${results.success.length} quiz taker(s)`,
      results,
    });
  } catch (error) {
    console.error("Unassign quiz error:", error);
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
    const { accountType, page = 1, limit = 50 } = req.query;

    // Build where clause
    const where = {};
    
    if (accountType && ["premium", "regular"].includes(accountType)) {
      where.quizTaker = {
        accountType: accountType
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Changed from: QuizSubmission.find().populate()
    const [submissions, total] = await Promise.all([
      prisma.quizSubmission.findMany({
        where,
        include: {
          quiz: {
            select: {
              id: true,
              title: true,
              isOpenQuiz: true,
            }
          },
          quizTaker: {
            select: {
              id: true,
              email: true,
              name: true,
              accountType: true,
              accessCode: true,
            }
          }
        },
        orderBy: {
          submittedAt: 'desc'
        },
        skip,
        take: parseInt(limit),
      }),
      prisma.quizSubmission.count({ where })
    ]);

    res.json({
      success: true,
      count: submissions.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      submissions,
    });
  } catch (error) {
    console.error("Get submissions error:", error);
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
    // Changed from: QuizSubmission.findById(req.params.id).populate()
    const submission = await prisma.quizSubmission.findUnique({
      where: { id: req.params.id },
      include: {
        quiz: true,
        quizTaker: {
          select: {
            id: true,
            email: true,
            name: true,
            accountType: true,
            accessCode: true,
          }
        },
        answers: {
          include: {
            quizQuestion: true
          }
        },
        questionSetSubmissions: {
          orderBy: {
            questionSetOrder: 'asc'
          }
        }
      }
    });

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
    console.error("Get submission error:", error);
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

    // Changed from: QuizSubmission.findById()
    const submission = await prisma.quizSubmission.findUnique({
      where: { id: req.params.submissionId },
      include: {
        answers: true
      }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found",
      });
    }

    // Update essay grades using transaction
    // Changed from: updating embedded documents
    const updatedSubmission = await prisma.$transaction(async (tx) => {
      // Update each answer
      for (const grade of grades) {
        const answer = submission.answers.find(
          (a) => a.quizQuestionId === grade.questionId
        );
        
        if (answer && answer.questionType === "essay") {
          await tx.submissionAnswer.update({
            where: { id: answer.id },
            data: {
              pointsAwarded: grade.pointsAwarded,
              isCorrect: grade.pointsAwarded > 0,
            }
          });
        }
      }

      // Recalculate total score
      const updatedAnswers = await tx.submissionAnswer.findMany({
        where: { submissionId: req.params.submissionId }
      });

      const totalScore = updatedAnswers.reduce(
        (sum, answer) => sum + answer.pointsAwarded,
        0
      );

      // Calculate percentage
      const percentage = submission.totalPoints > 0 
        ? (totalScore / submission.totalPoints) * 100 
        : 0;

      // Update submission
      return tx.quizSubmission.update({
        where: { id: req.params.submissionId },
        data: {
          score: totalScore,
          percentage: percentage,
          status: "graded",
          gradedById: req.admin.id, // From verifyAdmin middleware
          gradedAt: new Date(),
          feedback: feedback || "",
        },
        include: {
          answers: {
            include: {
              quizQuestion: true
            }
          },
          quizTaker: {
            select: {
              id: true,
              email: true,
              name: true,
            }
          }
        }
      });
    });

    res.json({
      success: true,
      message: "Essay graded successfully",
      submission: updatedSubmission,
    });
  } catch (error) {
    console.error("Grade essay error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;