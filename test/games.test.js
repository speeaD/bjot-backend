const test = require('node:test');
const assert = require('node:assert/strict');
const { weeklyWindow, scoreAnswer, buildLeaderboard } = require('../utils/games');
const monday = new Date('2026-09-27T23:00:00.000Z');

test('weekly reset occurs Monday at midnight in Lagos, with an exclusive end', () => {
  assert.equal(weeklyWindow(new Date(monday - 1)).end.toISOString(), monday.toISOString());
  assert.equal(weeklyWindow(monday).start.toISOString(), monday.toISOString());
  assert.equal(weeklyWindow(monday).end.toISOString(), '2026-10-04T23:00:00.000Z');
  assert.equal(weeklyWindow(new Date('2027-01-01T00:00:00Z')).start.toISOString(), '2026-12-27T23:00:00.000Z');
});

test('each game applies its scoring and terminal conditions', () => {
  assert.deepEqual(scoreAnswer({ gameType: 'time-attack', currentScore: 20 }, false), { currentScore: 20, status: 'active', change: 0 });
  assert.deepEqual(scoreAnswer({ gameType: 'time-attack', currentScore: 20 }, true), { currentScore: 30, status: 'active', change: 10 });
  assert.equal(scoreAnswer({ gameType: 'sudden-death', currentScore: 20 }, false).status, 'lost');
  assert.equal(scoreAnswer({ gameType: 'sudden-death', currentScore: 20 }, true).currentScore, 30);
  assert.deepEqual(scoreAnswer({ gameType: 'scholars-wager', currentScore: 100, goalScore: 1000 }, false, 100), { currentScore: 0, status: 'lost', change: -100 });
  assert.equal(scoreAnswer({ gameType: 'scholars-wager', currentScore: 600, goalScore: 1000 }, true, 400).status, 'won');
  for (const wager of [-1, 0, 101, 1.5, NaN, '10', undefined]) assert.throws(() => scoreAnswer({ gameType: 'scholars-wager', currentScore: 100 }, true, wager), /whole number/);
});

test('leaderboard uses best per player per game, sums before limiting, and excludes other weeks/quit/empty rounds', () => {
  const at = new Date('2026-09-29T10:00:00Z');
  const round = (userId, gameType, currentScore, extra = {}) => ({ userId, gameType, currentScore, user: { name: userId }, status: 'completed', completedAt: at, questionsAnswered: 2, ...extra });
  const rows = [round('A', 'time-attack', 20), round('A', 'time-attack', 30), round('B', 'time-attack', 30, { completedAt: new Date(at - 1) }),
    round('A', 'sudden-death', 50), round('C', 'scholars-wager', 70),
    round('A', 'scholars-wager', 1000, { status: 'quit' }), round('D', 'time-attack', 1000, { completedAt: new Date(monday - 1) }),
    round('E', 'time-attack', 1000, { completedAt: weeklyWindow(at).end }), round('F', 'scholars-wager', 100, { questionsAnswered: 0 }),
    round('G', 'sudden-death', 1000, { status: 'active' })];
  const board = buildLeaderboard(rows, 1, at);
  assert.equal(board.games['time-attack'][0].userId, 'B');
  assert.equal(board.overall[0].userId, 'A');
  assert.equal(board.overall[0].totalScore, 80);
  assert.equal(board.overall[0].gamesPlayed, 2);
  assert.deepEqual(board.overall[0].breakdown, { 'time-attack': 30, 'sudden-death': 50, 'scholars-wager': 0 });
  assert.equal(buildLeaderboard(rows, 25, weeklyWindow(at).end).overall.length, 1);
});

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const subjectId = '33333333-3333-4333-8333-333333333333';
const questionId = '44444444-4444-4444-8444-444444444444';
let session, used, histories, lockArgs, nextCalls;
const pool = [0, 1].map(index => ({ id: index ? '55555555-5555-4555-8555-555555555555' : questionId,
  question: 'What is 2 + 2?', type: 'multiple-choice', options: ['3', '4'], correctAnswer: 'B', points: 1, orderNum: index }));
