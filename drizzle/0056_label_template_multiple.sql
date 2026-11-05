-- Allow several named label layouts per organisation (was exactly one).
-- The existing layout becomes the default one, named "Default".
ALTER TABLE "label_template" DROP CONSTRAINT IF EXISTS "label_template_organization_id_unique";
ALTER TABLE "label_template" DROP CONSTRAINT IF EXISTS "label_template_organization_id_key";
ALTER TABLE "label_template" ADD COLUMN "name" text DEFAULT 'Default' NOT NULL;
ALTER TABLE "label_template" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
ALTER TABLE "label_template" ADD COLUMN "created_by" text;
ALTER TABLE "label_template" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;
UPDATE "label_template" SET "is_default" = true;
CREATE INDEX "label_template_org_idx" ON "label_template" ("organization_id");
CREATE UNIQUE INDEX "label_template_org_name_uidx" ON "label_template" ("organization_id", "name");
