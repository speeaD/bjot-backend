const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const setIds = [1, 2, 3, 4].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const quizIds = [1, 2].map((n) => `10000000-0000-4000-8000-00000000000${n}`);
const quizzes = quizIds.map((id, index) => ({
  id,
  title: index ? 'New public mock' : 'Old public mock',
  viewResults: true,
  durationHours: 0,
  durationMinutes: 30,
  durationSeconds: 0,
  questionSets: setIds.map((questionSetId, orderNum) => ({
    questionSetId,
    orderNum,
    totalPoints: 1,
    questions: [{ id: `20000000-0000-4000-8000-0000000000${index}${orderNum}`, type: 'multiple-choice', question: 'Question', options: ['A', 'B'], correctAnswer: 'A', points: 1, orderNum: 1 }],
  })),
}));

test('public mocks list exam titles and start the selected exam when subjects overlap', async () => {
  const databasePath = require.resolve('../utils/database');
  const routePath = require.resolve('../routes/public-exams');
  const originalDatabase = require.cache[databasePath];
  const originalRoute = require.cache[routePath];
  const originalLoad = Module._load;
  const handlers = new Map();
  let selectedQuizId;
  require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: {
    quiz: { findMany: async () => quizzes },
    questionSet: {
      findMany: async () => setIds.map((id, index) => ({ id, title: `Subject ${index + 1}` })),
      count: async () => 4,
    },
    publicMockSession: { create: async ({ data }) => { selectedQuizId = data.quizId; return { id: 'session-id' }; } },
  } };
  delete require.cache[routePath];
  Module._load = function(request, parent, isMain) {
    if (request === 'express') return { Router: () => ({
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      post: (path, handler) => handlers.set(`POST ${path}`, handler),
    }) };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require('../routes/public-exams');
    const invoke = async (method, path, body) => {
      const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
      await handlers.get(`${method} ${path}`)({ body }, response);
      return response;
    };
    const listed = (await invoke('GET', '/question-sets')).data;
    assert.deepEqual(listed.mocks.map(({ id, title }) => ({ id, title })), quizIds.map((id, index) => ({ id, title: quizzes[index].title })));
    const response = await invoke('POST', '/mock/sessions', { name: 'Student', email: 'student@example.com', quizId: quizIds[1], questionSetIds: setIds });
    assert.equal(response.statusCode, 201);
    assert.equal(response.data.session.title, 'New public mock');
    assert.equal(selectedQuizId, quizIds[1]);
    const missing = await invoke('POST', '/mock/sessions', { name: 'Student', email: 'student@example.com', quizId: '30000000-0000-4000-8000-000000000001', questionSetIds: setIds });
    assert.equal(missing.statusCode, 404);
    assert.equal(selectedQuizId, quizIds[1]);
  } finally {
    Module._load = originalLoad;
    if (originalDatabase) require.cache[databasePath] = originalDatabase;
    else delete require.cache[databasePath];
    if (originalRoute) require.cache[routePath] = originalRoute;
    else delete require.cache[routePath];
  }
});
