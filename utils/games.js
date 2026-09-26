const GAME_IDS = ['time-attack', 'sudden-death', 'scholars-wager'];
const TIME_ATTACK_SECONDS = 120;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

function weeklyWindow(now = new Date()) {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  const start = new Date(local.getTime() - LAGOS_OFFSET_MS);
  return { start, end: new Date(start.getTime() + WEEK_MS), timeZone: 'Africa/Lagos' };
}

function scoreAnswer(session, correct, wager) {
  if (session.gameType === 'scholars-wager' && (!Number.isInteger(wager) || wager < 1 || wager > session.currentScore)) {
    throw Object.assign(new Error('Wager must be a whole number between 1 and your current score'), { status: 400 });
  }
  const change = session.gameType === 'scholars-wager' ? (correct ? wager : -wager) : (correct ? 10 : 0);
  const currentScore = session.currentScore + change;
  let status = 'active';
  if (session.gameType === 'sudden-death' && !correct) status = 'lost';
  if (session.gameType === 'scholars-wager') {
    if (currentScore <= 0) status = 'lost';
    else if (currentScore >= session.goalScore) status = 'won';
  }
  return { currentScore, status, change };
}

function buildLeaderboard(sessions, limit = 25, now = new Date(), viewerId = null) {
  const week = weeklyWindow(now);
  const best = new Map();
  for (const session of sessions) {
    if (!GAME_IDS.includes(session.gameType) || session.status === 'active' || session.status === 'quit' ||
        !session.completedAt || session.completedAt < week.start || session.completedAt >= week.end || !session.questionsAnswered) continue;
    const key = `${session.userId}:${session.gameType}`;
    const previous = best.get(key);
    if (!previous || session.currentScore > previous.currentScore ||
        (session.currentScore === previous.currentScore && session.completedAt < previous.completedAt)) best.set(key, session);
  }
  const games = Object.fromEntries(GAME_IDS.map(id => [id, []]));
  const overallByUser = new Map();
  for (const session of best.values()) {
    const displayName = session.user.name?.trim() || 'BJOT Scholar';
    games[session.gameType].push({ userId: session.userId, displayName, department: session.user.department || null,
      score: session.currentScore, achievedAt: session.completedAt.toISOString(),
      correctAnswers: session.correctAnswers ?? null, questionsAnswered: session.questionsAnswered,
      accuracy: Number.isInteger(session.correctAnswers) ? Math.round(session.correctAnswers / session.questionsAnswered * 1000) / 10 : null,
      averageSeconds: session.duration != null ? Math.round(session.duration / session.questionsAnswered * 10) / 10 : null });
    let entry = overallByUser.get(session.userId);
    if (!entry) {
      entry = { userId: session.userId, displayName, department: session.user.department || null, totalScore: 0, gamesPlayed: 0, breakdown: Object.fromEntries(GAME_IDS.map(id => [id, 0])), achievedAt: '' };
      overallByUser.set(session.userId, entry);
    }
    entry.breakdown[session.gameType] = session.currentScore;
    entry.totalScore += session.currentScore;
    entry.gamesPlayed++;
    entry.achievedAt = [entry.achievedAt, session.completedAt.toISOString()].sort().at(-1);
  }
  const rank = (entries, score) => entries.sort((a, b) => b[score] - a[score] || a.achievedAt.localeCompare(b.achievedAt) || a.userId.localeCompare(b.userId))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  for (const id of GAME_IDS) games[id] = rank(games[id], 'score');
  const overall = rank([...overallByUser.values()], 'totalScore');
  const totalPlayers = { overall: overall.length, ...Object.fromEntries(GAME_IDS.map(id => [id, games[id].length])) };
  const viewer = { userId: viewerId, overall: overall.find(entry => entry.userId === viewerId) || null,
    games: Object.fromEntries(GAME_IDS.map(id => [id, games[id].find(entry => entry.userId === viewerId) || null])) };
  for (const id of GAME_IDS) games[id] = games[id].slice(0, limit);
  return { games, overall: overall.slice(0, limit), totalPlayers, viewer, week: { startsAt: week.start.toISOString(), endsAt: week.end.toISOString(), timeZone: week.timeZone }, generatedAt: now.toISOString() };
}

module.exports = { GAME_IDS, TIME_ATTACK_SECONDS, weeklyWindow, scoreAnswer, buildLeaderboard };
