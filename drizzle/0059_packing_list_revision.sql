-- Changes to a packing list whose inspection is still open: take lines off,
-- add PO lines (or a whole PO). Maker-checker like packing_list_amendment —
-- a request is recorded first ("pending") and only applied once an approver
-- approves it (server/packing-list.ts requestPackingListRevision /
-- decidePackingListRevision).
CREATE TABLE "packing_list_revision" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "packing_list_id" text NOT NULL REFERENCES "packing_list"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'pending' NOT NULL,      -- pending | approved | rejected | cancelled
  -- [{ purchaseOrderItemId, qty }]
  "add_items" json NOT NULL,
  -- [packing_list_item id]
  "remove_item_ids" json NOT NULL,
  -- what the approver is shown: [{ poNo, lineNo, code, description, qty, uom }] per side
  "summary" json NOT NULL,
  "reason" text NOT NULL,
  "requested_by" text NOT NULL REFERENCES "user"("id"),
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "decided_by" text REFERENCES "user"("id"),
  "decided_at" timestamp,
  "decision_notes" text
);
CREATE INDEX "plr_pl_idx" ON "packing_list_revision" ("packing_list_id");
CREATE INDEX "plr_org_status_idx" ON "packing_list_revision" ("organization_id", "status");
-- at most one open request per packing list
CREATE UNIQUE INDEX "plr_one_pending_uidx" ON "packing_list_revision" ("packing_list_id") WHERE "status" = 'pending';
