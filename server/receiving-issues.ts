"use server";

import { db } from "@/db";
import {
  goodsReceipt,
  goodsReceiptItem,
  purchaseOrder,
  purchaseOrderItem,
  packingList,
  packingListItem,
  returnReplacementAttempt,
  user,
  member,
  organization,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { and, asc, eq, inArray, ne } from "drizzle-orm";

async function requireRead(permission = "purchase-order:read") {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId };
}

// Every org owned by the same owner as the caller's active org (same pattern
// as server/goods-receipt.ts).
async function getOwnerOrgIds(orgId: string): Promise<string[]> {
  const [ownerMember] = await db.select().from(member).where(and(eq(member.organizationId, orgId), eq(member.role, "owner"))).limit(1);
  if (!ownerMember) return [orgId];
  const owned = await db.select({ organizationId: member.organizationId }).from(member).where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")));
  const ids = [...new Set(owned.map((m) => m.organizationId))];
  return ids.length > 0 ? ids : [orgId];
}

async function orgNames(orgIds: string[]): Promise<Map<string, string>> {
  const rows = await db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, orgIds));
  return new Map(rows.map((o) => [o.id, o.name]));
}

const num = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;

export type ReturnToSupplierRow = {
  organizationId: string;
  organizationName: string | null;
  goodsReceiptItemId: string;
  supplierId: string | null;
  supplierName: string | null;
  purchaseOrderId: string;
  poNo: string | null;
  prNo: string | null;
  productCode: string | null;
  description: string | null;
  uom: string | null;
  qtyRejected: number;
  // Rejected units not yet covered by a good replacement
  qtyOutstanding: number;
  reason: string | null;
  goodsReceiptId: string;
  grNo: string;
  packingListId: string | null;
  packingListNo: string | null;
  inspectedAt: Date | null;
  inspectedByName: string | null;
  shippedAt: Date | null;
  shipRef: string | null;
  attempts: {
    id: string;
    attemptNo: number;
    packingListId: string;
    packingListNo: string;
    status: string;
    qtyAllocated: number;
    qtyGood: number | null;
    qtyFailed: number | null;
  }[];
};

// Every rejected line still waiting to go back to (or be settled with) the
// supplier, with where it came from, who inspected it and what replacement
// shipments have been linked or scored — one page instead of hunting through
// each goods receipt.
export async function getReturnsToSupplier(): Promise<ReturnToSupplierRow[]> {
  const { orgId } = await requireRead();
  return computeReturns([orgId]);
}

// Same list across every org the caller owns.
export async function getReturnsToSupplierCentralized(): Promise<ReturnToSupplierRow[]> {
  const { orgId } = await requireRead("goods-receipt:read:centralized");
  return computeReturns(await getOwnerOrgIds(orgId));
}

