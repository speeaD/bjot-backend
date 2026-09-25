const AUTO_GRADED_TYPES = new Set(['multiple-choice', 'true-false', 'fill-in-the-blank', 'fill-in-the-blanks']);

function optionsFor(question) {
  if (question.type === 'true-false') return ['True', 'False'];
  if (Array.isArray(question.options)) return question.options.map(String);
  if (typeof question.options === 'string') return question.options.split('|').map((item) => item.trim()).filter(Boolean);
  if (question.options && typeof question.options === 'object') return Object.values(question.options).map(String);
  return [];
}

function publicQuestion(question) {
  return {
    _id: question.id,
    type: question.type,
    question: question.question,
    passage: question.passage || '',
    diagram: question.diagram || null,
    diagramAlt: question.diagramAlt || '',
    options: optionsFor(question),
    points: question.points,
    order: question.orderNum,
  };
}

function normalized(value) { return String(value ?? '').trim().toLowerCase(); }

function isCorrect(question, answer) {
  if (answer === null || answer === undefined || normalized(answer) === '') return false;
  const expected = question.correctAnswer;
  if (question.type === 'multiple-choice') {
    const options = optionsFor(question);
    const letter = normalized(expected);
    if (/^[a-z]$/.test(letter)) {
      const option = options[letter.charCodeAt(0) - 97];
      return !!option && normalized(answer) === normalized(option);
    }
    return normalized(answer) === normalized(expected);
  }
  if (question.type === 'true-false') return normalized(answer) === normalized(expected);
  if (question.type === 'fill-in-the-blank' || question.type === 'fill-in-the-blanks') return normalized(answer) === normalized(expected);
  return false;
}

function gradeQuestions(questions, answers) {
  const answerMap = new Map(answers.map(({ questionId, answer }) => [questionId, answer]));
  const totalPoints = questions.reduce((sum, question) => sum + question.points, 0);
  const score = questions.reduce((sum, question) => sum + (isCorrect(question, answerMap.get(question.id)) ? question.points : 0), 0);
  return { score, totalPoints, percentage: totalPoints ? Math.round(score / totalPoints * 10000) / 100 : 0 };
}

function validateAnswers(answers, questionIds) {
  if (!Array.isArray(answers) || answers.length > questionIds.size || answers.length > 500) return false;
  const seen = new Set();
  return answers.every((item) => item && typeof item.questionId === 'string' && questionIds.has(item.questionId) &&
    !seen.has(item.questionId) && (seen.add(item.questionId), true) && typeof item.answer === 'string' && item.answer.length <= 1000);
}

module.exports = { AUTO_GRADED_TYPES, publicQuestion, gradeQuestions, validateAnswers };
