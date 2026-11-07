const isEnglishSubject = (title) => /^(?:use of english|english(?: language)?)$/.test(String(title).trim().toLowerCase().replace(/\s+/g, ' '));
const selectionError = (message) => Object.assign(new Error(message), { statusCode: 400 });

// Undefined flags on older snapshots/clients deliberately mean fixed subjects.
function selectedSubjects(quiz, values, key = 'questionSetId') {
  const sets = quiz.questionSets;
  if (!Array.isArray(values) || new Set(values).size !== values.length) {
    throw selectionError('Choose different subjects for this exam');
  }
  const selected = values.map((value) => sets.find((set) => set[key] === value));
  if (selected.some((set) => !set)) throw selectionError('A selected subject is not available in this exam');
  if (quiz.studentSelectsSubjects) {
    if (selected.length !== 4 || selected.filter((set) => isEnglishSubject(set.title)).length !== 1) {
      throw selectionError('Choose compulsory English plus exactly three other subjects');
    }
  } else if (selected.length !== sets.length) {
    throw selectionError('Select all subjects included in this exam');
  }
  return selected;
}

function matchesSubjects(quiz, ids) {
  try { selectedSubjects(quiz, ids); return true; } catch { return false; }
}

function sessionSubjects(session) {
  const ids = session.selectedQuestionSetIds;
  // Sessions created before subject selection was introduced used the full paper.
  return session.quiz.studentSelectsSubjects || ids?.length ? selectedSubjects(session.quiz, ids || []) : session.quiz.questionSets;
}

function validateSubjectPool(sets) {
  if (sets.length < 4 || sets.filter((set) => isEnglishSubject(set.title)).length !== 1) {
    throw selectionError('A student-choice mock needs English and at least three other subjects');
  }
}

module.exports = { isEnglishSubject, selectedSubjects, matchesSubjects, sessionSubjects, validateSubjectPool, selectionError };
