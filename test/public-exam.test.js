const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeQuestions, publicQuestion, validateAnswers, selectedTestQuestions } = require('../utils/public-exam');

const questions = [
  { id: 'q1', type: 'multiple-choice', question: 'Pick B', options: ['A. wrong', 'B. right'], correctAnswer: 'B', points: 2, orderNum: 1 },
  { id: 'q2', type: 'true-false', question: 'True?', correctAnswer: true, points: 1, orderNum: 2 },
  { id: 'q3', type: 'fill-in-the-blanks', question: 'Word?', correctAnswer: 'Physics', points: 3, orderNum: 3 },
];

test('public questions never include correct answers', () => {
  const visible = publicQuestion(questions[0]);
  assert.equal(visible._id, 'q1');
  assert.deepEqual(visible.options, ['A. wrong', 'B. right']);
  assert.equal('correctAnswer' in visible, false);
});

test('server grading handles the current question formats', () => {
  assert.deepEqual(gradeQuestions(questions, [
    { questionId: 'q1', answer: 'B. right' },
    { questionId: 'q2', answer: 'True' },
    { questionId: 'q3', answer: ' physics ' },
  ]), { score: 6, totalPoints: 6, percentage: 100 });
  assert.deepEqual(gradeQuestions(questions, [{ questionId: 'q1', answer: 'A. wrong' }]), { score: 0, totalPoints: 6, percentage: 0 });
});

test('rejects duplicate or foreign answers', () => {
  const allowed = new Set(questions.map((question) => question.id));
  assert.equal(validateAnswers([{ questionId: 'q1', answer: 'B. right' }], allowed), true);
  assert.equal(validateAnswers([{ questionId: 'q1', answer: 'x' }, { questionId: 'q1', answer: 'x' }], allowed), false);
  assert.equal(validateAnswers([{ questionId: 'outside', answer: 'x' }], allowed), false);
});

test('published topic tests retain the chosen question order and fail if a question is no longer available', () => {
  assert.deepEqual(selectedTestQuestions(['q3', 'q1'], questions).map((item) => item.id), ['q3', 'q1']);
  assert.equal(selectedTestQuestions(['q3', 'removed'], questions), null);
});
