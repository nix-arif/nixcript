// Item-level customer trace: which customer PO (id + no.), customer and customer
// organization (id + name) each document line is for, from the Sales Order line
// through PR → Supplier PO → packing list, and SO → DO → invoice. An SO may
// combine several CPOs, so the header alone can't say whose line is whose.
//
// Each fill copies values from the line's source, ONLY into fields that are
// still empty (never overwrites), and leaves a line alone when its source is
// ambiguous. Called right after a document's lines are saved (scoped to that
// document), and once over everything for existing data
// (scripts/backfill-item-customers.ts).
//
// Not a "use server" file: no auth of its own — callers have already
// authorised the document they pass.

import { db } from "@/db";
import { sql, type SQL } from "drizzle-orm";

// The customer's organization: its primary customer_company membership (the
// customer record itself only holds the organization's name).
const orgIdOf = (customerIdExpr: SQL) => sql`(
  SELECT cc.customer_organization_id FROM customer_company cc
  WHERE cc.customer_id = ${customerIdExpr}
  ORDER BY cc.is_primary DESC NULLS LAST, cc.created_at ASC LIMIT 1
)`;
// "Dr Aminah Rahman" from a customer snapshot
const nameOf = (snap: SQL) => sql`NULLIF(TRIM(CONCAT_WS(' ', ${snap}->>'title', ${snap}->>'name')), '')`;
const scoped = (col: SQL, id?: string) => (id ? sql`AND ${col} = ${id}` : sql``);

/** SO lines: fill the customer from the line's CPO (older SOs), or the SO's own customer (no CPO). */
export async function fillSalesOrderItemCustomers(salesOrderId?: string) {
  await db.execute(sql`
    UPDATE sales_order_item soi SET
      source_customer_po_no    = COALESCE(soi.source_customer_po_no, c.customer_po_no),
      customer_id              = COALESCE(soi.customer_id, c.customer_id),
      customer_name            = COALESCE(soi.customer_name, ${nameOf(sql`c.customer_snapshot::jsonb`)}),
      customer_organization    = COALESCE(soi.customer_organization, c.customer_snapshot::jsonb->>'organizationName'),
      customer_organization_id = COALESCE(soi.customer_organization_id, ${orgIdOf(sql`COALESCE(soi.customer_id, c.customer_id)`)})
    FROM customer_purchase_order c
    WHERE c.id = soi.source_customer_po_id
      AND (soi.customer_id IS NULL OR soi.customer_name IS NULL OR soi.customer_organization IS NULL OR soi.customer_organization_id IS NULL OR soi.source_customer_po_no IS NULL)
      ${scoped(sql`soi.sales_order_id`, salesOrderId)}`);
  await db.execute(sql`
    UPDATE sales_order_item soi SET
      customer_id              = COALESCE(soi.customer_id, so.customer_id),
      customer_name            = COALESCE(soi.customer_name, ${nameOf(sql`so.customer_snapshot::jsonb`)}),
      customer_organization    = COALESCE(soi.customer_organization, so.customer_snapshot::jsonb->>'organizationName'),
      customer_organization_id = COALESCE(soi.customer_organization_id, ${orgIdOf(sql`COALESCE(soi.customer_id, so.customer_id)`)})
    FROM sales_order so
    WHERE so.id = soi.sales_order_id AND soi.source_customer_po_id IS NULL
      AND (soi.customer_id IS NULL OR soi.customer_name IS NULL OR soi.customer_organization IS NULL OR soi.customer_organization_id IS NULL)
      ${scoped(sql`soi.sales_order_id`, salesOrderId)}`);
}

