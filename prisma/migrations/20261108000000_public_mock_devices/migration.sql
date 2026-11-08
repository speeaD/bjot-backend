-- Existing sessions remain readable and bind to a browser when resumed/submitted.
ALTER TABLE "public_mock_sessions" ADD COLUMN "device_hash" VARCHAR(64);
CREATE INDEX "public_mock_sessions_quiz_id_device_hash_idx" ON "public_mock_sessions"("quiz_id", "device_hash");
