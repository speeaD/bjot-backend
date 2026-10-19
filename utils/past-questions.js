const Papa = require('papaparse');

const MAX_ROWS = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const HEADERS = ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Correct Answer', 'Explanation', 'Passage', 'Media URL', 'Media Alt'];
const REQUIRED = HEADERS.slice(0, 7);
const LETTERS = 'ABCDE';
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const key = (value) => clean(value).replace(/\s+/g, ' ').toLocaleLowerCase();
const validMediaUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
};

function validateQuestion(input, row) {
  const errors = [];
  const question = clean(input.question);
  const passage = clean(input.passage);
  const explanation = clean(input.explanation);
  const mediaUrl = clean(input.mediaUrl);
  const mediaAlt = clean(input.mediaAlt);
  const options = Array.isArray(input.options) ? input.options.map(clean) : [];
  const answer = clean(input.correctAnswer);
  if (!question || question.length > 10000) errors.push('Question must contain 1–10,000 characters');
  if (passage.length > 20000) errors.push('Passage exceeds 20,000 characters');
  if (explanation.length > 10000) errors.push('Explanation exceeds 10,000 characters');
  if (mediaUrl && (mediaUrl.length > 500 || !validMediaUrl(mediaUrl))) errors.push('Media URL must be an HTTPS URL of at most 500 characters');
  if (mediaAlt.length > 500 || (mediaUrl && !mediaAlt)) errors.push('Media Alt is required for media and must be at most 500 characters');
  if (options.length < 2 || options.length > 5 || options.some((item) => !item || item.length > 2000))
    errors.push('Provide 2–5 nonempty options, each at most 2,000 characters');
  if (new Set(options.map(key)).size !== options.length) errors.push('Options must be different');
  if (!answer || !options.some((item) => key(item) === key(answer))) errors.push('Correct Answer must match one option');
  return { errors: errors.map((message) => ({ row, message })), question: { question, passage, explanation, options, correctAnswer: answer, mediaUrl: mediaUrl || null, mediaAlt, sourceRow: row } };
}

function parseQuestionCsv(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_FILE_BYTES)
    return { questions: [], errors: [{ row: 0, message: 'Upload a nonempty CSV of at most 5 MB' }] };
  const source = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const parsed = Papa.parse(source, { header: true, skipEmptyLines: 'greedy', dynamicTyping: false, preview: MAX_ROWS + 1 });
  const errors = parsed.errors.map((item) => ({ row: (item.row ?? 0) + 2, message: `CSV: ${item.message}` }));
  const fields = parsed.meta.fields || [];
  for (const name of REQUIRED) if (!fields.includes(name)) errors.push({ row: 1, message: `Missing column: ${name}` });
  for (const name of fields) if (!HEADERS.includes(name)) errors.push({ row: 1, message: `Unknown column: ${name}` });
  if (parsed.data.length < 1 || parsed.data.length > MAX_ROWS)
    errors.push({ row: 0, message: `File must contain 1–${MAX_ROWS} question rows` });
  if (parsed.data.length > MAX_ROWS) return { questions: [], errors };
  const questions = [];
  const seen = new Map();
  for (const [index, raw] of parsed.data.entries()) {
    const row = index + 2;
    const values = LETTERS.split('').map((letter) => clean(raw[`Option ${letter}`]));
    const last = values.findLastIndex(Boolean);
    const options = values.slice(0, last + 1);
    const answerSource = clean(raw['Correct Answer']);
    const match = /^([A-E])(?:\s*(?:[—–:-]\s*|\s+)([\s\S]*))?$/i.exec(answerSource);
    let correctAnswer = '';
    if (!match) errors.push({ row, message: 'Correct Answer must start with A–E, optionally followed by the option text' });
    else {
      const selected = values[LETTERS.indexOf(match[1].toUpperCase())];
      if (!selected) errors.push({ row, message: `Option ${match[1].toUpperCase()} is empty` });
      else if (match[2] && key(match[2]) !== key(selected)) errors.push({ row, message: `Correct Answer text does not match Option ${match[1].toUpperCase()}` });
      correctAnswer = selected;
    }
    const result = validateQuestion({ question: raw.Question, passage: raw.Passage, explanation: raw.Explanation, options, correctAnswer,
      mediaUrl: raw['Media URL'], mediaAlt: raw['Media Alt'] }, row);
    errors.push(...result.errors);
    const duplicateKey = fingerprint(result.question);
    if (seen.has(duplicateKey)) errors.push({ row, message: `Duplicate question (first appears at row ${seen.get(duplicateKey)})` });
    else seen.set(duplicateKey, row);
    questions.push(result.question);
  }
  return { questions, errors };
}

function fingerprint(question) {
  return JSON.stringify([key(question.passage), key(question.question), ...question.options.map(key)]);
}

function publicQuestion(question) {
  return { _id: question.id, type: 'multiple-choice', question: question.question,
    passage: question.passage, diagram: question.mediaUrl || null, diagramAlt: question.mediaAlt || '',
    options: question.options, points: 1, order: question.orderNum };
}

function grade(questions, answers) {
  const review = questions.map((question) => {
    const yourAnswer = answers[question.id] || '';
    const isCorrect = key(yourAnswer) === key(question.correctAnswer);
    return { questionId: question.id, question: question.question, yourAnswer,
      correctAnswer: question.correctAnswer, isCorrect, explanation: question.explanation || '' };
  });
  const score = review.filter((item) => item.isCorrect).length;
  return { score, totalPoints: questions.length, percentage: questions.length ? Math.round(score / questions.length * 10000) / 100 : 0, review };
}

module.exports = { MAX_ROWS, MAX_FILE_BYTES, parseQuestionCsv, validateQuestion, publicQuestion, grade, key, fingerprint };