/** DO lines: from the SO line they deliver; a line with none (e.g. a Case DO) from the DO header. */
export async function fillDeliveryOrderItemCustomers(deliveryOrderId?: string) {
  await db.execute(sql`
    UPDATE delivery_order_item d SET
      source_customer_po_id    = COALESCE(d.source_customer_po_id, s.source_customer_po_id),
      source_customer_po_no    = COALESCE(d.source_customer_po_no, s.source_customer_po_no),
      customer_id              = COALESCE(d.customer_id, s.customer_id),
      customer_organization_id = COALESCE(d.customer_organization_id, s.customer_organization_id),
      customer_name            = COALESCE(d.customer_name, s.customer_name),
      customer_organization    = COALESCE(d.customer_organization, s.customer_organization)
    FROM sales_order_item s
    WHERE s.id = d.so_item_id AND d.source_customer_po_id IS NULL
      ${scoped(sql`d.delivery_order_id`, deliveryOrderId)}`);
  await db.execute(sql`
    UPDATE delivery_order_item d SET
      source_customer_po_id    = COALESCE(d.source_customer_po_id, h.customer_po_id),
      source_customer_po_no    = COALESCE(d.source_customer_po_no, h.customer_po_no),
      customer_id              = COALESCE(d.customer_id, h.customer_id),
      customer_name            = COALESCE(d.customer_name, ${nameOf(sql`h.customer_snapshot::jsonb`)}),
      customer_organization    = COALESCE(d.customer_organization, h.customer_snapshot::jsonb->>'organizationName'),
      customer_organization_id = COALESCE(d.customer_organization_id, ${orgIdOf(sql`COALESCE(d.customer_id, h.customer_id)`)})
    FROM delivery_order h
    WHERE h.id = d.delivery_order_id AND d.so_item_id IS NULL AND d.source_customer_po_id IS NULL
      ${scoped(sql`d.delivery_order_id`, deliveryOrderId)}`);
}

/**
 * Invoice lines: from the same line (row no. + product code) of the DO it bills,
 * or of its SO when it bills no DO; otherwise from the invoice header.
 */
export async function fillInvoiceItemCustomers(invoiceId?: string) {
  const copy = (src: string) => sql.raw(`
      source_customer_po_id    = COALESCE(ii.source_customer_po_id, ${src}.source_customer_po_id),
      source_customer_po_no    = COALESCE(ii.source_customer_po_no, ${src}.source_customer_po_no),
      customer_id              = COALESCE(ii.customer_id, ${src}.customer_id),
      customer_organization_id = COALESCE(ii.customer_organization_id, ${src}.customer_organization_id),
      customer_name            = COALESCE(ii.customer_name, ${src}.customer_name),
      customer_organization    = COALESCE(ii.customer_organization, ${src}.customer_organization)`);
  await db.execute(sql`
    UPDATE invoice_item ii SET ${copy("di")}
    FROM invoice inv, delivery_order_item di
    WHERE inv.id = ii.invoice_id AND di.delivery_order_id = inv.delivery_order_id
      AND di.row_no = ii.row_no AND di.product_code IS NOT DISTINCT FROM ii.product_code
      AND ii.source_customer_po_id IS NULL
      ${scoped(sql`ii.invoice_id`, invoiceId)}`);
  await db.execute(sql`
    UPDATE invoice_item ii SET ${copy("s")}
    FROM invoice inv, sales_order_item s
    WHERE inv.id = ii.invoice_id AND inv.delivery_order_id IS NULL AND s.sales_order_id = inv.sales_order_id
      AND s.row_no = ii.row_no AND s.product_code IS NOT DISTINCT FROM ii.product_code
      AND ii.source_customer_po_id IS NULL
      ${scoped(sql`ii.invoice_id`, invoiceId)}`);
  await db.execute(sql`
    UPDATE invoice_item ii SET
      source_customer_po_id    = COALESCE(ii.source_customer_po_id, inv.customer_po_id),
      source_customer_po_no    = COALESCE(ii.source_customer_po_no, inv.customer_po_no),
      customer_id              = COALESCE(ii.customer_id, inv.customer_id),
      customer_name            = COALESCE(ii.customer_name, ${nameOf(sql`inv.customer_snapshot::jsonb`)}),
      customer_organization    = COALESCE(ii.customer_organization, inv.customer_snapshot::jsonb->>'organizationName'),
      customer_organization_id = COALESCE(ii.customer_organization_id, ${orgIdOf(sql`COALESCE(ii.customer_id, inv.customer_id)`)})
    FROM invoice inv
    WHERE inv.id = ii.invoice_id AND ii.source_customer_po_id IS NULL
      ${scoped(sql`ii.invoice_id`, invoiceId)}`);
}

/**
 * PR lines: from the one SO line with the same product (and CPO no., if the PR
 * line has one) — left alone when several match; then the ids behind the CPO no.
 */
