const { createHash } = require('node:crypto');

// A session/attempt seed gives each student a different paper while keeping
// refreshes, subject changes, and retries in the same order. Never mutate snapshots.
function orderedQuestions(questions, seed) {
  return questions.map((question) => ({ question,
    key: createHash('sha256').update(JSON.stringify([seed, question.id])).digest('hex'),
  })).sort((a, b) => a.key.localeCompare(b.key))
    .map(({ question }) => question);
}

module.exports = { orderedQuestions };
