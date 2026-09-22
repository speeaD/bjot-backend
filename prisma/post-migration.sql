-- Prisma schema.prisma cannot express a partial unique index.
-- Run this after loading the migrated data, outside a transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_unique_in_progress_submission
  ON quiz_submissions (quiz_id, quiz_taker_id)
  WHERE status = 'in-progress';