export async function fillPurchaseRequisitionItemCustomers(purchaseRequisitionId?: string) {
  await db.execute(sql`
    WITH m AS (
      SELECT pi.id AS pi_id, MIN(s.id) AS s_id
      FROM purchase_requisition_item pi
      JOIN purchase_requisition pr ON pr.id = pi.purchase_requisition_id
      JOIN sales_order_item s ON s.sales_order_id = pr.sales_order_id
        AND s.product_code IS NOT DISTINCT FROM pi.product_code
        AND (pi.cpo_no IS NULL OR s.source_customer_po_no = pi.cpo_no)
      WHERE pi.source_customer_po_id IS NULL ${scoped(sql`pi.purchase_requisition_id`, purchaseRequisitionId)}
      GROUP BY pi.id HAVING COUNT(*) = 1
    )
    UPDATE purchase_requisition_item pi SET
      source_customer_po_id    = s.source_customer_po_id,
      cpo_no                   = COALESCE(pi.cpo_no, s.source_customer_po_no),
      customer_id              = COALESCE(pi.customer_id, s.customer_id),
      customer_organization_id = COALESCE(pi.customer_organization_id, s.customer_organization_id),
      customer_name            = COALESCE(pi.customer_name, s.customer_name),
      customer_organization    = COALESCE(pi.customer_organization, s.customer_organization)
    FROM m JOIN sales_order_item s ON s.id = m.s_id
    WHERE pi.id = m.pi_id`);
  await db.execute(sql`
    UPDATE purchase_requisition_item pi SET
      source_customer_po_id    = c.id,
      customer_id              = COALESCE(pi.customer_id, c.customer_id),
      customer_organization_id = COALESCE(pi.customer_organization_id, ${orgIdOf(sql`COALESCE(pi.customer_id, c.customer_id)`)}),
      customer_name            = COALESCE(pi.customer_name, ${nameOf(sql`c.customer_snapshot::jsonb`)}),
      customer_organization    = COALESCE(pi.customer_organization, c.customer_snapshot::jsonb->>'organizationName')
    FROM purchase_requisition pr, customer_purchase_order c
    WHERE pr.id = pi.purchase_requisition_id AND c.organization_id = pr.organization_id AND c.customer_po_no = pi.cpo_no
      AND pi.source_customer_po_id IS NULL
      ${scoped(sql`pi.purchase_requisition_id`, purchaseRequisitionId)}`);
}

/** Supplier PO lines: the CPO behind their CPO no. (unique within the company), and its customer where missing. */
export async function fillPurchaseOrderItemCustomers(purchaseOrderId?: string) {
  await db.execute(sql`
    UPDATE purchase_order_item poi SET
      source_customer_po_id    = c.id,
      customer_id              = COALESCE(poi.customer_id, c.customer_id),
      customer_organization_id = COALESCE(poi.customer_organization_id, ${orgIdOf(sql`COALESCE(poi.customer_id, c.customer_id)`)}),
      customer_name            = COALESCE(poi.customer_name, ${nameOf(sql`c.customer_snapshot::jsonb`)}),
      customer_organization    = COALESCE(poi.customer_organization, c.customer_snapshot::jsonb->>'organizationName')
    FROM purchase_order po, customer_purchase_order c
    WHERE po.id = poi.purchase_order_id AND c.organization_id = po.organization_id AND c.customer_po_no = poi.customer_po_no
      AND poi.source_customer_po_id IS NULL
      ${scoped(sql`poi.purchase_order_id`, purchaseOrderId)}`);
}

/** Packing-list lines: from the Supplier PO line they ship. */
export async function fillPackingListItemCustomers(packingListId?: string) {
  await db.execute(sql`
    UPDATE packing_list_item pli SET
      source_customer_po_id    = COALESCE(pli.source_customer_po_id, poi.source_customer_po_id),
      customer_po_no           = COALESCE(pli.customer_po_no, poi.customer_po_no),
      customer_id              = COALESCE(pli.customer_id, poi.customer_id),
      customer_organization_id = COALESCE(pli.customer_organization_id, poi.customer_organization_id),
      customer_name            = COALESCE(pli.customer_name, poi.customer_name),
      customer_organization    = COALESCE(pli.customer_organization, poi.customer_organization)
    FROM purchase_order_item poi
    WHERE poi.id = pli.purchase_order_item_id
      AND (pli.source_customer_po_id IS NULL OR pli.customer_id IS NULL OR pli.customer_organization_id IS NULL)
      ${scoped(sql`pli.packing_list_id`, packingListId)}`);
}

/** Everything, in chain order (each step reads what the one before filled). */
export async function fillAllItemCustomers() {
  await fillSalesOrderItemCustomers();
  await fillPurchaseRequisitionItemCustomers();
  await fillPurchaseOrderItemCustomers();
  await fillPackingListItemCustomers();
  await fillDeliveryOrderItemCustomers();
  await fillInvoiceItemCustomers();
}
