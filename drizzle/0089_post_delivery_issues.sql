-- Problems found AFTER delivery to the customer, and the claims raised against suppliers because of them.
--  * supplier_claim_term: how long a supplier accepts a claim and counted from which date (per supplier, and per kind of problem)
--  * customer_issue (+ items, evidence, timeline): what the customer reported, which delivered units, what is owed to the customer
--  * supplier_claim (+ items): one claim per supplier, with its deadline, when it was sent, the supplier's answer and the outcome
-- The receiving inspection record (packing list / goods receipt) is NOT changed by any of this: it stays as it was at receipt.

CREATE TABLE IF NOT EXISTS "supplier_claim_term" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "supplier_id" text NOT NULL REFERENCES "supplier"("id") ON DELETE CASCADE,
  "situation" text NOT NULL DEFAULT '',            -- '' = applies to any kind of problem without its own row
  "window_days" integer NOT NULL,
  "basis" text NOT NULL DEFAULT 'receipt',         -- receipt | delivery: the date the days are counted from
  "notes" text,
  "updated_by" text REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_claim_term_uidx" ON "supplier_claim_term" ("organization_id", "supplier_id", "situation");

CREATE TABLE IF NOT EXISTS "post_delivery_counter" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "doc_type" text NOT NULL,                         -- ci (customer issue) | sc (supplier claim)
  "year" integer NOT NULL,
  "last_number" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "post_delivery_counter_uidx" ON "post_delivery_counter" ("organization_id", "doc_type");

CREATE TABLE IF NOT EXISTS "customer_issue" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "issue_no" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',           -- open | investigating | claim_raised | resolved | closed_no_claim | cancelled
  "customer_id" text REFERENCES "customer"("id") ON DELETE SET NULL,
  "customer_name" text NOT NULL,
  "contact_person" text,
  "contact_no" text,
  "delivery_order_id" text REFERENCES "delivery_order"("id") ON DELETE SET NULL,
  "delivery_order_no" text,
  "delivered_at" date,
  "reported_at" date NOT NULL,
  "reported_channel" text,
  "situation" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'normal',       -- normal | high | urgent
  "safety_related" boolean NOT NULL DEFAULT false,
  "summary" text NOT NULL,
  "description" text,
  "customer_resolution" text,                      -- replacement | credit | repair | refund | none
  "customer_resolution_notes" text,
  "resolved_at" timestamp,
  "closed_reason" text,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_issue_no_uidx" ON "customer_issue" ("organization_id", "issue_no");
CREATE INDEX IF NOT EXISTS "customer_issue_org_status_idx" ON "customer_issue" ("organization_id", "status");

CREATE TABLE IF NOT EXISTS "customer_issue_item" (
  "id" text PRIMARY KEY NOT NULL,
  "issue_id" text NOT NULL REFERENCES "customer_issue"("id") ON DELETE CASCADE,
  "row_no" integer NOT NULL DEFAULT 0,
  "product_id" text,
  "product_code" text,
  "description" text,
  "qty_delivered" text,
  "qty_affected" text NOT NULL DEFAULT '1',
  "uom" text,
  "lot_no" text,
  "serial_no" text,
  "supplier_id" text REFERENCES "supplier"("id") ON DELETE SET NULL,
  "supplier_name" text,
  "po_no" text,
  "supplier_doc_ref" text,                         -- the supplier's own delivery order / invoice number
  "goods_receipt_id" text REFERENCES "goods_receipt"("id") ON DELETE SET NULL,
  "gr_no" text,
  "packing_list_item_id" text REFERENCES "packing_list_item"("id") ON DELETE SET NULL,
  "received_at" date,                              -- when we received it from the supplier
  "unit_cost" text,
  "currency" text,
  "unit_status" text NOT NULL DEFAULT 'with_customer', -- with_customer | returned_to_us | quarantine | sent_to_supplier | replaced | credited | repaired | scrapped
  "notes" text
);
CREATE INDEX IF NOT EXISTS "customer_issue_item_issue_idx" ON "customer_issue_item" ("issue_id");
CREATE INDEX IF NOT EXISTS "customer_issue_item_supplier_idx" ON "customer_issue_item" ("supplier_id");

CREATE TABLE IF NOT EXISTS "customer_issue_media" (
  "id" text PRIMARY KEY NOT NULL,
  "issue_id" text NOT NULL REFERENCES "customer_issue"("id") ON DELETE CASCADE,
  "item_id" text REFERENCES "customer_issue_item"("id") ON DELETE SET NULL,
  "image_key" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'image',            -- image | video
  "filename" text NOT NULL,
  "caption" text,
  "uploaded_by" text REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "customer_issue_media_issue_idx" ON "customer_issue_media" ("issue_id");

CREATE TABLE IF NOT EXISTS "supplier_claim" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "claim_no" text NOT NULL,
  "issue_id" text NOT NULL REFERENCES "customer_issue"("id") ON DELETE CASCADE,
  "supplier_id" text NOT NULL REFERENCES "supplier"("id"),
  "supplier_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',          -- draft | sent | accepted | partial | rejected | closed | withdrawn
  "situation" text NOT NULL,
  "basis" text,                                    -- receipt | delivery | null when the supplier has no terms recorded
  "basis_date" date,
  "window_days" integer,
  "deadline_date" date,
  "deadline_overridden" boolean NOT NULL DEFAULT false,
  "deadline_note" text,
  "sent_at" timestamp,
  "sent_by" text REFERENCES "user"("id"),
  "sent_via" text,
  "sent_late" boolean NOT NULL DEFAULT false,      -- sent after the supplier's window had ended
  "requested_outcome" text,                        -- what we ask the supplier for: replacement | credit_note | repair | refund
  "supplier_ref" text,                             -- the supplier's claim / RMA number
  "follow_up_date" date,
  "follow_up_notified" date,
  "responded_at" timestamp,
  "supplier_response" text,
  "outcome" text,                                  -- replacement | credit_note | repair | refund | goodwill | rejected
  "outcome_notes" text,
  "credit_amount" text,
  "credit_currency" text,
  "closed_at" timestamp,
  "withdrawn_reason" text,
  "reminded_level" integer NOT NULL DEFAULT 0,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_claim_no_uidx" ON "supplier_claim" ("organization_id", "claim_no");
CREATE INDEX IF NOT EXISTS "supplier_claim_org_status_idx" ON "supplier_claim" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "supplier_claim_issue_idx" ON "supplier_claim" ("issue_id");
CREATE INDEX IF NOT EXISTS "supplier_claim_supplier_idx" ON "supplier_claim" ("supplier_id");

CREATE TABLE IF NOT EXISTS "supplier_claim_item" (
  "id" text PRIMARY KEY NOT NULL,
  "claim_id" text NOT NULL REFERENCES "supplier_claim"("id") ON DELETE CASCADE,
  "issue_item_id" text NOT NULL REFERENCES "customer_issue_item"("id") ON DELETE CASCADE,
  "qty_claimed" text NOT NULL,
  "qty_accepted" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_claim_item_uidx" ON "supplier_claim_item" ("claim_id", "issue_item_id");

-- what happened, in order: on the issue as a whole, or on one of its claims
CREATE TABLE IF NOT EXISTS "post_delivery_event" (
  "id" text PRIMARY KEY NOT NULL,
  "issue_id" text NOT NULL REFERENCES "customer_issue"("id") ON DELETE CASCADE,
  "claim_id" text REFERENCES "supplier_claim"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "message" text NOT NULL,
  "actor_id" text REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "post_delivery_event_issue_idx" ON "post_delivery_event" ("issue_id", "created_at");
