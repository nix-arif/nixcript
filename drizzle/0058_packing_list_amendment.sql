-- Corrections to a packing-list line after its inspection was completed
-- (server/packing-list.ts requestPackingListAmendment / decidePackingListAmendment).
-- Maker-checker: a request is recorded first ("pending"); nothing changes in
-- stock, the goods receipt or the packing list until an approver approves it.
--   kind "amend"  — new received / return / repair figures for the line
--   kind "remove" — take the line off the packing list altogether
CREATE TABLE "packing_list_amendment" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "packing_list_id" text NOT NULL REFERENCES "packing_list"("id") ON DELETE CASCADE,
  "packing_list_item_id" text NOT NULL REFERENCES "packing_list_item"("id") ON DELETE CASCADE,
  -- kept when the receipt line is later removed / recalled and deleted, so the history stays
  "goods_receipt_item_id" text REFERENCES "goods_receipt_item"("id") ON DELETE SET NULL,
  "gr_no" text,
  "kind" text DEFAULT 'amend' NOT NULL,          -- amend | remove
  "status" text DEFAULT 'pending' NOT NULL,      -- pending | approved | rejected | cancelled
  -- figures on the receipt when the request was made; re-checked on approval
  "old_qty_received" text NOT NULL,
  "old_qty_return" text NOT NULL,
  "old_qty_repair" text NOT NULL,
  -- requested figures (all 0 for a removal)
  "new_qty_received" text NOT NULL,
  "new_qty_return" text NOT NULL,
  "new_qty_repair" text NOT NULL,
  "new_return_notes" text,
  "new_repair_notes" text,
  -- change in accepted units = the stock movement made on approval
  "stock_delta" text NOT NULL,
  "reason" text NOT NULL,
  "requested_by" text NOT NULL REFERENCES "user"("id"),
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "decided_by" text REFERENCES "user"("id"),
  "decided_at" timestamp,
  "decision_notes" text
);
CREATE INDEX "pla_plitem_idx" ON "packing_list_amendment" ("packing_list_item_id");
CREATE INDEX "pla_pl_idx" ON "packing_list_amendment" ("packing_list_id");
CREATE INDEX "pla_org_status_idx" ON "packing_list_amendment" ("organization_id", "status");
-- at most one open request per line
CREATE UNIQUE INDEX "pla_one_pending_uidx" ON "packing_list_amendment" ("packing_list_item_id") WHERE "status" = 'pending';

-- A line taken off a completed packing list by an approved "remove" request.
-- The row stays (photos, audit, history); everything else ignores it.
ALTER TABLE "packing_list_item" ADD COLUMN "removed_at" timestamp;
ALTER TABLE "packing_list_item" ADD COLUMN "removed_by" text REFERENCES "user"("id");
ALTER TABLE "packing_list_item" ADD COLUMN "removed_reason" text;
