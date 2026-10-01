const DAY_MS = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

function lagosDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

function previousDay(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

function calculateStreak(timestamps, now = new Date()) {
  const today = lagosDay(now);
  if (!today) throw new Error('Invalid current date');
  const days = [...new Set(timestamps.map(lagosDay).filter((day) => day && day <= today))].sort();
  const activeDays = new Set(days);
  let longest = 0;
  let run = 0;
  let prior = null;
  for (const day of days) {
    run = prior && previousDay(day) === prior ? run + 1 : 1;
    longest = Math.max(longest, run);
    prior = day;
  }
  const completedToday = activeDays.has(today);
  let cursor = completedToday ? today : previousDay(today);
  let current = 0;
  while (activeDays.has(cursor)) {
    current++;
    cursor = previousDay(cursor);
  }
  return { current, longest, completedToday, lastActiveDate: days.at(-1) || null, timezone: 'Africa/Lagos' };
}

module.exports = { calculateStreak, lagosDay };
