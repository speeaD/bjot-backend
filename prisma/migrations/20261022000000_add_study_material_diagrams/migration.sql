ALTER TABLE "study_materials"
  ADD COLUMN "diagram_url" VARCHAR(500),
  ADD COLUMN "diagram_alt" VARCHAR(500) NOT NULL DEFAULT '';
