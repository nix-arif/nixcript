"use server";

// What suppliers still owe, per Supplier PO line, for the "Pending from
// Supplier" page. Three kinds, worked out per PO line so no unit is counted twice:
//   - not shipped:  ordered − what's on (non-cancelled) packing lists
//   - short on PL:  per packing-list line, expected − received on confirmed GRs
//                   (a packing list not received yet counts in full: "awaiting receipt")
//   - awaiting replacement: units rejected and returned, not yet covered by a
//                   good replacement (same figure as Returns & Surplus)
// Replacement shipments are left out of the first two (they belong to the
// return they replace), and a PO line closed as short owes nothing more.

import { db } from "@/db";
import {
  goodsReceipt, goodsReceiptItem, organization, packingList, packingListItem,
  purchaseOrder, purchaseOrderItem, returnReplacementAttempt,
} from "@/db/schema";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { requireAccess } from "@/lib/auth/require-access";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";

const num = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;

export type PendingShortPl = {
  packingListId: string; packingListNo: string; plStatus: string; createdAt: Date;
  expected: number; received: number; pending: number;
};
export type PendingReturn = {
  goodsReceiptId: string; grNo: string; packingListNo: string | null;
  rejected: number; outstanding: number; inspectedAt: Date | null; shippedAt: Date | null;
};
export type PendingLine = {
  organizationId: string; organizationName: string | null;
  supplierId: string | null; supplierName: string;
  purchaseOrderId: string; poNo: string | null; poDate: Date;
  poItemId: string; rowNo: number; productCode: string | null; description: string | null; uom: string | null;
  customerPoNo: string | null; customerName: string | null; customerOrganization: string | null;
  qtyOrdered: number;
  qtyNotShipped: number;
  qtyShort: number; shortPls: PendingShortPl[];
  qtyAwaitingReplacement: number; returns: PendingReturn[];
  totalPending: number;
  // when the oldest pending part started: PO date (not shipped), PL date (short), inspection (returns)
  since: Date;
};

export async function getPendingFromSupplier(): Promise<PendingLine[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  return computePending([orgId]);
}

// Same, across every company the caller's owner holds.
export async function getPendingFromSupplierCentralized(): Promise<PendingLine[]> {
  const { orgId } = await requireAccess("purchase-order:read:centralized");
  return computePending(await getOwnerOrgIds(orgId));
}

