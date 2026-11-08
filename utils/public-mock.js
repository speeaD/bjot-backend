const { sessionSubjects } = require('./mock-subjects');
const { orderedQuestions } = require('./question-order');

async function assertPublicMockRetakeAllowed(db, quiz, email, deviceHash) {
  if (quiz.multipleAttempts) return;
  const completed = await db.publicMockSession.findFirst({
    where: { quizId: quiz.id, OR: [{ email }, { deviceHash }], attempt: { isNot: null } },
    select: { id: true, deviceHash: true },
  });
  if (completed) {
    const message = completed.deviceHash === deviceHash
      ? 'This device has already completed this mock. Retakes are disabled by the administrator, including with a different email.'
      : 'You have already completed this mock. Retakes are disabled by the administrator.';
    throw Object.assign(new Error(message), { statusCode: 403 });
  }
}

function assertPublicMockDevice(session, deviceHash) {
  if (session.deviceHash && session.deviceHash !== deviceHash) {
    throw Object.assign(new Error('This attempt is linked to another device. Continue on the browser that started it.'), { statusCode: 403 });
  }
}

function publicMockSubjects(session) {
  return sessionSubjects(session).map((set) => ({ ...set,
    questions: orderedQuestions(set.questions, session.id),
  }));
}

module.exports = { assertPublicMockRetakeAllowed, assertPublicMockDevice, publicMockSubjects };
