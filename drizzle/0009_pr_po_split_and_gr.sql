-- Split Purchase Requisition (PR) from Supplier PO using separate document numbers,
-- and add Goods Receipt (GR) tables for proper 3-way matching.

-- 1. Add pr_no column to purchase_order (nullable — null for old records that predate this migration)
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS pr_no text;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_pr_no_org_uidx
  ON purchase_order (organization_id, pr_no)
  WHERE pr_no IS NOT NULL;

-- 2. Make po_no nullable (new PRs start without a PO number; it is assigned at approval)
ALTER TABLE purchase_order ALTER COLUMN po_no DROP NOT NULL;

-- Back-fill: existing rows already have a po_no, so their pr_no stays null (they predate PRs)

-- 3. Purchase Requisition counter (tracks PR-YYYY-XXXX sequence per org)
CREATE TABLE IF NOT EXISTS purchase_requisition_counter (
  id text PRIMARY KEY,
  organization_id text NOT NULL UNIQUE REFERENCES organization(id) ON DELETE CASCADE,
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamp DEFAULT now() NOT NULL
);

-- 4. Goods Receipt counter (tracks GR-YYYY-XXXX sequence per org)
CREATE TABLE IF NOT EXISTS goods_receipt_counter (
  id text PRIMARY KEY,
  organization_id text NOT NULL UNIQUE REFERENCES organization(id) ON DELETE CASCADE,
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamp DEFAULT now() NOT NULL
);

-- 5. Goods Receipt header
CREATE TABLE IF NOT EXISTS goods_receipt (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  gr_no text NOT NULL,
  purchase_order_id text NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  received_date timestamp NOT NULL,
  received_by text NOT NULL REFERENCES "user"(id),
  notes text,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipt_no_org_uidx ON goods_receipt(organization_id, gr_no);
CREATE INDEX IF NOT EXISTS goods_receipt_po_idx ON goods_receipt(purchase_order_id);

-- 6. Goods Receipt line items
CREATE TABLE IF NOT EXISTS goods_receipt_item (
  id text PRIMARY KEY,
  goods_receipt_id text NOT NULL REFERENCES goods_receipt(id) ON DELETE CASCADE,
  purchase_order_item_id text REFERENCES purchase_order_item(id),
  product_id text,
  product_code text,
  description text,
  qty_ordered text NOT NULL DEFAULT '0',
  qty_received text NOT NULL DEFAULT '0',
  uom text,
  unit_price text DEFAULT '0',
  currency text DEFAULT 'MYR',
  notes text
);
CREATE INDEX IF NOT EXISTS gr_item_gr_idx ON goods_receipt_item(goods_receipt_id);
