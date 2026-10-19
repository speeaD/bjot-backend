CREATE TABLE "past_papers" (
  "id" UUID NOT NULL,
  "source_exam" VARCHAR(30) NOT NULL DEFAULT 'JAMB',
  "year" INTEGER NOT NULL,
  "subject_id" UUID NOT NULL,
  "subject_title" VARCHAR(255) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "question_count" INTEGER NOT NULL,
  "duration_seconds" INTEGER NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "past_papers_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "past_questions" (
  "id" UUID NOT NULL,
  "paper_id" UUID NOT NULL,
  "order_num" INTEGER NOT NULL,
  "passage" TEXT NOT NULL DEFAULT '',
  "question" TEXT NOT NULL,
  "options" JSONB NOT NULL,
  "correct_answer" TEXT NOT NULL,
  "explanation" TEXT NOT NULL DEFAULT '',
  "media_url" VARCHAR(500),
  "media_alt" VARCHAR(500) NOT NULL DEFAULT '',
  "source_row" INTEGER NOT NULL,
  CONSTRAINT "past_questions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "past_attempts" (
  "id" UUID NOT NULL,
  "quiz_taker_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "paper_snapshot" JSONB NOT NULL,
  "question_snapshot" JSONB NOT NULL,
  "answers" JSONB NOT NULL DEFAULT '{}',
  "score" INTEGER,
  "total_points" INTEGER NOT NULL,
  "duration_seconds" INTEGER NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  CONSTRAINT "past_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "past_papers_source_exam_year_subject_id_version_key" ON "past_papers"("source_exam", "year", "subject_id", "version");
CREATE UNIQUE INDEX "past_papers_one_published_paper" ON "past_papers"("source_exam", "year", "subject_id") WHERE "is_published" = true;
CREATE INDEX "past_papers_source_exam_year_subject_id_is_published_idx" ON "past_papers"("source_exam", "year", "subject_id", "is_published");
CREATE UNIQUE INDEX "past_questions_paper_id_order_num_key" ON "past_questions"("paper_id", "order_num");
CREATE INDEX "past_questions_paper_id_source_row_idx" ON "past_questions"("paper_id", "source_row");
CREATE INDEX "past_attempts_quiz_taker_id_submitted_at_started_at_idx" ON "past_attempts"("quiz_taker_id", "submitted_at", "started_at");
CREATE INDEX "past_attempts_year_started_at_idx" ON "past_attempts"("year", "started_at");
ALTER TABLE "past_papers" ADD CONSTRAINT "past_papers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "past_papers" ADD CONSTRAINT "past_papers_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "question_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "past_questions" ADD CONSTRAINT "past_questions_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "past_papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "past_attempts" ADD CONSTRAINT "past_attempts_quiz_taker_id_fkey" FOREIGN KEY ("quiz_taker_id") REFERENCES "quiz_takers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