function reset(gameType = 'time-attack') {
  session = { id: sessionId, userId, questionSetId: subjectId, gameType, currentScore: gameType === 'scholars-wager' ? 100 : 0,
    goalScore: 1000, status: 'active', startedAt: new Date(), questionsAnswered: 0, correctAnswers: 0, completedAt: null };
  used = []; histories = []; nextCalls = 0;
}
const db = {
  $queryRaw: async (_strings, ...args) => { lockArgs = args; return args[1] && args[1] !== userId ? [] : [{ id: sessionId }]; },
  $executeRaw: async () => 0,
  gameSession: {
    findUnique: async () => ({ ...session }),
    findFirst: async () => ({ ...session }),
    update: async ({ data }) => { for (const [key, value] of Object.entries(data)) session[key] = value?.increment !== undefined ? session[key] + value.increment : value; return { ...session }; },
  },
  question: { findFirst: async ({ where }) => { nextCalls++; assert.equal(where.questionSetId, subjectId); assert.equal(where.isArchived, false); return pool.find(q => !used.includes(q.id)) || null; } },
  questionSet: { findFirst: async () => ({ id: subjectId, title: 'Maths' }) },
  gameUsedQuestion: { create: async ({ data }) => { used.push(data.questionId); } },
  gameHistory: { create: async ({ data }) => { histories.push(data); } },
};
// Serial transaction stub models the row lock to exercise racing client requests.
let queue = Promise.resolve();
db.$transaction = callback => { const pending = queue.then(() => callback(db)); queue = pending.catch(() => {}); return pending; };
const databasePath = require.resolve('../utils/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
const router = require('../routes/games');
async function call(method, path, body, id = userId) {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]);
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await route.route.stack.at(-1).handle({ params: { id: sessionId }, body, quizTaker: { id }, query: {} }, res);
  return res;
}

test('all game routes are behind the authenticated quiz-taker guard', () => {
  assert.equal(router.stack[0].handle, require('../middleware/auth').verifyQuizTaker);
});

test('session reads hide correct answers and lock using authenticated ownership', async () => {
  reset();
  const response = await call('get', '/sessions/:id');
  assert.equal(response.body.session.question._id, questionId);
  assert.equal('correctAnswer' in response.body.session.question, false);
  assert.deepEqual(lockArgs, [sessionId, userId]);
  const other = await call('get', '/sessions/:id', undefined, subjectId);
  assert.equal(other.statusCode, 404);
});

test('answers are graded on the server, reject duplicates, and complete when questions run out', async () => {
  reset();
  const body = { questionId, answer: '4', score: 99999 };
  const results = await Promise.all([call('post', '/sessions/:id/answer', body), call('post', '/sessions/:id/answer', body)]);
  assert.deepEqual(results.map(r => r.statusCode), [200, 409]);
  assert.equal(session.currentScore, 10);
  assert.equal(histories.length, 1);
  const result = await call('post', '/sessions/:id/answer', { questionId: pool[1].id, answer: '4' });
  assert.equal(result.body.session.status, 'completed');
  assert.equal(session.currentScore, 20);
  assert.ok(session.completedAt);
  await call('post', '/sessions/:id/answer', { questionId, answer: '4' });
  assert.equal(histories.length, 2);
});

test('late answers finalize at the deadline without awarding points', async () => {
  reset(); session.startedAt = new Date(Date.now() - 121000);
  const response = await call('post', '/sessions/:id/answer', { questionId, answer: '4' });
  assert.equal(response.body.session.status, 'completed');
  assert.equal(session.currentScore, 0);
  assert.equal(session.completedAt.getTime(), session.startedAt.getTime() + 120000);
  assert.equal(nextCalls, 0);
  assert.equal(histories.length, 0);
});

test('sudden death stops on an incorrect answer and wager rejects invalid bets without writes', async () => {
  reset('sudden-death');
  const lost = await call('post', '/sessions/:id/answer', { questionId, answer: '3' });
  assert.equal(lost.body.session.status, 'lost');
  assert.equal(lost.body.session.question, null);
  reset('scholars-wager');
  const bad = await call('post', '/sessions/:id/answer', { questionId, answer: '4', wager: 101 });
  assert.equal(bad.statusCode, 400); assert.equal(used.length, 0);
  const good = await call('post', '/sessions/:id/answer', { questionId, answer: '4', wager: 50 });
  assert.equal(good.body.session.currentScore, 150);
});

test('invalid options are rejected, quit is terminal, and starting resumes active rounds', async () => {
  reset();
  assert.equal((await call('post', '/sessions/:id/answer', { questionId, answer: 'fake' })).statusCode, 400);
  const resumed = await call('post', '/start', { gameType: 'time-attack', questionSetId: subjectId });
  assert.equal(resumed.body.resumed, true);
  assert.equal(resumed.body.session.id, sessionId);
  const quit = await call('post', '/sessions/:id/quit', {});
  assert.equal(quit.body.session.status, 'quit');
  await call('post', '/sessions/:id/answer', { questionId, answer: '4' });
  assert.equal(histories.length, 0);
});
