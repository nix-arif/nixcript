-- Sponsorship: the company sponsors an external party (doctor, hospital, association, event).
-- Requester -> checker -> approver, then the spend is recorded and the sponsorship closed.
CREATE TABLE IF NOT EXISTS "sponsorship" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "sponsorship_no" text NOT NULL,
  "requested_by" text NOT NULL REFERENCES "user"("id"),
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "recipient_type" text DEFAULT 'doctor' NOT NULL,
  "recipient_name" text DEFAULT '' NOT NULL,
  "recipient_organization" text,
  "is_hcp" boolean DEFAULT false NOT NULL,
  "is_government" boolean DEFAULT false NOT NULL,
  "institution_approved" boolean DEFAULT false NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "purpose" text DEFAULT '' NOT NULL,
  "event_date_from" date,
  "event_date_to" date,
  "venue" text,
  "total_requested" text DEFAULT '0' NOT NULL,
  "approved_amount" text,
  "declaration_accepted" boolean DEFAULT false NOT NULL,
  "checked_by" text REFERENCES "user"("id"),
  "checked_at" timestamp,
  "check_comment" text,
  "approved_by" text REFERENCES "user"("id"),
  "approved_at" timestamp,
  "approve_comment" text,
  "rejected_by" text REFERENCES "user"("id"),
  "rejected_at" timestamp,
  "reject_reason" text,
  "cancelled_by" text REFERENCES "user"("id"),
  "cancelled_at" timestamp,
  "cancel_reason" text,
  "actual_amount" text,
  "paid_at" timestamp,
  "paid_by" text REFERENCES "user"("id"),
  "payment_ref" text,
  "closed_at" timestamp,
  "closed_by" text REFERENCES "user"("id"),
  "close_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "sponsorship_no_org_uidx" ON "sponsorship" ("organization_id", "sponsorship_no");
CREATE INDEX IF NOT EXISTS "sponsorship_requester_idx" ON "sponsorship" ("requested_by", "organization_id");
CREATE INDEX IF NOT EXISTS "sponsorship_status_idx" ON "sponsorship" ("status", "organization_id");

CREATE TABLE IF NOT EXISTS "sponsorship_item" (
  "id" text PRIMARY KEY NOT NULL,
  "sponsorship_id" text NOT NULL REFERENCES "sponsorship"("id") ON DELETE CASCADE,
  "category" text DEFAULT 'other' NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "amount" text DEFAULT '0' NOT NULL,
  "actual_amount" text,
  "sort_order" integer DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS "sponsorship_item_sponsorship_idx" ON "sponsorship_item" ("sponsorship_id");

CREATE TABLE IF NOT EXISTS "sponsorship_document" (
  "id" text PRIMARY KEY NOT NULL,
  "sponsorship_id" text NOT NULL REFERENCES "sponsorship"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "kind" text DEFAULT 'other' NOT NULL,
  "file_name" text NOT NULL,
  "file_key" text NOT NULL,
  "file_size" integer NOT NULL,
  "mime_type" text NOT NULL,
  "uploaded_by" text NOT NULL REFERENCES "user"("id"),
  "uploaded_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sponsorship_document_sponsorship_idx" ON "sponsorship_document" ("sponsorship_id");