async function computeReturns(orgIds: string[]): Promise<ReturnToSupplierRow[]> {
  const names = await orgNames(orgIds);

  const rows = await db
    .select({
      id: goodsReceiptItem.id,
      qtyReturn: goodsReceiptItem.qtyReturn,
      returnNotes: goodsReceiptItem.returnNotes,
      uom: goodsReceiptItem.uom,
      productCode: goodsReceiptItem.productCode,
      description: goodsReceiptItem.description,
      inspectedAt: goodsReceiptItem.inspectedAt,
      inspectedByName: user.name,
      shippedAt: goodsReceiptItem.returnShippedAt,
      shipRef: goodsReceiptItem.returnShipRef,
      goodsReceiptId: goodsReceipt.id,
      organizationId: goodsReceipt.organizationId,
      grNo: goodsReceipt.grNo,
      packingListId: packingList.id,
      packingListNo: packingList.packingListNo,
      purchaseOrderId: purchaseOrder.id,
      poNo: purchaseOrder.poNo,
      prNo: purchaseOrder.prNo,
      supplierId: purchaseOrder.supplierId,
      supplierSnapshot: purchaseOrder.supplierSnapshot,
    })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .innerJoin(purchaseOrder, eq(goodsReceipt.purchaseOrderId, purchaseOrder.id))
    .leftJoin(packingList, eq(goodsReceipt.packingListId, packingList.id))
    .leftJoin(user, eq(goodsReceiptItem.inspectedBy, user.id))
    .where(and(
      inArray(goodsReceipt.organizationId, orgIds),
      eq(goodsReceiptItem.returnStatus, "pending"),
      ne(goodsReceipt.status, "recalled"),
    ));

  const attemptRows = rows.length === 0 ? [] : await db
    .select({
      id: returnReplacementAttempt.id,
      goodsReceiptItemId: returnReplacementAttempt.goodsReceiptItemId,
      attemptNo: returnReplacementAttempt.attemptNo,
      packingListId: packingList.id,
      packingListNo: packingList.packingListNo,
      status: returnReplacementAttempt.status,
      qtyAllocated: returnReplacementAttempt.qtyAllocated,
      qtyGood: returnReplacementAttempt.qtyGood,
      qtyFailed: returnReplacementAttempt.qtyFailed,
    })
    .from(returnReplacementAttempt)
    .innerJoin(packingListItem, eq(returnReplacementAttempt.packingListItemId, packingListItem.id))
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(inArray(returnReplacementAttempt.goodsReceiptItemId, rows.map((r) => r.id)))
    .orderBy(asc(returnReplacementAttempt.attemptNo));

  return rows
    .filter((r) => num(r.qtyReturn) > 0)
    .map((r) => {
      const attempts = attemptRows
        .filter((a) => a.goodsReceiptItemId === r.id)
        .map((a) => ({
          id: a.id,
          attemptNo: a.attemptNo,
          packingListId: a.packingListId,
          packingListNo: a.packingListNo,
          status: a.status,
          qtyAllocated: num(a.qtyAllocated),
          qtyGood: a.qtyGood === null ? null : num(a.qtyGood),
          qtyFailed: a.qtyFailed === null ? null : num(a.qtyFailed),
        }));
      const good = attempts.filter((a) => a.status === "inspected").reduce((s, a) => s + (a.qtyGood ?? 0), 0);
      const qty = num(r.qtyReturn);
      return {
        goodsReceiptItemId: r.id,
        organizationId: r.organizationId,
        organizationName: names.get(r.organizationId) ?? null,
        supplierId: r.supplierId,
        supplierName: (r.supplierSnapshot as { name?: string } | null)?.name ?? null,
        purchaseOrderId: r.purchaseOrderId,
        poNo: r.poNo,
        prNo: r.prNo,
        productCode: r.productCode,
        description: r.description,
        uom: r.uom,
        qtyRejected: qty,
        qtyOutstanding: Math.max(0, qty - good),
        reason: r.returnNotes,
        goodsReceiptId: r.goodsReceiptId,
        grNo: r.grNo,
        packingListId: r.packingListId,
        packingListNo: r.packingListNo,
        inspectedAt: r.inspectedAt,
        inspectedByName: r.inspectedByName,
        shippedAt: r.shippedAt,
        shipRef: r.shipRef,
        attempts,
      };
    })
    .sort((a, b) => (a.inspectedAt?.getTime() ?? 0) - (b.inspectedAt?.getTime() ?? 0));
}

export type SurplusRow = {
  organizationId: string;
  organizationName: string | null;
  purchaseOrderItemId: string;
  supplierId: string | null;
  supplierName: string | null;
  purchaseOrderId: string;
  poNo: string | null;
  prNo: string | null;
  poStatus: string;
  productCode: string | null;
  description: string | null;
  uom: string | null;
  qtyOrdered: number;
  qtyAccepted: number;
  qtySurplus: number;
  // Units of the same line rejected and still waiting to go back — context
  // for whether the surplus is simply the replacement that arrived early.
  qtyPendingReturn: number;
  receipts: {
    goodsReceiptId: string;
    grNo: string;
    packingListId: string | null;
    packingListNo: string | null;
    receivedDate: Date;
    qtyReceived: number;
    qtyAccepted: number;
    qtyReturned: number;
  }[];
};

