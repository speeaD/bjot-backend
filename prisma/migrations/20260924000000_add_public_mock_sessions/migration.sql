CREATE TABLE "public_mock_sessions" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_mock_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "public_mock_sessions_quiz_id_email_idx" ON "public_mock_sessions"("quiz_id", "email");
ALTER TABLE "public_mock_sessions" ADD CONSTRAINT "public_mock_sessions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "public_mock_attempts" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "total_points" INTEGER NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "answers" JSONB NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_mock_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "public_mock_attempts_session_id_key" ON "public_mock_attempts"("session_id");
ALTER TABLE "public_mock_attempts" ADD CONSTRAINT "public_mock_attempts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public_mock_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public_mock_grades" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "attempt_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "total_points" INTEGER NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_mock_grades_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "public_mock_grades_quiz_id_email_key" ON "public_mock_grades"("quiz_id", "email");
CREATE UNIQUE INDEX "public_mock_grades_attempt_id_key" ON "public_mock_grades"("attempt_id");
