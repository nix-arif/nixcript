-- Per-organisation sticker label layout for packing-list labels.
CREATE TABLE "label_template" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL UNIQUE REFERENCES "organization"("id") ON DELETE CASCADE,
  "design" json NOT NULL,
  "updated_by" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