// PO lines where more good units were accepted than were ordered. Accepted
// means qtyGood (or qtyReceived on a plain direct receipt), the same measure
// the PO fulfilment check uses.
export async function getSurplusItems(): Promise<SurplusRow[]> {
  const { orgId } = await requireRead();
  return computeSurplus([orgId]);
}

export async function getSurplusItemsCentralized(): Promise<SurplusRow[]> {
  const { orgId } = await requireRead("goods-receipt:read:centralized");
  return computeSurplus(await getOwnerOrgIds(orgId));
}

async function computeSurplus(orgIds: string[]): Promise<SurplusRow[]> {
  const names = await orgNames(orgIds);

  const rows = await db
    .select({
      poItemId: purchaseOrderItem.id,
      qtyOrdered: purchaseOrderItem.qty,
      itemCode: purchaseOrderItem.productCode,
      itemDescription: purchaseOrderItem.description,
      itemUom: purchaseOrderItem.uom,
      poId: purchaseOrder.id,
      poNo: purchaseOrder.poNo,
      prNo: purchaseOrder.prNo,
      poStatus: purchaseOrder.status,
      organizationId: goodsReceipt.organizationId,
      supplierId: purchaseOrder.supplierId,
      supplierSnapshot: purchaseOrder.supplierSnapshot,
      qtyReceived: goodsReceiptItem.qtyReceived,
      qtyGood: goodsReceiptItem.qtyGood,
      qtyReturn: goodsReceiptItem.qtyReturn,
      returnStatus: goodsReceiptItem.returnStatus,
      goodsReceiptId: goodsReceipt.id,
      grNo: goodsReceipt.grNo,
      receivedDate: goodsReceipt.receivedDate,
      packingListId: packingList.id,
      packingListNo: packingList.packingListNo,
    })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .innerJoin(purchaseOrderItem, eq(goodsReceiptItem.purchaseOrderItemId, purchaseOrderItem.id))
    .innerJoin(purchaseOrder, eq(purchaseOrderItem.purchaseOrderId, purchaseOrder.id))
    .leftJoin(packingList, eq(goodsReceipt.packingListId, packingList.id))
    .where(and(inArray(goodsReceipt.organizationId, orgIds), ne(goodsReceipt.status, "recalled")));

  const byItem = new Map<string, SurplusRow>();
  for (const r of rows) {
    const accepted = num(r.qtyGood ?? r.qtyReceived);
    let row = byItem.get(r.poItemId);
    if (!row) {
      row = {
        purchaseOrderItemId: r.poItemId,
        organizationId: r.organizationId,
        organizationName: names.get(r.organizationId) ?? null,
        supplierId: r.supplierId,
        supplierName: (r.supplierSnapshot as { name?: string } | null)?.name ?? null,
        purchaseOrderId: r.poId,
        poNo: r.poNo,
        prNo: r.prNo,
        poStatus: r.poStatus,
        productCode: r.itemCode,
        description: r.itemDescription,
        uom: r.itemUom,
        qtyOrdered: num(r.qtyOrdered),
        qtyAccepted: 0,
        qtySurplus: 0,
        qtyPendingReturn: 0,
        receipts: [],
      };
      byItem.set(r.poItemId, row);
    }
    row.qtyAccepted += accepted;
    if (r.returnStatus === "pending") row.qtyPendingReturn += num(r.qtyReturn);
    row.receipts.push({
      goodsReceiptId: r.goodsReceiptId,
      grNo: r.grNo,
      packingListId: r.packingListId,
      packingListNo: r.packingListNo,
      receivedDate: r.receivedDate,
      qtyReceived: num(r.qtyReceived),
      qtyAccepted: accepted,
      qtyReturned: num(r.qtyReturn),
    });
  }

  return [...byItem.values()]
    .map((r) => ({ ...r, qtySurplus: r.qtyAccepted - r.qtyOrdered, receipts: r.receipts.sort((a, b) => a.receivedDate.getTime() - b.receivedDate.getTime()) }))
    .filter((r) => r.qtySurplus > 1e-9)
    .sort((a, b) => (a.poNo ?? "").localeCompare(b.poNo ?? "", undefined, { numeric: true, sensitivity: "base" }));
}
