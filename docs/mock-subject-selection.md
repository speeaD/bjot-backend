# Mock subject selection rollout

New mocks contain a topic-based question snapshot for every active subject configured in the builder. Students choose English plus three subjects before starting. The selection is validated on the server, saved for the attempt, and used for delivery, progress, grading, review, admin submissions, and rankings.

Existing fixed-combination mocks and single-subject exams retain their original delivery rules. The new flag defaults to false. Old public sessions have an empty selected-subject array and continue to use their original full paper. No backfill or conversion of existing exams is required.

Deploy in this order:

1. Apply the additive migration with `npx prisma migrate deploy` in the backend deployment environment. It adds `quizzes.student_selects_subjects` and `public_mock_sessions.selected_question_set_ids`; it does not remove or modify existing results.
2. Deploy the backend with a regenerated Prisma client (`npx prisma generate`). Old clients continue to use fixed mocks.
3. Deploy the student portal, which handles subject selection for assigned and public mocks.
4. Deploy the admin portal, which creates new student-choice mocks by default. Old saved drafts remain fixed unless the admin explicitly changes their mode.

The migration must precede backend deployment because Prisma includes the new columns in model queries. Do not publish student-choice mocks until the student portal is updated. If rolling back, keep the additive columns and deactivate any newly created student-choice mocks before reverting clients. Existing fixed exams are unaffected.

The exam detail page's Edit Exam action opens the same settings and topic builder used for creation. Settings can be saved independently without replacing questions. Before any student selects subjects or starts an attempt, admins can edit the topics and question selections; settings and replacement snapshots are saved together in one transaction. The backend locks the exam and rechecks for assigned subject choices, started assignments, submissions, and public sessions before replacing the paper. Starts and public submissions use the same exam lock. Once a paper is in use, its questions are protected; create another exam for question changes so resumed attempts and past results keep the paper actually taken. Existing exam selection modes cannot be changed by editing.

Subject choices are locked after the attempt starts. Permitted retakes may select a different combination, and each assigned submission saves its own subject order. Public rankings retain the existing first-completed-score rule.

Duration creation and editing preserve explicit zero minutes and seconds. Previously, the creation fallback added 30 minutes when minutes was zero, turning two hours into 150 minutes. Existing stored durations are not guessed or rewritten; admins can correct them through Edit Exam.

Local verification: `node --test test/assigned-quiz.test.js test/mock-subjects.test.js test/quiz-question-selection.test.js test/quiz-editing.test.js test/quiz-duration.test.js test/quiz-duration-routes.test.js test/public-exams-route.test.js test/admin-submissions.test.js`, Prisma schema validation, and TypeScript/lint checks in both portals. Browser checks use local API fixtures with the real UI components. These checks never create live exams or submit student results.
