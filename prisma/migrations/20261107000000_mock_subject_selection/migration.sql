-- Additive only: existing exams keep their fixed subject combinations and
-- existing public sessions continue to use the full original paper.
ALTER TABLE "quizzes" ADD COLUMN "student_selects_subjects" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public_mock_sessions" ADD COLUMN "selected_question_set_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
