const { sessionSubjects } = require('./mock-subjects');
const { orderedQuestions } = require('./question-order');

async function assertPublicMockRetakeAllowed(db, quiz, email) {
  if (quiz.multipleAttempts) return;
  const completed = await db.publicMockSession.findFirst({
    where: { quizId: quiz.id, email, attempt: { isNot: null } },
    select: { id: true },
  });
  if (completed) {
    throw Object.assign(new Error('You have already completed this mock. Retakes are disabled by the administrator.'), { statusCode: 403 });
  }
}

function publicMockSubjects(session) {
  return sessionSubjects(session).map((set) => ({ ...set,
    questions: orderedQuestions(set.questions, session.id),
  }));
}

module.exports = { assertPublicMockRetakeAllowed, publicMockSubjects };
