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
  goodsReceipt, goodsReceiptItem, inspectionPhoto, organization, packingList, packingListAmendment, packingListItem,
  purchaseOrder, purchaseOrderItem, returnReplacementAttempt,
} from "@/db/schema";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { downloadUrl, extOf, IMAGE_EXTS } from "@/lib/r2/post-delivery";
import { inspectionMediaShareUrl, publicBaseUrl } from "@/lib/inspection-media-share";
import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

const num = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;

export type PendingShortPl = {
  packingListId: string; packingListNo: string; plStatus: string; createdAt: Date;
  expected: number; received: number; pending: number;
};
// A defect photo / video taken when the line was rejected at inspection.
// url: a signed link for the page; the PDF fetches images through
// /api/pending-from-supplier/photo/[id] instead (same site).
// shareUrl: a permanent, login-free link to view this one file (the same kind
// the supplier discrepancy report uses) — what the PDF's thumbnails link to.
export type PendingPhoto = { id: string; kind: "image" | "video"; url: string; shareUrl: string };
export type PendingReturn = {
  goodsReceiptId: string; grNo: string; packingListNo: string | null;
  rejected: number; outstanding: number; inspectedAt: Date | null; shippedAt: Date | null;
  photos: PendingPhoto[];
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
  // The supplier PO line's unit price and currency: only for a user with purchase-order:view-cost
  // (null otherwise, so the price never reaches the page)
  unitCost: number | null;
  currency: string | null;
  // when the oldest pending part started: PO date (not shipped), PL date (short), inspection (returns)
  since: Date;
};

// The app's public address, for share links (APP_DOMAIN in production; see publicBaseUrl)
async function shareBase(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return publicBaseUrl(new Request(`${h.get("x-forwarded-proto") ?? "http"}://${host}/`, { headers: h }));
}

// May this user see what we pay suppliers?
async function canViewCost(userId: string, orgId: string): Promise<boolean> {
  return hasAccess(await getUserPermissions(userId, orgId), "purchase-order:view-cost");
}

export async function getPendingFromSupplier(): Promise<PendingLine[]> {
  const { orgId, userId } = await requireAccess("purchase-order:read");
  return computePending([orgId], await shareBase(), await canViewCost(userId, orgId));
}

// Same, across every company the caller's owner holds.
export async function getPendingFromSupplierCentralized(): Promise<PendingLine[]> {
  const { orgId, userId } = await requireAccess("purchase-order:read:centralized");
  return computePending(await getOwnerOrgIds(orgId), await shareBase(), await canViewCost(userId, orgId));
}

