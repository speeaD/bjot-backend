ALTER TABLE "quiz_takers"
  ADD COLUMN "subscription_plan_id" VARCHAR(100),
  ADD COLUMN "subscription_level" VARCHAR(20),
  ADD COLUMN "subscription_expires_at" TIMESTAMP(3);
CREATE TABLE "payments" (
  "id" UUID NOT NULL,
  "reference" VARCHAR(100) NOT NULL,
  "checkout_id" VARCHAR(100),
  "quiz_taker_id" UUID NOT NULL,
  "plan_id" VARCHAR(100) NOT NULL,
  "plan_level" VARCHAR(20) NOT NULL,
  "months" INTEGER,
  "fixed_expires_at" TIMESTAMP(3),
  "amount" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN',
  "email" VARCHAR(255) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "authorization_url" TEXT,
  "paid_at" TIMESTAMP(3),
  "fulfilled_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_quiz_taker_id_fkey" FOREIGN KEY ("quiz_taker_id") REFERENCES "quiz_takers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payments_duration_check" CHECK (("months" BETWEEN 1 AND 3 AND "fixed_expires_at" IS NULL) OR ("months" IS NULL AND "fixed_expires_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");
CREATE INDEX "payments_quiz_taker_id_created_at_idx" ON "payments"("quiz_taker_id", "created_at");
CREATE UNIQUE INDEX "payments_checkout_id_key" ON "payments"("checkout_id");
