-- Lets a supplier record be marked as actually being one of the same
-- owner's other organizations, and (symmetrically) a customer record as
-- representing one back. Confirming a PO against a linked supplier
-- auto-creates a matching Sales Order in that org — see
-- server/intercompany.ts. sourceOrganizationId/sourcePurchaseOrderId on
-- sales_order are traceability pointers for that auto-created SO, not a
-- sync mechanism — they also double as the idempotency guard preventing a
-- duplicate SO if the source PO is later recalled and reconfirmed.
ALTER TABLE "supplier" ADD COLUMN "linked_organization_id" text REFERENCES "organization"("id") ON DELETE SET NULL;
ALTER TABLE "customer" ADD COLUMN "linked_organization_id" text REFERENCES "organization"("id") ON DELETE SET NULL;
ALTER TABLE "sales_order" ADD COLUMN "source_organization_id" text REFERENCES "organization"("id") ON DELETE SET NULL;
ALTER TABLE "sales_order" ADD COLUMN "source_purchase_order_id" text REFERENCES "purchase_order"("id") ON DELETE SET NULL;