async function computePending(orgIds: string[], baseUrl: string, withCost: boolean): Promise<PendingLine[]> {
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
        qtyReceived: goodsReceiptItem.qtyReceived, qtyGood: goodsReceiptItem.qtyGood, qtyReturn: goodsReceiptItem.qtyReturn, returnStatus: goodsReceiptItem.returnStatus,
        inspectedAt: goodsReceiptItem.inspectedAt, shippedAt: goodsReceiptItem.returnShippedAt,
        grPlItemId: goodsReceiptItem.packingListItemId,
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

  // Defect evidence for rejected lines: the "return" photos of the packing-list
  // line they were rejected on (a change request's photos count once approved)
  const rejectedPlItemIds = [...new Set(grRows.filter((g) => g.returnStatus === "pending" && num(g.qtyReturn) > 0 && g.grPlItemId).map((g) => g.grPlItemId!))];
  const photoRows = rejectedPlItemIds.length === 0 ? [] : (await db
    .select({ id: inspectionPhoto.id, plItemId: inspectionPhoto.packingListItemId, key: inspectionPhoto.imageKey })
    .from(inspectionPhoto)
    .leftJoin(packingListAmendment, eq(inspectionPhoto.amendmentId, packingListAmendment.id))
    .where(and(
      inArray(inspectionPhoto.packingListItemId, rejectedPlItemIds),
      eq(inspectionPhoto.category, "return"),
      or(isNull(inspectionPhoto.amendmentId), eq(packingListAmendment.status, "approved")),
    ))
    .orderBy(asc(inspectionPhoto.createdAt)));
  const photosByPlItem = new Map<string, PendingPhoto[]>();
  await Promise.all(photoRows.map(async (p) => {
    const kind = IMAGE_EXTS.includes(extOf(p.key)) ? "image" as const : "video" as const;
    const url = await downloadUrl(p.key, { video: kind === "video" && extOf(p.key) === "mov" });
    photosByPlItem.set(p.plItemId, [...(photosByPlItem.get(p.plItemId) ?? []), { id: p.id, kind, url, shareUrl: inspectionMediaShareUrl(baseUrl, p.id) }]);
  }));
  // Real replacement shipments only. Some returns record the original shipment
  // itself as attempt #1 (the attempt points at the very packing-list line the
  // units were rejected on) — that line is a normal shipment, not a replacement.
  const rejectedOnPlItem = new Map(grRows.map((g) => [g.id, g.plItemId]));
  const realAttempts = attemptRows.filter((a) => a.plItemId !== rejectedOnPlItem.get(a.grItemId));
  const replacementPlItemIds = new Set(realAttempts.map((a) => a.plItemId));
  const plNoById = new Map(plRows.map((p) => [p.plId, p.plNo]));

  const lines: PendingLine[] = [];
  for (const { po, item } of poRows) {
    const closed = !!item.shortfallClosedStatus;
    const ordered = num(item.qty);
    const myPls = plRows.filter((p) => p.poItemId === item.id && !replacementPlItemIds.has(p.plItemId));
    const myGrs = grRows.filter((g) => g.poItemId === item.id);

    // short on each packing list (only received on confirmed GRs counts)
    let shortPls: PendingShortPl[] = closed ? [] : myPls.map((p) => {
      const received = myGrs.filter((g) => g.plItemId === p.plItemId && g.grStatus === "confirmed").reduce((s, g) => s + num(g.qtyReceived), 0);
      const expected = num(p.qtyExpected);
      return { packingListId: p.plId, packingListNo: p.plNo, plStatus: p.plStatus, createdAt: p.plCreatedAt, expected, received, pending: Math.max(0, expected - received) };
    }).filter((p) => p.pending > 0);
    const onPls = myPls.reduce((s, p) => s + num(p.qtyExpected), 0);
    let qtyNotShipped = closed || po.status !== "confirmed" ? 0 : Math.max(0, ordered - onPls);

    // rejected, returned and not yet replaced by good units
    // A rejection on a replacement shipment isn't counted again: the original
    // return it was replacing still owes those units (rejected − good replacements).
    let returns: PendingReturn[] = myGrs
      .filter((g) => g.returnStatus === "pending" && num(g.qtyReturn) > 0 && !(g.plItemId && replacementPlItemIds.has(g.plItemId)))
      .map((g) => {
        const good = realAttempts.filter((a) => a.grItemId === g.id && a.status === "inspected").reduce((s, a) => s + num(a.qtyGood), 0);
        return {
          goodsReceiptId: g.grId, grNo: g.grNo, packingListNo: g.grPlId ? (plNoById.get(g.grPlId) ?? null) : null,
          rejected: num(g.qtyReturn), outstanding: Math.max(0, num(g.qtyReturn) - good), inspectedAt: g.inspectedAt, shippedAt: g.shippedAt,
          photos: g.grPlItemId ? (photosByPlItem.get(g.grPlItemId) ?? []) : [],
        };
      })
      .filter((r) => r.outstanding > 0);

    // Never more than the supplier can still owe: ordered − good units accepted.
    // When the parts add up to more (a later packing list re-sent what an
    // earlier one was short of; extra units arrived and were rejected), take
    // the excess off "short" first (oldest packing list first), then "not
    // shipped", then "awaiting replacement".
    const accepted = myGrs.filter((g) => g.grStatus === "confirmed").reduce((s, g) => s + num(g.qtyGood ?? g.qtyReceived), 0);
    const owed = Math.max(0, ordered - accepted);
    let excess = qtyNotShipped + shortPls.reduce((s, p) => s + p.pending, 0) + returns.reduce((s, r) => s + r.outstanding, 0) - owed;
    if (excess > 0) {
      shortPls = [...shortPls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((p) => {
        const cut = Math.min(p.pending, excess); excess -= cut; return { ...p, pending: p.pending - cut };
      }).filter((p) => p.pending > 0);
      const cutNs = Math.min(qtyNotShipped, excess); qtyNotShipped -= cutNs; excess -= cutNs;
      returns = [...returns].reverse().map((r) => {
        const cut = Math.min(r.outstanding, excess); excess -= cut; return { ...r, outstanding: r.outstanding - cut };
      }).reverse().filter((r) => r.outstanding > 0);
    }

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
      unitCost: withCost ? num(item.unitPrice) : null,
      currency: withCost ? (item.currency || "MYR") : null,
      since: new Date(Math.min(...sinceDates.map((d) => new Date(d).getTime()))),
    });
  }
  return lines.sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.since.getTime() - b.since.getTime());
}
