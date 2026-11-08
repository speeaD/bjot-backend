const { createHash } = require('node:crypto');

const transactionOptions = Object.freeze({ maxWait: 10_000, timeout: 20_000 });

function identityKey(quizId, kind, value) {
  return createHash('sha256').update(JSON.stringify(['public-mock', quizId, kind, value]))
    .digest().readBigInt64BE(0);
}

function publicMockTransaction(db, { quizId, email, deviceHash }, run) {
  return db.$transaction(async (tx) => {
    // Readers can start/submit together. Question replacement still takes the
    // conflicting FOR UPDATE lock in quiz-editing, so the paper stays protected.
    await tx.$queryRaw`SELECT id FROM quizzes WHERE id = ${quizId}::uuid FOR SHARE`;
    const keys = [identityKey(quizId, 'email', email), identityKey(quizId, 'device', deviceHash)]
      .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    // Lock both identities, in a consistent order, across all public writers.
    // Transaction locks are released on commit/rollback, including with pooling.
    for (const key of keys) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text AS locked`;
    }
    return run(tx);
  }, transactionOptions);
}

function isPublicMockBusyError(error) {
  return ['P2028', 'P2024', 'P2034'].includes(error.code);
}

module.exports = { publicMockTransaction, isPublicMockBusyError };
