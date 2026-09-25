CREATE TABLE "topic_tests" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "question_ids" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "topic_tests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "topic_tests_topic_id_created_at_idx" ON "topic_tests"("topic_id", "created_at");
ALTER TABLE "topic_tests" ADD CONSTRAINT "topic_tests_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "question_set_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
