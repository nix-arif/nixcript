-- A customer PO number is unique inside an organization (ignoring capitals and spaces around it).
-- A cancelled CPO and a draft do not hold their number.
DROP INDEX IF EXISTS "customer_po_org_no_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "customer_po_org_no_uidx"
  ON "customer_purchase_order" ("organization_id", lower(btrim("customer_po_no")))
  WHERE "status" NOT IN ('cancelled', 'draft');
