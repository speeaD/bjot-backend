-- Add flat, subject-scoped topics without touching legacy batches or questions.
CREATE TABLE "question_set_topics" (
    "id" UUID NOT NULL,
    "question_set_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "question_set_topics_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "questions" ADD COLUMN "topic_id" UUID;

CREATE TABLE "quiz_question_set_topics" (
    "id" UUID NOT NULL,
    "quiz_question_set_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "topic_name" VARCHAR(255) NOT NULL,
    "requested_count" INTEGER NOT NULL,
    "selected_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quiz_question_set_topics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "question_set_topics_question_set_id_name_key"
    ON "question_set_topics"("question_set_id", "name");
CREATE INDEX "question_set_topics_question_set_id_is_active_idx"
    ON "question_set_topics"("question_set_id", "is_active");
CREATE INDEX "questions_topic_id_idx" ON "questions"("topic_id");
CREATE UNIQUE INDEX "quiz_question_set_topics_quiz_question_set_id_topic_id_key"
    ON "quiz_question_set_topics"("quiz_question_set_id", "topic_id");
CREATE INDEX "quiz_question_set_topics_topic_id_idx"
    ON "quiz_question_set_topics"("topic_id");

ALTER TABLE "question_set_topics"
    ADD CONSTRAINT "question_set_topics_question_set_id_fkey"
    FOREIGN KEY ("question_set_id") REFERENCES "question_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "questions"
    ADD CONSTRAINT "questions_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "question_set_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quiz_question_set_topics"
    ADD CONSTRAINT "quiz_question_set_topics_quiz_question_set_id_fkey"
    FOREIGN KEY ("quiz_question_set_id") REFERENCES "quiz_question_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_question_set_topics"
    ADD CONSTRAINT "quiz_question_set_topics_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "question_set_topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
