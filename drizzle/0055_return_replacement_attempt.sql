-- One row per replacement shipment against a pending supplier return.
CREATE TABLE "return_replacement_attempt" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "goods_receipt_item_id" text NOT NULL REFERENCES "goods_receipt_item"("id") ON DELETE CASCADE,
  "packing_list_item_id" text NOT NULL REFERENCES "packing_list_item"("id") ON DELETE CASCADE,
  "attempt_no" integer NOT NULL,
  "qty_allocated" text NOT NULL,
  "qty_good" text,
  "qty_failed" text,
  "status" text DEFAULT 'linked' NOT NULL,
  "created_by" text REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "inspected_at" timestamp
);
CREATE INDEX "rra_return_idx" ON "return_replacement_attempt" ("goods_receipt_item_id");
CREATE UNIQUE INDEX "rra_return_plitem_uidx" ON "return_replacement_attempt" ("goods_receipt_item_id", "packing_list_item_id");
CREATE INDEX "rra_plitem_idx" ON "return_replacement_attempt" ("packing_list_item_id");
