-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'admin',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_sets" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "question_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "question_set_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB,
    "correct_answer" JSONB,
    "points" INTEGER NOT NULL DEFAULT 1,
    "order_num" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "cover_image" VARCHAR(500),
    "is_quiz_challenge" BOOLEAN NOT NULL DEFAULT false,
    "is_open_quiz" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "instructions" TEXT,
    "duration_hours" INTEGER NOT NULL DEFAULT 0,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "multiple_attempts" BOOLEAN NOT NULL DEFAULT false,
    "loose_focus" BOOLEAN NOT NULL DEFAULT false,
    "view_answer" BOOLEAN NOT NULL DEFAULT true,
    "view_results" BOOLEAN NOT NULL DEFAULT true,
    "display_calculator" BOOLEAN NOT NULL DEFAULT false,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_question_sets" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "question_set_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "order_num" INTEGER NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" UUID NOT NULL,
    "quiz_question_set_id" UUID NOT NULL,
    "original_question_id" UUID,
    "type" VARCHAR(50) NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB,
    "correct_answer" JSONB,
    "points" INTEGER NOT NULL DEFAULT 1,
    "order_num" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_takers" (
    "id" UUID NOT NULL,
    "account_type" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255),
    "email" VARCHAR(255) NOT NULL,
    "access_code" VARCHAR(9),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_takers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_taker_question_sets" (
    "id" UUID NOT NULL,
    "quiz_taker_id" UUID NOT NULL,
    "question_set_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_taker_question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assigned_quizzes" (
    "id" UUID NOT NULL,
    "quiz_taker_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "current_question_set_order" INTEGER,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "assigned_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_set_order" (
    "id" UUID NOT NULL,
    "assigned_quiz_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "order_value" INTEGER NOT NULL,

    CONSTRAINT "question_set_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_set_progress" (
    "id" UUID NOT NULL,
    "assigned_quiz_id" UUID NOT NULL,
    "question_set_order" INTEGER NOT NULL,
    "selected_order" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'not-started',
    "score" INTEGER NOT NULL DEFAULT 0,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "question_set_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_submissions" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "quiz_taker_id" UUID NOT NULL,
    "assigned_quiz_id" UUID,
    "status" VARCHAR(30) NOT NULL DEFAULT 'in-progress',
    "score" INTEGER NOT NULL DEFAULT 0,
    "total_points" INTEGER NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "time_taken" INTEGER NOT NULL,
    "feedback" TEXT,
    "graded_by" UUID,
    "graded_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_answers" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "quiz_question_id" UUID NOT NULL,
    "question_set_order" INTEGER NOT NULL,
    "question_type" VARCHAR(50) NOT NULL,
    "answer" JSONB,
    "is_correct" BOOLEAN,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "points_possible" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_set_submissions" (
    "id" UUID NOT NULL,
    "quiz_submission_id" UUID NOT NULL,
    "question_set_order" INTEGER NOT NULL,
    "order_answered" INTEGER,
    "score" INTEGER NOT NULL DEFAULT 0,
    "total_points" INTEGER NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_set_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_question_set_order" (
    "id" UUID NOT NULL,
    "quiz_submission_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "order_value" INTEGER NOT NULL,

    CONSTRAINT "submission_question_set_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cbt_submissions" (
    "id" UUID NOT NULL,
    "quiz_taker_id" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "time_taken" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cbt_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cbt_question_sets" (
    "id" UUID NOT NULL,
    "cbt_submission_id" UUID NOT NULL,
    "question_set_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "order_num" INTEGER NOT NULL,

    CONSTRAINT "cbt_question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cbt_answers" (
    "id" UUID NOT NULL,
    "cbt_submission_id" UUID NOT NULL,
    "question_id" UUID,
    "question_set_id" UUID,
    "answer" JSONB,
    "is_correct" BOOLEAN,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "points_possible" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cbt_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_taken_history" (
    "id" UUID NOT NULL,
    "quiz_taker_id" UUID NOT NULL,
    "quiz_id" UUID,
    "submission_id" UUID,
    "exam_type" VARCHAR(20),
    "score" INTEGER NOT NULL DEFAULT 0,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "time_taken" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_taken_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_history_question_sets" (
    "id" UUID NOT NULL,
    "quiz_history_id" UUID NOT NULL,
    "question_set_id" UUID,
    "title" VARCHAR(255),

    CONSTRAINT "quiz_history_question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_type" VARCHAR(50) NOT NULL DEFAULT 'scholars-wager',
    "question_set_id" UUID NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "current_score" INTEGER NOT NULL DEFAULT 100,
    "goal_score" INTEGER NOT NULL DEFAULT 1000,
    "questions_answered" INTEGER NOT NULL DEFAULT 0,
    "correct_answers" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "duration" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_used_questions" (
    "id" UUID NOT NULL,
    "game_session_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,

    CONSTRAINT "game_used_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_history" (
    "id" UUID NOT NULL,
    "game_session_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "selected_answer" VARCHAR(500) NOT NULL,
    "correct_answer" JSONB NOT NULL,
    "wager" INTEGER NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "points_change" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_email_idx" ON "admins"("email");

-- CreateIndex
CREATE INDEX "question_sets_is_active_idx" ON "question_sets"("is_active");

-- CreateIndex
CREATE INDEX "question_sets_created_by_idx" ON "question_sets"("created_by");

-- CreateIndex
CREATE INDEX "questions_question_set_id_idx" ON "questions"("question_set_id");

-- CreateIndex
CREATE INDEX "questions_type_idx" ON "questions"("type");

-- CreateIndex
CREATE UNIQUE INDEX "questions_question_set_id_order_num_key" ON "questions"("question_set_id", "order_num");

-- CreateIndex
CREATE INDEX "quizzes_is_active_idx" ON "quizzes"("is_active");

-- CreateIndex
CREATE INDEX "quizzes_is_quiz_challenge_idx" ON "quizzes"("is_quiz_challenge");

-- CreateIndex
CREATE INDEX "quizzes_created_by_idx" ON "quizzes"("created_by");

-- CreateIndex
CREATE INDEX "quiz_question_sets_quiz_id_idx" ON "quiz_question_sets"("quiz_id");

-- CreateIndex
CREATE INDEX "quiz_question_sets_question_set_id_idx" ON "quiz_question_sets"("question_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_question_sets_quiz_id_order_num_key" ON "quiz_question_sets"("quiz_id", "order_num");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_question_sets_quiz_id_question_set_id_key" ON "quiz_question_sets"("quiz_id", "question_set_id");

-- CreateIndex
CREATE INDEX "quiz_questions_quiz_question_set_id_idx" ON "quiz_questions"("quiz_question_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_takers_access_code_key" ON "quiz_takers"("access_code");

-- CreateIndex
CREATE INDEX "quiz_takers_email_account_type_idx" ON "quiz_takers"("email", "account_type");

-- CreateIndex
CREATE INDEX "quiz_taker_question_sets_quiz_taker_id_idx" ON "quiz_taker_question_sets"("quiz_taker_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_taker_question_sets_quiz_taker_id_question_set_id_key" ON "quiz_taker_question_sets"("quiz_taker_id", "question_set_id");

-- CreateIndex
CREATE INDEX "assigned_quizzes_quiz_taker_id_idx" ON "assigned_quizzes"("quiz_taker_id");

-- CreateIndex
CREATE INDEX "assigned_quizzes_status_idx" ON "assigned_quizzes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "assigned_quizzes_quiz_taker_id_quiz_id_key" ON "assigned_quizzes"("quiz_taker_id", "quiz_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_set_order_assigned_quiz_id_position_key" ON "question_set_order"("assigned_quiz_id", "position");

-- CreateIndex
CREATE INDEX "question_set_progress_assigned_quiz_id_idx" ON "question_set_progress"("assigned_quiz_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_set_progress_assigned_quiz_id_question_set_order_key" ON "question_set_progress"("assigned_quiz_id", "question_set_order");

-- CreateIndex
CREATE INDEX "quiz_submissions_quiz_id_idx" ON "quiz_submissions"("quiz_id");

-- CreateIndex
CREATE INDEX "quiz_submissions_quiz_taker_id_idx" ON "quiz_submissions"("quiz_taker_id");

-- CreateIndex
CREATE INDEX "quiz_submissions_status_idx" ON "quiz_submissions"("status");

-- CreateIndex
CREATE INDEX "quiz_submissions_quiz_id_quiz_taker_id_status_idx" ON "quiz_submissions"("quiz_id", "quiz_taker_id", "status");

-- CreateIndex
CREATE INDEX "submission_answers_submission_id_idx" ON "submission_answers"("submission_id");

-- CreateIndex
CREATE INDEX "submission_answers_quiz_question_id_idx" ON "submission_answers"("quiz_question_id");

-- CreateIndex
CREATE INDEX "question_set_submissions_quiz_submission_id_idx" ON "question_set_submissions"("quiz_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_set_submissions_quiz_submission_id_question_set_or_key" ON "question_set_submissions"("quiz_submission_id", "question_set_order");

-- CreateIndex
CREATE UNIQUE INDEX "submission_question_set_order_quiz_submission_id_position_key" ON "submission_question_set_order"("quiz_submission_id", "position");

-- CreateIndex
CREATE INDEX "cbt_submissions_quiz_taker_id_idx" ON "cbt_submissions"("quiz_taker_id");

-- CreateIndex
CREATE INDEX "cbt_question_sets_cbt_submission_id_idx" ON "cbt_question_sets"("cbt_submission_id");

-- CreateIndex
CREATE INDEX "cbt_answers_cbt_submission_id_idx" ON "cbt_answers"("cbt_submission_id");

-- CreateIndex
CREATE INDEX "quiz_taken_history_quiz_taker_id_idx" ON "quiz_taken_history"("quiz_taker_id");

-- CreateIndex
CREATE INDEX "game_sessions_user_id_idx" ON "game_sessions"("user_id");

-- CreateIndex
CREATE INDEX "game_sessions_status_idx" ON "game_sessions"("status");

-- CreateIndex
CREATE INDEX "game_sessions_subject_idx" ON "game_sessions"("subject");

-- CreateIndex
CREATE INDEX "game_used_questions_game_session_id_idx" ON "game_used_questions"("game_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_used_questions_game_session_id_question_id_key" ON "game_used_questions"("game_session_id", "question_id");

-- CreateIndex
CREATE INDEX "game_history_game_session_id_idx" ON "game_history"("game_session_id");

-- AddForeignKey
ALTER TABLE "question_sets" ADD CONSTRAINT "question_sets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_question_set_id_fkey" FOREIGN KEY ("question_set_id") REFERENCES "question_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_question_sets" ADD CONSTRAINT "quiz_question_sets_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_question_sets" ADD CONSTRAINT "quiz_question_sets_question_set_id_fkey" FOREIGN KEY ("question_set_id") REFERENCES "question_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_question_set_id_fkey" FOREIGN KEY ("quiz_question_set_id") REFERENCES "quiz_question_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_original_question_id_fkey" FOREIGN KEY ("original_question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_taker_question_sets" ADD CONSTRAINT "quiz_taker_question_sets_quiz_taker_id_fkey" FOREIGN KEY ("quiz_taker_id") REFERENCES "quiz_takers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_taker_question_sets" ADD CONSTRAINT "quiz_taker_question_sets_question_set_id_fkey" FOREIGN KEY ("question_set_id") REFERENCES "question_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assigned_quizzes" ADD CONSTRAINT "assigned_quizzes_quiz_taker_id_fkey" FOREIGN KEY ("quiz_taker_id") REFERENCES "quiz_takers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assigned_quizzes" ADD CONSTRAINT "assigned_quizzes_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_set_order" ADD CONSTRAINT "question_set_order_assigned_quiz_id_fkey" FOREIGN KEY ("assigned_quiz_id") REFERENCES "assigned_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_set_progress" ADD CONSTRAINT "question_set_progress_assigned_quiz_id_fkey" FOREIGN KEY ("assigned_quiz_id") REFERENCES "assigned_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_quiz_taker_id_fkey" FOREIGN KEY ("quiz_taker_id") REFERENCES "quiz_takers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_assigned_quiz_id_fkey" FOREIGN KEY ("assigned_quiz_id") REFERENCES "assigned_quizzes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_submissions" ADD CONSTRAINT "quiz_submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "quiz_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_quiz_question_id_fkey" FOREIGN KEY ("quiz_question_id") REFERENCES "quiz_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_set_submissions" ADD CONSTRAINT "question_set_submissions_quiz_submission_id_fkey" FOREIGN KEY ("quiz_submission_id") REFERENCES "quiz_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_question_set_order" ADD CONSTRAINT "submission_question_set_order_quiz_submission_id_fkey" FOREIGN KEY ("quiz_submission_id") REFERENCES "quiz_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt_submissions" ADD CONSTRAINT "cbt_submissions_quiz_taker_id_fkey" FOREIGN KEY ("quiz_taker_id") REFERENCES "quiz_takers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt_question_sets" ADD CONSTRAINT "cbt_question_sets_cbt_submission_id_fkey" FOREIGN KEY ("cbt_submission_id") REFERENCES "cbt_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt_question_sets" ADD CONSTRAINT "cbt_question_sets_question_set_id_fkey" FOREIGN KEY ("question_set_id") REFERENCES "question_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt_answers" ADD CONSTRAINT "cbt_answers_cbt_submission_id_fkey" FOREIGN KEY ("cbt_submission_id") REFERENCES "cbt_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt_answers" ADD CONSTRAINT "cbt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_taken_history" ADD CONSTRAINT "quiz_taken_history_quiz_taker_id_fkey" FOREIGN KEY ("quiz_taker_id") REFERENCES "quiz_takers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_taken_history" ADD CONSTRAINT "quiz_taken_history_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_taken_history" ADD CONSTRAINT "quiz_taken_history_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "quiz_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_history_question_sets" ADD CONSTRAINT "quiz_history_question_sets_quiz_history_id_fkey" FOREIGN KEY ("quiz_history_id") REFERENCES "quiz_taken_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "quiz_takers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_question_set_id_fkey" FOREIGN KEY ("question_set_id") REFERENCES "question_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_used_questions" ADD CONSTRAINT "game_used_questions_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_used_questions" ADD CONSTRAINT "game_used_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_history" ADD CONSTRAINT "game_history_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
