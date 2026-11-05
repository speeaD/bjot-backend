const { gradeQuestions } = require('./public-exam');

const publicAttemptInclude = {
  session: { include: { quiz: { include: {
    questionSets: { orderBy: { orderNum: 'asc' }, include: { questions: true } },
  } } } },
};

function publicSubmission(attempt, countsForGrade, includeAnswers = false) {
  const { session } = attempt;
  const quizTakerId = `public:${session.email.trim().toLowerCase()}`;
  const submission = {
    id: attempt.id,
    source: 'public',
    quizId: session.quizId,
    quiz: { id: session.quiz.id, title: session.quiz.title, isOpenQuiz: session.quiz.isOpenQuiz },
    quizTakerId,
    quizTaker: { id: quizTakerId, name: session.name, email: session.email, accountType: 'public', accessCode: null },
    score: attempt.score,
    totalPoints: attempt.totalPoints,
    percentage: Number(attempt.percentage),
    status: 'auto-graded',
    startedAt: session.createdAt,
    submittedAt: attempt.submittedAt,
    timeTaken: Math.max(0, Math.floor((attempt.submittedAt - session.createdAt) / 1000)),
    countsForGrade,
    questionSetSubmissions: session.quiz.questionSets.map((set) => ({
      questionSetOrder: set.orderNum,
      ...gradeQuestions(set.questions, attempt.answers),
      submittedAt: attempt.submittedAt,
    })),
  };
  if (includeAnswers) {
    const answers = new Map(attempt.answers.map((answer) => [answer.questionId, answer.answer]));
    submission.answers = session.quiz.questionSets.flatMap((set) => set.questions.map((question) => {
      const answer = answers.get(question.id) ?? '';
      const { score } = gradeQuestions([question], [{ questionId: question.id, answer }]);
      return { quizQuestionId: question.id, questionSetOrder: set.orderNum, questionType: question.type,
        answer, isCorrect: score === question.points, pointsAwarded: score, pointsPossible: question.points, quizQuestion: question };
    }));
  }
  return submission;
}

async function listAdminSubmissions(db, { accountType, page = '1', limit = '50' } = {}) {
  page = Number(page);
  limit = Number(limit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      !Number.isSafeInteger(page * limit) || (accountType && !['premium', 'regular', 'public'].includes(accountType))) {
    throw Object.assign(new Error('Invalid submission filters or pagination'), { statusCode: 400 });
  }
  const includeAssigned = accountType !== 'public';
  const includePublic = !accountType || accountType === 'public';
  const where = accountType && includeAssigned ? { quizTaker: { accountType } } : {};
  const [assignedTotal, publicTotal] = await Promise.all([
    includeAssigned ? db.quizSubmission.count({ where }) : 0,
    includePublic ? db.publicMockAttempt.count() : 0,
  ]);
  const total = assignedTotal + publicTotal;
  const skip = (page - 1) * limit;
  if (skip >= total) return { success: true, count: 0, total, page, pages: Math.ceil(total / limit), submissions: [] };

  // Take the prefix from each source before merging; independently paginating
  // the sources would skip records or put them on the wrong combined page.
  const orderBy = [{ submittedAt: 'desc' }, { id: 'desc' }];
  const [assigned, publicAttempts] = await Promise.all([
    includeAssigned ? db.quizSubmission.findMany({ where,
      include: { quiz: { select: { id: true, title: true, isOpenQuiz: true } },
        quizTaker: { select: { id: true, email: true, name: true, accountType: true, accessCode: true } },
        questionSetSubmissions: { orderBy: { questionSetOrder: 'asc' } } },
      orderBy, take: Math.min(skip + limit, assignedTotal) }) : [],
    includePublic ? db.publicMockAttempt.findMany({ select: { id: true, submittedAt: true }, orderBy,
      take: Math.min(skip + limit, publicTotal) }) : [],
  ]);
  const rows = [
    ...assigned.map((row) => ({ ...row, source: 'assigned', countsForGrade: row.status !== 'in-progress' })),
    ...publicAttempts.map((row) => ({ ...row, source: 'public' })),
  ].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(skip, skip + limit);
  const publicIds = rows.filter((row) => row.source === 'public').map((row) => row.id);
  // Only load answers for the displayed page, and load each exam paper once
  // rather than repeating hundreds of questions for every public candidate.
  const [grades, details] = publicIds.length ? await Promise.all([
    db.publicMockGrade.findMany({ where: { attemptId: { in: publicIds } }, select: { attemptId: true } }),
    db.publicMockAttempt.findMany({ where: { id: { in: publicIds } }, include: { session: true } }),
  ]) : [[], []];
  const quizIds = [...new Set(details.map((attempt) => attempt.session.quizId))];
  const quizzes = quizIds.length ? await db.quiz.findMany({ where: { id: { in: quizIds } }, select: {
    id: true, title: true, isOpenQuiz: true,
    questionSets: { orderBy: { orderNum: 'asc' }, select: { orderNum: true,
      questions: { select: { id: true, type: true, options: true, correctAnswer: true, points: true } } } },
  } }) : [];
  const byQuiz = new Map(quizzes.map((quiz) => [quiz.id, quiz]));
  const byAttempt = new Map(details.map((attempt) => [attempt.id,
    { ...attempt, session: { ...attempt.session, quiz: byQuiz.get(attempt.session.quizId) } }]));
  const gradedIds = new Set(grades.map((grade) => grade.attemptId));
  return { success: true, count: rows.length, total, page, pages: Math.ceil(total / limit),
    submissions: rows.map((row) => row.source === 'public' ? publicSubmission(byAttempt.get(row.id), gradedIds.has(row.id)) : row) };
}

module.exports = { listAdminSubmissions, publicSubmission, publicAttemptInclude };
