async function lockQuiz(tx, quizId) {
  await tx.$queryRaw`SELECT id FROM quizzes WHERE id = ${quizId}::uuid FOR UPDATE`;
}

async function canEditQuestions(db, quizId) {
  const counts = await Promise.all([
    db.assignedQuiz.count({ where: { quizId, status: { not: 'pending' } } }),
    db.quizSubmission.count({ where: { quizId } }),
    db.publicMockSession.count({ where: { quizId } }),
    db.questionSetOrder.count({ where: { assignedQuiz: { quizId } } }),
  ]);
  return counts.every((count) => count === 0);
}

module.exports = { lockQuiz, canEditQuestions };
