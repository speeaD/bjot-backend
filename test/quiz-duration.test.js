const test = require('node:test');
const assert = require('node:assert/strict');
const { quizDuration } = require('../utils/quiz-duration');

test('explicit zero minutes stay zero and partial durations do not inherit thirty extra minutes', () => {
  assert.deepEqual(quizDuration({ hours: 2, minutes: 0, seconds: 0 }), { hours: 2, minutes: 0, seconds: 0 });
  assert.deepEqual(quizDuration({ hours: 1 }), { hours: 1, minutes: 0, seconds: 0 });
  assert.deepEqual(quizDuration({ minutes: 45 }), { hours: 0, minutes: 45, seconds: 0 });
  assert.deepEqual(quizDuration({ seconds: 30 }), { hours: 0, minutes: 0, seconds: 30 });
  assert.deepEqual(quizDuration(), { hours: 0, minutes: 30, seconds: 0 });
});

test('invalid durations fail before an exam is created or saved', () => {
  for (const duration of [null, {}, { hours: 0, minutes: 0, seconds: 0 }, { minutes: -1 }, { minutes: 60 }, { hours: 24 }, { seconds: 0.5 }, { minutes: '30' }]) {
    assert.throws(() => quizDuration(duration), { statusCode: 400 });
  }
});
