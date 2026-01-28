const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
const result = dotenv.config({ path: path.resolve(__dirname, '../.env') });

if (result.error) {
  console.error('Error loading .env file:', result.error);
  // Try loading from current directory as fallback
  dotenv.config();
}

const mongoose = require('mongoose');
const QuizSubmission = require('../models/QuizSubmission');

const DRY_RUN = process.env.DRY_RUN !== 'false';
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

// Validate required environment variables
if (!MONGO_URI) {
  console.error('\n❌ ERROR: MONGO_URI or MONGODB_URI environment variable is not set!');
  console.error('Please ensure your .env file contains MONGO_URI=<your-mongodb-connection-string>\n');
  process.exit(1);
}

const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  success: (msg) => console.log(`[${new Date().toISOString()}] [SUCCESS] ✅ ${msg}`),
  warning: (msg) => console.log(`[${new Date().toISOString()}] [WARNING] ⚠️  ${msg}`),
  error: (msg) => console.log(`[${new Date().toISOString()}] [ERROR] ❌ ${msg}`),
};

async function connectDB() {
  try {
    log.info('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    log.success('Connected to MongoDB');
  } catch (error) {
    log.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
}

async function analyzeAndFixQuestionSets() {
  log.info('\n============================================================');
  log.info('QUESTION SET DUPLICATION ANALYZER & FIXER');
  log.info('============================================================\n');

  if (DRY_RUN) {
    log.warning('⚠️  RUNNING IN DRY RUN MODE - NO CHANGES WILL BE MADE');
  } else {
    log.warning('⚠️  RUNNING IN LIVE MODE - CHANGES WILL BE MADE');
    log.info('   Waiting 3 seconds... Press Ctrl+C to cancel');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  const submissions = await QuizSubmission.find({
    'questionSetSubmissions.0': { $exists: true }
  }).sort({ createdAt: -1 });

  log.info(`\n📊 Analyzing ${submissions.length} submissions...\n`);

  const issues = [];
  let fixed = 0;
  let errors = 0;

  for (const submission of submissions) {
    const qsOrders = submission.questionSetSubmissions.map(qs => qs.questionSetOrder);
    const uniqueOrders = [...new Set(qsOrders)];
    
    const hasDuplicates = qsOrders.length !== uniqueOrders.length;
    const hasTooMany = qsOrders.length > 4;
    const hasWrongOrders = uniqueOrders.some(order => order < 1 || order > 4);

    if (hasDuplicates || hasTooMany || hasWrongOrders) {
      const issue = {
        id: submission._id,
        quizTakerId: submission.quizTakerId,
        status: submission.status,
        totalEntries: qsOrders.length,
        uniqueEntries: uniqueOrders.length,
        orders: qsOrders,
        uniqueOrders: uniqueOrders,
        hasDuplicates,
        hasTooMany,
        hasWrongOrders,
        createdAt: submission.createdAt,
        submittedAt: submission.submittedAt,
      };

      issues.push(issue);

      // Log the issue
      log.warning(`\n📍 Submission: ${submission._id}`);
      log.info(`   Quiz Taker: ${submission.quizTakerId}`);
      log.info(`   Status: ${submission.status}`);
      log.info(`   Created: ${submission.createdAt}`);
      log.info(`   Question Set Orders: [${qsOrders.join(', ')}]`);
      log.info(`   Unique Orders: [${uniqueOrders.join(', ')}]`);
      
      if (hasDuplicates) {
        log.error(`   ❌ HAS DUPLICATES: ${qsOrders.length} entries, ${uniqueOrders.length} unique`);
      }
      if (hasTooMany) {
        log.error(`   ❌ TOO MANY: ${qsOrders.length} entries (expected max 4)`);
      }
      if (hasWrongOrders) {
        log.error(`   ❌ INVALID ORDERS: Contains orders outside 1-4 range`);
      }

      // Show detailed breakdown
      log.info('\n   📋 Question Set Submissions:');
      submission.questionSetSubmissions.forEach((qs, idx) => {
        log.info(`      [${idx + 1}] Order: ${qs.questionSetOrder}, Score: ${qs.score}/${qs.totalPoints}, Submitted: ${qs.submittedAt}`);
      });

      // Attempt to fix
      if (DRY_RUN) {
        log.info('\n   [DRY RUN] Would fix this submission:');
        
        // Show what would be kept
        const seen = new Map();
        const wouldKeep = [];
        
        for (let i = submission.questionSetSubmissions.length - 1; i >= 0; i--) {
          const qs = submission.questionSetSubmissions[i];
          if (!seen.has(qs.questionSetOrder) && qs.questionSetOrder >= 1 && qs.questionSetOrder <= 4) {
            seen.set(qs.questionSetOrder, true);
            wouldKeep.unshift({ index: i, order: qs.questionSetOrder });
          }
        }
        
        log.info(`   Would keep ${wouldKeep.length} question sets:`);
        wouldKeep.forEach(k => {
          log.info(`      Keep index ${k.index}: Order ${k.order}`);
        });
      } else {
        log.info('\n   🔧 Fixing submission...');
        
        try {
          // Keep only unique question sets (keep the latest submission of each)
          const seen = new Map();
          const uniqueQS = [];
          
          // Process in reverse to keep the latest submissions
          for (let i = submission.questionSetSubmissions.length - 1; i >= 0; i--) {
            const qs = submission.questionSetSubmissions[i];
            
            // Only keep valid orders (1-4) and unique
            if (!seen.has(qs.questionSetOrder) && qs.questionSetOrder >= 1 && qs.questionSetOrder <= 4) {
              seen.set(qs.questionSetOrder, true);
              uniqueQS.unshift(qs);
            }
          }

          submission.questionSetSubmissions = uniqueQS;
          
          // Recalculate scores from answers
          const answersByQS = {};
          submission.answers.forEach(ans => {
            if (!answersByQS[ans.questionSetOrder]) {
              answersByQS[ans.questionSetOrder] = [];
            }
            answersByQS[ans.questionSetOrder].push(ans);
          });

          // Update question set scores
          submission.questionSetSubmissions.forEach(qs => {
            const qsAnswers = answersByQS[qs.questionSetOrder] || [];
            const calculatedScore = qsAnswers.reduce((sum, ans) => sum + (ans.pointsAwarded || 0), 0);
            qs.score = calculatedScore;
          });

          // Recalculate total score
          submission.score = submission.answers.reduce(
            (sum, ans) => sum + (ans.pointsAwarded || 0), 
            0
          );

          await submission.save();
          fixed++;
          
          log.success(`   ✅ Fixed: reduced to ${uniqueQS.length} question sets`);
          log.info(`   New orders: [${uniqueQS.map(q => q.questionSetOrder).join(', ')}]`);
          log.info(`   Recalculated score: ${submission.score}/${submission.totalPoints}`);
          
        } catch (error) {
          errors++;
          log.error(`   ❌ Failed to fix: ${error.message}`);
        }
      }
    }
  }

  // Summary
  log.info('\n\n============================================================');
  log.info('SUMMARY');
  log.info('============================================================\n');

  log.info(`Total submissions analyzed: ${submissions.length}`);
  log.info(`Issues found: ${issues.length}`);
  log.info(`  - With duplicates: ${issues.filter(i => i.hasDuplicates).length}`);
  log.info(`  - With >4 entries: ${issues.filter(i => i.hasTooMany).length}`);
  log.info(`  - With invalid orders: ${issues.filter(i => i.hasWrongOrders).length}`);

  if (DRY_RUN) {
    log.warning('\n⚠️  DRY RUN COMPLETE - No changes were made');
    log.info('   Run with DRY_RUN=false to apply fixes');
  } else {
    log.info(`\n✅ Submissions fixed: ${fixed}`);
    log.info(`❌ Errors: ${errors}`);
  }

  // Group by status
  log.info('\n📊 Issues by status:');
  const byStatus = {};
  issues.forEach(i => {
    byStatus[i.status] = (byStatus[i.status] || 0) + 1;
  });
  Object.entries(byStatus).forEach(([status, count]) => {
    log.info(`   ${status}: ${count}`);
  });
}

async function main() {
  try {
    await connectDB();
    await analyzeAndFixQuestionSets();
  } catch (error) {
    log.error(`Script failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    log.info('\n✅ Script completed\n');
  }
}

main();