async function computePending(orgIds: string[]): Promise<PendingLine[]> {
  if (orgIds.length === 0) return [];

  // PO lines of POs that went to the supplier (confirmed; a fulfilled PO can still have returns open)
  const poRows = await db
    .select({
      po: { id: purchaseOrder.id, poNo: purchaseOrder.poNo, status: purchaseOrder.status, organizationId: purchaseOrder.organizationId, supplierId: purchaseOrder.supplierId, supplierSnapshot: purchaseOrder.supplierSnapshot, poDate: purchaseOrder.poDate, createdAt: purchaseOrder.createdAt },
      item: purchaseOrderItem,
    })
    .from(purchaseOrderItem)
    .innerJoin(purchaseOrder, eq(purchaseOrderItem.purchaseOrderId, purchaseOrder.id))
    .where(and(inArray(purchaseOrder.organizationId, orgIds), inArray(purchaseOrder.status, ["confirmed", "fulfilled"])));
  if (poRows.length === 0) return [];
  const poItemIds = poRows.map((r) => r.item.id);

  const [orgRows, plRows, grRows, attemptRows] = await Promise.all([
    db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, orgIds)),
    db.select({
        plItemId: packingListItem.id, poItemId: packingListItem.purchaseOrderItemId, qtyExpected: packingListItem.qtyExpected,
        plId: packingList.id, plNo: packingList.packingListNo, plStatus: packingList.status, plCreatedAt: packingList.createdAt,
      })
      .from(packingListItem)
      .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
      .where(and(inArray(packingListItem.purchaseOrderItemId, poItemIds), ne(packingList.status, "cancelled"), isNull(packingListItem.removedAt))),
    db.select({
        id: goodsReceiptItem.id, poItemId: goodsReceiptItem.purchaseOrderItemId, plItemId: goodsReceiptItem.packingListItemId,
        qtyReceived: goodsReceiptItem.qtyReceived, qtyReturn: goodsReceiptItem.qtyReturn, returnStatus: goodsReceiptItem.returnStatus,
        inspectedAt: goodsReceiptItem.inspectedAt, shippedAt: goodsReceiptItem.returnShippedAt,
        grId: goodsReceipt.id, grNo: goodsReceipt.grNo, grStatus: goodsReceipt.status, grPlId: goodsReceipt.packingListId,
      })
      .from(goodsReceiptItem)
      .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
      .where(and(inArray(goodsReceiptItem.purchaseOrderItemId, poItemIds), ne(goodsReceipt.status, "recalled"))),
    db.select({ grItemId: returnReplacementAttempt.goodsReceiptItemId, plItemId: returnReplacementAttempt.packingListItemId, status: returnReplacementAttempt.status, qtyGood: returnReplacementAttempt.qtyGood })
      .from(returnReplacementAttempt)
      .innerJoin(packingListItem, eq(returnReplacementAttempt.packingListItemId, packingListItem.id))
      .where(inArray(packingListItem.purchaseOrderItemId, poItemIds)),
  ]);
  const orgName = new Map(orgRows.map((o) => [o.id, o.name]));
  const replacementPlItemIds = new Set(attemptRows.map((a) => a.plItemId));
  const plNoById = new Map(plRows.map((p) => [p.plId, p.plNo]));

  const lines: PendingLine[] = [];
  for (const { po, item } of poRows) {
    const closed = !!item.shortfallClosedStatus;
    const ordered = num(item.qty);
    const myPls = plRows.filter((p) => p.poItemId === item.id && !replacementPlItemIds.has(p.plItemId));
    const myGrs = grRows.filter((g) => g.poItemId === item.id);

    // short on each packing list (only received on confirmed GRs counts)
    const shortPls: PendingShortPl[] = closed ? [] : myPls.map((p) => {
      const received = myGrs.filter((g) => g.plItemId === p.plItemId && g.grStatus === "confirmed").reduce((s, g) => s + num(g.qtyReceived), 0);
      const expected = num(p.qtyExpected);
      return { packingListId: p.plId, packingListNo: p.plNo, plStatus: p.plStatus, createdAt: p.plCreatedAt, expected, received, pending: Math.max(0, expected - received) };
    }).filter((p) => p.pending > 0);
    const onPls = myPls.reduce((s, p) => s + num(p.qtyExpected), 0);
    const qtyNotShipped = closed || po.status !== "confirmed" ? 0 : Math.max(0, ordered - onPls);

    // rejected, returned and not yet replaced by good units
    const returns: PendingReturn[] = myGrs
      .filter((g) => g.returnStatus === "pending" && num(g.qtyReturn) > 0)
      .map((g) => {
        const good = attemptRows.filter((a) => a.grItemId === g.id && a.status === "inspected").reduce((s, a) => s + num(a.qtyGood), 0);
        return { goodsReceiptId: g.grId, grNo: g.grNo, packingListNo: g.grPlId ? (plNoById.get(g.grPlId) ?? null) : null, rejected: num(g.qtyReturn), outstanding: Math.max(0, num(g.qtyReturn) - good), inspectedAt: g.inspectedAt, shippedAt: g.shippedAt };
      })
      .filter((r) => r.outstanding > 0);

    const qtyShort = shortPls.reduce((s, p) => s + p.pending, 0);
    const qtyAwaitingReplacement = returns.reduce((s, r) => s + r.outstanding, 0);
    const totalPending = qtyNotShipped + qtyShort + qtyAwaitingReplacement;
    if (totalPending <= 0) continue;

    const poDate = po.poDate ? new Date(po.poDate) : po.createdAt;
    const sinceDates = [
      ...(qtyNotShipped > 0 ? [poDate] : []),
      ...shortPls.map((p) => p.createdAt),
      ...returns.map((r) => r.inspectedAt ?? poDate),
    ];
    lines.push({
      organizationId: po.organizationId,
      organizationName: orgName.get(po.organizationId) ?? null,
      supplierId: po.supplierId,
      supplierName: (po.supplierSnapshot as { name?: string } | null)?.name ?? "Unknown supplier",
      purchaseOrderId: po.id, poNo: po.poNo, poDate,
      poItemId: item.id, rowNo: item.rowNo, productCode: item.productCode, description: item.description, uom: item.uom,
      customerPoNo: item.customerPoNo || null, customerName: item.customerName || null, customerOrganization: item.customerOrganization || null,
      qtyOrdered: ordered,
      qtyNotShipped, qtyShort, shortPls, qtyAwaitingReplacement, returns, totalPending,
      since: new Date(Math.min(...sinceDates.map((d) => new Date(d).getTime()))),
    });
  }
  return lines.sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.since.getTime() - b.since.getTime());
}
