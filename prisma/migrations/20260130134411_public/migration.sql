-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "added_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "batch_number" INTEGER,
ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "tags" JSONB DEFAULT '[]',
ADD COLUMN     "version" VARCHAR(50);

-- CreateIndex
CREATE INDEX "questions_batch_number_idx" ON "questions"("batch_number");

-- CreateIndex
CREATE INDEX "questions_version_idx" ON "questions"("version");

-- CreateIndex
CREATE INDEX "questions_added_date_idx" ON "questions"("added_date");

-- CreateIndex
CREATE INDEX "questions_is_archived_idx" ON "questions"("is_archived");
