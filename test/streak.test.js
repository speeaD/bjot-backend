const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateStreak, lagosDay } = require('../utils/streak');

test('uses Lagos calendar days and counts multiple activities once', () => {
  assert.equal(lagosDay('2026-09-30T23:30:00Z'), '2026-10-01');
  assert.deepEqual(calculateStreak([
    '2026-09-29T23:30:00Z',
    '2026-09-30T08:00:00Z',
    '2026-09-30T23:30:00Z',
    '2026-10-01T12:00:00Z',
  ], '2026-10-01T13:00:00Z'), {
    current: 2, longest: 2, completedToday: true,
    lastActiveDate: '2026-10-01', timezone: 'Africa/Lagos',
  });
});

test('keeps yesterday active until today ends and resets after a missed day', () => {
  const days = ['2026-09-27T12:00:00Z', '2026-09-28T12:00:00Z', '2026-09-30T12:00:00Z'];
  assert.equal(calculateStreak(days, '2026-10-01T12:00:00Z').current, 1);
  assert.equal(calculateStreak(days, '2026-10-02T12:00:00Z').current, 0);
  assert.equal(calculateStreak(days, '2026-10-02T12:00:00Z').longest, 2);
});

test('empty and future activity never creates a streak', () => {
  assert.equal(calculateStreak([], '2026-10-01T12:00:00Z').current, 0);
  assert.equal(calculateStreak(['2026-10-03T12:00:00Z'], '2026-10-01T12:00:00Z').longest, 0);
});
