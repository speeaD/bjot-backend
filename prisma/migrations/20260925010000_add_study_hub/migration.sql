CREATE TABLE "study_materials" (
  "id" UUID NOT NULL,
  "topic_id" UUID NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "content" TEXT NOT NULL,
  "alt_text" VARCHAR(500) NOT NULL DEFAULT '',
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "study_materials_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "study_materials_topic_id_is_published_display_order_idx" ON "study_materials"("topic_id", "is_published", "display_order");
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "question_set_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "study_attempts" (
  "id" UUID NOT NULL,
  "topic_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "question_ids" JSONB NOT NULL,
  "question_snapshot" JSONB NOT NULL,
  "answers" JSONB,
  "score" INTEGER,
  "total_points" INTEGER,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  CONSTRAINT "study_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "study_attempts_student_id_started_at_idx" ON "study_attempts"("student_id", "started_at");
CREATE INDEX "study_attempts_topic_id_started_at_idx" ON "study_attempts"("topic_id", "started_at");
ALTER TABLE "study_attempts" ADD CONSTRAINT "study_attempts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "question_set_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_attempts" ADD CONSTRAINT "study_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "quiz_takers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
