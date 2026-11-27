CREATE TABLE IF NOT EXISTS "document_amendment" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "doc_type" text NOT NULL,
  "doc_id" text NOT NULL,
  "doc_no" text,
  "revision" integer NOT NULL,
  "reason" text NOT NULL,
  "source_amendment_id" text,
  "changes" json NOT NULL,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "document_amendment_doc_idx" ON "document_amendment" ("doc_type", "doc_id");
