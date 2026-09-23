-- Editable landing-page content, managed through the admin API.

CREATE TABLE "landing_page_sections" (
  "id" UUID NOT NULL,
  "page" VARCHAR(50) NOT NULL DEFAULT 'home',
  "key" VARCHAR(100) NOT NULL,
  "label" VARCHAR(255) NOT NULL,
  "content" JSONB NOT NULL,
  "is_visible" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "landing_page_sections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_members" (
  "id" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "role" VARCHAR(255),
  "course" VARCHAR(255),
  "bio" TEXT,
  "image_url" VARCHAR(500),
  "social_links" JSONB,
  "is_visible" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "testimonials" (
  "id" UUID NOT NULL,
  "type" VARCHAR(20) NOT NULL DEFAULT 'written',
  "student_name" VARCHAR(255) NOT NULL,
  "quote" TEXT NOT NULL,
  "score" VARCHAR(50),
  "course" VARCHAR(255),
  "school" VARCHAR(255),
  "image_url" VARCHAR(500),
  "video_url" VARCHAR(500),
  "video_duration" VARCHAR(20),
  "is_verified" BOOLEAN NOT NULL DEFAULT false,
  "is_visible" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "landing_page_contact" (
  "id" VARCHAR(50) NOT NULL DEFAULT 'default',
  "email" VARCHAR(255),
  "phone" VARCHAR(50),
  "whatsapp" VARCHAR(50),
  "website" VARCHAR(500),
  "youtube" VARCHAR(500),
  "address" VARCHAR(500),
  "social_links" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "landing_page_contact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "landing_page_sections_key_key" ON "landing_page_sections"("key");
CREATE INDEX "landing_page_sections_page_is_visible_display_order_idx" ON "landing_page_sections"("page", "is_visible", "display_order");
CREATE INDEX "staff_members_is_visible_display_order_idx" ON "staff_members"("is_visible", "display_order");
CREATE INDEX "testimonials_type_is_visible_display_order_idx" ON "testimonials"("type", "is_visible", "display_order");
