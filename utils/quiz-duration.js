function quizDuration(value) {
  if (value === undefined) return { hours: 0, minutes: 30, seconds: 0 };
  const { hours = 0, minutes = 0, seconds = 0 } = value || {};
  if (![hours, minutes, seconds].every((part) => Number.isSafeInteger(part) && part >= 0) ||
      hours > 23 || minutes > 59 || seconds > 59 || hours * 3600 + minutes * 60 + seconds === 0) {
    throw Object.assign(new Error('Set an exam duration greater than zero using valid hours, minutes and seconds'), { statusCode: 400 });
  }
  return { hours, minutes, seconds };
}

module.exports = { quizDuration };
