"use server";

import { db } from "@/db";
import {
  packingList,
  packingListItem,
  packingListCounter,
  purchaseOrder,
  purchaseOrderItem,
  goodsReceipt,
  goodsReceiptItem,
  supplier,
  user,
  member,
  organization,
  organizationProfile,
  inspectionPhoto,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, asc, desc, inArray, ne, isNull } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { revalidatePath } from "next/cache";
import { createGoodsReceipt, type GoodsReceiptItemInput } from "@/server/goods-receipt";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertSelfActionAllowed } from "@/lib/approvals/guard";
import { isSelfActionAllowed } from "@/server/approval-settings";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
const PROCUREMENT_DOCS_BUCKET = process.env.R2_PROCUREMENT_IMAGES_BUCKET!;
// Separate, dedicated bucket for inspection photos — distinct from the
// packing-list item images carried over from the source PO.
const ITEM_INSPECTIONS_BUCKET = process.env.R2_ITEM_INSPECTIONS_BUCKET!;

// ── Auth helpers ────────────────────────────────────────────────────────────

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { session, orgId, userId };
}

// For actions restricted to the organization owner regardless of any
// individually granted permission — e.g. hard-deleting a packing list.
async function requireOwner() {
  const { session, orgId, userId } = await getSession();
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!m || m.role !== "owner") throw new Error("Only the organization owner can do this");
  return { session, orgId, userId };
}

// Every org owned by the same owner as the caller's active org — see the
// identical pattern duplicated per-file in server/purchase-order.ts etc.
async function getOwnerOrgIds(orgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerMember) return [orgId];
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")));
  const ids = [...new Set(owned.map((m) => m.organizationId))];
  return ids.length > 0 ? ids : [orgId];
}

// ── Running number ──────────────────────────────────────────────────────────

async function generatePackingListNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "pl");
  const year = new Date().getFullYear();
  const existing = await db
    .select()
    .from(packingListCounter)
    .where(eq(packingListCounter.organizationId, orgId))
    .limit(1);
  let nextNo: number;
  if (existing.length === 0) {
    await db.insert(packingListCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db
      .update(packingListCounter)
      .set({ year, lastNumber: nextNo })
      .where(eq(packingListCounter.organizationId, orgId));
  }
  return buildDocumentNo(cfg, year, nextNo);
}

// ── Types ───────────────────────────────────────────────────────────────────

export type PackingListRow = typeof packingList.$inferSelect;
export type PackingListItemRow = typeof packingListItem.$inferSelect;
export type PackingListItemEnriched = PackingListItemRow & {
  imageUrl: string | null;
  draftInspectedByName: string | null;
  draftApprovedByName: string | null;
  photos: InspectionPhoto[];
};

export interface PackingListItemInput {
  purchaseOrderId: string;
  purchaseOrderItemId: string;
  productId?: string;
  productCode?: string;
  description?: string;
  qtyExpected: string;
  uom?: string;
  unitPrice?: string;
  currency?: string;
  sourcingType?: string;
  designBrandName?: string;
  designBrandCode?: string;
  privateLabelCode?: string;
  imageKey?: string;
  designBrandSource?: string;
  privateLabelSource?: string;
  oemEditedBy?: string;
  descriptionSource?: string;
  isAdditional?: boolean;
  editedBy?: string;
  setGroupId?: string;
  setGroupLabel?: string;
  customerId?: string;
  customerOrganizationId?: string;
  customerName?: string;
  customerOrganization?: string;
  customerPoNo?: string;
}

export interface CreatePackingListInput {
  supplierId: string;
  supplierRefNo?: string;
  expectedDate?: Date;
  notes?: string;
  items: PackingListItemInput[];
}

export type PackingListWithItems = PackingListRow & {
  items: PackingListItemEnriched[];
  createdByName: string | null;
  goodsReceipts: { id: string; grNo: string; purchaseOrderId: string; poNo: string | null; status: string }[];
  purchaseOrders: { id: string; poNo: string | null; prNo: string | null }[];
};

export type PackingListListRow = PackingListRow & {
  createdByName: string | null;
  supplierName: string | null;
  itemCount: number;
};
// isOwnOrg: true when this packing list belongs to the caller's own active
// org — the inspect/cancel actions stay available to the same permission
// holders as usual for those; for a sibling org's packing list, the caller
// gets view-only (switching active org and using the regular flow is the
// path to act on it, matching how the app's org-switcher already works).
export type CentralizedPackingList = PackingListListRow & { organizationName: string; isOwnOrg: boolean; canInspect: boolean };
export type CentralizedPackingListWithItems = PackingListWithItems & { organizationName: string; isOwnOrg: boolean; businessType: string; canInspect: boolean };

export type PackableSupplier = { id: string; name: string; poCount: number };

export type PackableItem = {
  purchaseOrderId: string;
  poNo: string | null;
  prNo: string | null;
  purchaseOrderItemId: string;
  productId: string | null;
  productCode: string | null;
  description: string | null;
  uom: string | null;
  unitPrice: string | null;
  currency: string | null;
  qtyOrdered: string;
  qtyRemaining: number;
  sourcingType: string | null;
  designBrandName: string | null;
  designBrandCode: string | null;
  privateLabelCode: string | null;
  imageKey: string | null;
  imageUrl: string | null;
  designBrandSource: string | null;
  privateLabelSource: string | null;
  oemEditedBy: string | null;
  descriptionSource: string | null;
  isAdditional: boolean;
  editedBy: string | null;
  setGroupId: string | null;
  setGroupLabel: string | null;
  customerId: string | null;
  customerOrganizationId: string | null;
  customerName: string | null;
  customerOrganization: string | null;
  customerPoNo: string | null;
};

export type PendingPackingListPo = {
  purchaseOrderId: string;
  poNo: string | null;
  prNo: string | null;
  supplierId: string | null;
  supplierName: string | null;
  itemsRemaining: number;
  qtyRemaining: number;
  confirmedAt: Date | null;
};

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getSuppliersWithConfirmedPos(): Promise<PackableSupplier[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const pos = await db
    .select({ supplierId: purchaseOrder.supplierId })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.status, "confirmed")));

  const counts: Record<string, number> = {};
  for (const p of pos) {
    if (!p.supplierId) continue;
    counts[p.supplierId] = (counts[p.supplierId] ?? 0) + 1;
  }
  const supplierIds = Object.keys(counts);
  if (supplierIds.length === 0) return [];

  const suppliers = await db
    .select({ id: supplier.id, name: supplier.name })
    .from(supplier)
    .where(inArray(supplier.id, supplierIds));

  return suppliers
    .map((s) => ({ id: s.id, name: s.name, poCount: counts[s.id] ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPackableItemsForSupplier(supplierId: string): Promise<PackableItem[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const pos = await db
    .select()
    .from(purchaseOrder)
    .where(and(
      eq(purchaseOrder.organizationId, orgId),
      eq(purchaseOrder.supplierId, supplierId),
      eq(purchaseOrder.status, "confirmed"),
    ));
  if (pos.length === 0) return [];
  const poIds = pos.map((p) => p.id);
  const poMap = Object.fromEntries(pos.map((p) => [p.id, p]));

  const items = await db
    .select()
    .from(purchaseOrderItem)
    .where(inArray(purchaseOrderItem.purchaseOrderId, poIds))
    .orderBy(asc(purchaseOrderItem.rowNo));
  if (items.length === 0) return [];
  const itemIds = items.map((i) => i.id);

  const [grItems, plItems] = await Promise.all([
    // qtyGood, not qtyReceived — an item sent back to the supplier (qtyReturn)
    // was never actually kept, so it must NOT count toward "already fulfilled"
    // or the supplier's replacement shipment would show zero qty remaining to
    // pack. Falls back to qtyReceived for the plain direct-GR flow, which has
    // no inspection split (qtyGood is null there). Recalled GRs are excluded
    // entirely — a reversed receipt shouldn't reserve against the PO either.
    db.select({ purchaseOrderItemId: goodsReceiptItem.purchaseOrderItemId, qtyGood: goodsReceiptItem.qtyGood, qtyReceived: goodsReceiptItem.qtyReceived })
      .from(goodsReceiptItem)
      .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
      .where(and(inArray(goodsReceiptItem.purchaseOrderItemId, itemIds), ne(goodsReceipt.status, "recalled"))),
    db.select({ purchaseOrderItemId: packingListItem.purchaseOrderItemId, qtyExpected: packingListItem.qtyExpected })
      .from(packingListItem)
      .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
      .where(and(inArray(packingListItem.purchaseOrderItemId, itemIds), eq(packingList.status, "pending"))),
  ]);

  const receivedByItem: Record<string, number> = {};
  for (const gi of grItems) {
    if (!gi.purchaseOrderItemId) continue;
    const accepted = parseFloat(gi.qtyGood ?? gi.qtyReceived ?? "0") || 0;
    receivedByItem[gi.purchaseOrderItemId] = (receivedByItem[gi.purchaseOrderItemId] ?? 0) + accepted;
  }
  const reservedByItem: Record<string, number> = {};
  for (const pi of plItems) {
    reservedByItem[pi.purchaseOrderItemId] = (reservedByItem[pi.purchaseOrderItemId] ?? 0) + (parseFloat(pi.qtyExpected ?? "0") || 0);
  }

  const result = await Promise.all(
    items.map(async (item) => {
      const ordered = parseFloat(item.qty ?? "0") || 0;
      // Written off = the business has stopped chasing this shortfall, so it
      // shouldn't be offered for packing even though qty math alone would
      // still show it as remaining.
      const remaining = item.shortfallClosedStatus ? 0 : ordered - (receivedByItem[item.id] ?? 0) - (reservedByItem[item.id] ?? 0);
      const po = poMap[item.purchaseOrderId];
      let imageUrl: string | null = null;
      if (item.imageKey) {
        try {
          const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: item.imageKey });
          imageUrl = await getSignedUrl(s3, cmd, { expiresIn: 7200 });
        } catch {}
      }
      return {
        purchaseOrderId: item.purchaseOrderId,
        poNo: po?.poNo ?? null,
        prNo: po?.prNo ?? null,
        purchaseOrderItemId: item.id,
        productId: item.productId,
        productCode: item.productCode,
        description: item.description,
        uom: item.uom,
        unitPrice: item.unitPrice,
        currency: item.currency,
        qtyOrdered: item.qty,
        qtyRemaining: remaining,
        sourcingType: item.sourcingType,
        designBrandName: item.designBrandName,
        designBrandCode: item.designBrandCode,
        privateLabelCode: item.privateLabelCode,
        imageKey: item.imageKey,
        imageUrl,
        designBrandSource: item.designBrandSource,
        privateLabelSource: item.privateLabelSource,
        oemEditedBy: item.oemEditedBy,
        descriptionSource: item.descriptionSource,
        isAdditional: item.isAdditional,
        editedBy: item.editedBy,
        setGroupId: item.setGroupId,
        setGroupLabel: item.setGroupLabel,
        customerId: item.customerId,
        customerOrganizationId: item.customerOrganizationId,
        customerName: item.customerName,
        customerOrganization: item.customerOrganization,
        customerPoNo: item.customerPoNo,
      };
    }),
  );

  return result.filter((i) => i.qtyRemaining > 0);
}

export type SupplierOutstandingIssue = { packingListId: string; packingListNo: string; itemCount: number };

// Prior COMPLETED packing lists for this supplier that had a short-received
// or returned-to-supplier line — surfaced as a banner on the "New Packing
// List" page so it's obvious a new shipment is (at least partly) resolving
// an earlier problem, not just a fresh unexplained order. Doesn't try to
// determine whether a later receipt already fully resolved the shortfall —
// getPackableItemsForSupplier's qtyRemaining is what actually gates whether
// the item can be packed again; this is purely an informational pointer.
export async function getSupplierOutstandingIssues(supplierId: string): Promise<SupplierOutstandingIssue[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const rows = await db
    .select({
      packingListId: packingList.id,
      packingListNo: packingList.packingListNo,
      qtyExpected: packingListItem.qtyExpected,
      draftQtyReceived: packingListItem.draftQtyReceived,
      draftQtyReturn: packingListItem.draftQtyReturn,
    })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(and(
      eq(packingList.organizationId, orgId),
      eq(packingList.supplierId, supplierId),
      eq(packingList.status, "completed"),
    ));

  const byPl = new Map<string, SupplierOutstandingIssue>();
  for (const r of rows) {
    const expected = parseFloat(r.qtyExpected) || 0;
    const received = parseFloat(r.draftQtyReceived ?? r.qtyExpected) || 0;
    const returned = parseFloat(r.draftQtyReturn ?? "0") || 0;
    if (received < expected || returned > 0) {
      const bucket = byPl.get(r.packingListId) ?? { packingListId: r.packingListId, packingListNo: r.packingListNo, itemCount: 0 };
      bucket.itemCount += 1;
      byPl.set(r.packingListId, bucket);
    }
  }

  return [...byPl.values()];
}

export type PendingReturnForSupplier = {
  goodsReceiptItemId: string;
  qty: number;
  uom: string | null;
  productCode: string | null;
  description: string | null;
  grNo: string | null;
  poNo: string | null;
};

// Still-open (returnStatus "pending") return-to-supplier lines for this
// supplier, regardless of which PO or packing list they came from — surfaced
// on the inspect page of a NEW packing list so the person receiving it can
// notice "oh, this is the replacement for that" and link the two in one
// click, instead of only discovering the connection later via the separate
// Outstanding Issues panel (by which point they've forgotten the shipment
// in front of them was the replacement). Unlike getSupplierOutstandingIssues
// above, this checks resolution state directly since it drives an action
// (resolveReceiptItemAction), not just a pointer.
// targetOrgId mirrors getPackingListsForSupplier below — needed when the
// inspect page is the centralized (cross-org) flow, where the packing list
// being inspected belongs to a different org than the caller's active one.
export async function getPendingReturnsForSupplier(supplierId: string, targetOrgId?: string): Promise<PendingReturnForSupplier[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  let scopedOrgId = orgId;
  if (targetOrgId && targetOrgId !== orgId) {
    const ownerOrgIds = await getOwnerOrgIds(orgId);
    if (!ownerOrgIds.includes(targetOrgId)) throw new Error("You don't have permission to view returns for that organization");
    scopedOrgId = targetOrgId;
  }

  const rows = await db
    .select({
      id: goodsReceiptItem.id,
      qtyReturn: goodsReceiptItem.qtyReturn,
      uom: goodsReceiptItem.uom,
      productCode: goodsReceiptItem.productCode,
      description: goodsReceiptItem.description,
      grNo: goodsReceipt.grNo,
      poNo: purchaseOrder.poNo,
    })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .innerJoin(purchaseOrder, eq(goodsReceipt.purchaseOrderId, purchaseOrder.id))
    .where(and(
      eq(goodsReceipt.organizationId, scopedOrgId),
      eq(purchaseOrder.supplierId, supplierId),
      eq(goodsReceiptItem.returnStatus, "pending"),
      ne(goodsReceipt.status, "recalled"),
    ));

  return rows.map((r) => ({
    goodsReceiptItemId: r.id,
    qty: parseFloat(r.qtyReturn ?? "0") || 0,
    uom: r.uom,
    productCode: r.productCode,
    description: r.description,
    grNo: r.grNo,
    poNo: r.poNo,
  }));
}

// Confirmed POs that still have items with nothing packed for them yet
// (ordered qty not fully covered by receipts or pending packing lists) — the
// "still needs a packing list" queue, shown on the Packing Lists page above
// the list of packing lists that already exist.
export async function getPurchaseOrdersPendingPacking(): Promise<PendingPackingListPo[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const pos = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.status, "confirmed")));
  if (pos.length === 0) return [];
  const poIds = pos.map((p) => p.id);
  const poMap = Object.fromEntries(pos.map((p) => [p.id, p]));

  const items = await db
    .select()
    .from(purchaseOrderItem)
    .where(inArray(purchaseOrderItem.purchaseOrderId, poIds))
    .orderBy(asc(purchaseOrderItem.rowNo));
  if (items.length === 0) return [];
  const itemIds = items.map((i) => i.id);

  const supplierIds = [...new Set(pos.map((p) => p.supplierId).filter((id): id is string => !!id))];

  const [grItems, plItems, suppliers] = await Promise.all([
    // See getPackableItemsForSupplier above — qtyGood (not qtyReceived) so a
    // returned-to-supplier qty still shows up as remaining to pack, and
    // recalled GRs don't reserve against the PO.
    db.select({ purchaseOrderItemId: goodsReceiptItem.purchaseOrderItemId, qtyGood: goodsReceiptItem.qtyGood, qtyReceived: goodsReceiptItem.qtyReceived })
      .from(goodsReceiptItem)
      .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
      .where(and(inArray(goodsReceiptItem.purchaseOrderItemId, itemIds), ne(goodsReceipt.status, "recalled"))),
    db.select({ purchaseOrderItemId: packingListItem.purchaseOrderItemId, qtyExpected: packingListItem.qtyExpected })
      .from(packingListItem)
      .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
      .where(and(inArray(packingListItem.purchaseOrderItemId, itemIds), eq(packingList.status, "pending"))),
    supplierIds.length > 0
      ? db.select({ id: supplier.id, name: supplier.name }).from(supplier).where(inArray(supplier.id, supplierIds))
      : Promise.resolve([]),
  ]);

  const receivedByItem: Record<string, number> = {};
  for (const gi of grItems) {
    if (!gi.purchaseOrderItemId) continue;
    const accepted = parseFloat(gi.qtyGood ?? gi.qtyReceived ?? "0") || 0;
    receivedByItem[gi.purchaseOrderItemId] = (receivedByItem[gi.purchaseOrderItemId] ?? 0) + accepted;
  }
  const reservedByItem: Record<string, number> = {};
  for (const pi of plItems) {
    reservedByItem[pi.purchaseOrderItemId] = (reservedByItem[pi.purchaseOrderItemId] ?? 0) + (parseFloat(pi.qtyExpected ?? "0") || 0);
  }
  const supplierMap = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  const byPo: Record<string, { itemsRemaining: number; qtyRemaining: number }> = {};
  for (const item of items) {
    if (item.shortfallClosedStatus) continue;
    const ordered = parseFloat(item.qty ?? "0") || 0;
    const remaining = ordered - (receivedByItem[item.id] ?? 0) - (reservedByItem[item.id] ?? 0);
    if (remaining > 0) {
      const bucket = (byPo[item.purchaseOrderId] ??= { itemsRemaining: 0, qtyRemaining: 0 });
      bucket.itemsRemaining += 1;
      bucket.qtyRemaining += remaining;
    }
  }

  return Object.entries(byPo)
    .map(([poId, agg]) => {
      const po = poMap[poId];
      return {
        purchaseOrderId: poId,
        poNo: po?.poNo ?? null,
        prNo: po?.prNo ?? null,
        supplierId: po?.supplierId ?? null,
        supplierName: po?.supplierId ? supplierMap[po.supplierId] ?? null : null,
        itemsRemaining: agg.itemsRemaining,
        qtyRemaining: agg.qtyRemaining,
        confirmedAt: po?.createdAt ?? null,
      };
    })
    .sort((a, b) => (a.poNo ?? "").localeCompare(b.poNo ?? ""));
}

export async function getAllPackingLists(): Promise<PackingListListRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const lists = await db
    .select()
    .from(packingList)
    .where(eq(packingList.organizationId, orgId))
    .orderBy(desc(packingList.createdAt));
  if (lists.length === 0) return [];

  const userIds = [...new Set(lists.map((l) => l.createdBy))];
  const listIds = lists.map((l) => l.id);

  const [users, items] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
    db.select({ packingListId: packingListItem.packingListId }).from(packingListItem).where(inArray(packingListItem.packingListId, listIds)),
  ]);

  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const itemCounts: Record<string, number> = {};
  for (const it of items) itemCounts[it.packingListId] = (itemCounts[it.packingListId] ?? 0) + 1;

  return lists.map((l) => {
    const snap = l.supplierSnapshot as { name?: string } | null;
    return {
      ...l,
      createdByName: userMap[l.createdBy] ?? null,
      supplierName: snap?.name ?? null,
      itemCount: itemCounts[l.id] ?? 0,
    };
  });
}

export async function getPackingListDetail(id: string): Promise<PackingListWithItems | null> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [pl] = await db
    .select()
    .from(packingList)
    .where(and(eq(packingList.id, id), eq(packingList.organizationId, orgId)));
  if (!pl) return null;

  const [items, userRows, grs] = await Promise.all([
    db.select().from(packingListItem).where(eq(packingListItem.packingListId, id)).orderBy(asc(packingListItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, pl.createdBy)),
    db.select({ id: goodsReceipt.id, grNo: goodsReceipt.grNo, purchaseOrderId: goodsReceipt.purchaseOrderId, status: goodsReceipt.status })
      .from(goodsReceipt)
      .where(eq(goodsReceipt.packingListId, id)),
  ]);

  const poIds = [...new Set([...grs.map((g) => g.purchaseOrderId), ...items.map((i) => i.purchaseOrderId)])];
  const poRows = poIds.length > 0
    ? await db.select({ id: purchaseOrder.id, poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo }).from(purchaseOrder).where(inArray(purchaseOrder.id, poIds))
    : [];
  const poNoMap = Object.fromEntries(poRows.map((p) => [p.id, p.poNo]));
  const nameMap = await getUserNameMap(items.flatMap((i) => [i.draftInspectedBy, i.draftApprovedBy]));
  const photosByItem = await getPhotosForItems(items.map((i) => i.id));

  const enrichedItems: PackingListItemEnriched[] = await Promise.all(
    items.map(async (i) => {
      let imageUrl: string | null = null;
      if (i.imageKey) {
        try {
          const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: i.imageKey });
          imageUrl = await getSignedUrl(s3, cmd, { expiresIn: 7200 });
        } catch {}
      }
      return {
        ...i,
        imageUrl,
        draftInspectedByName: i.draftInspectedBy ? (nameMap.get(i.draftInspectedBy) ?? null) : null,
        draftApprovedByName: i.draftApprovedBy ? (nameMap.get(i.draftApprovedBy) ?? null) : null,
        photos: photosByItem.get(i.id) ?? [],
      };
    }),
  );

  return {
    ...pl,
    items: enrichedItems,
    createdByName: userRows[0]?.name ?? null,
    goodsReceipts: grs.map((g) => ({ ...g, poNo: poNoMap[g.purchaseOrderId] ?? null })),
    purchaseOrders: poRows,
  };
}

// Shared by getPackingListDetail/Centralized to resolve who's currently
// shown as "last inspected by" / "approved by" per line — collected once per
// distinct user across all items rather than N+1 per row.
async function getUserNameMap(userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// Cross-org view for members explicitly granted purchase-order:read:centralized
// (packing list reads already ride on purchase-order:read org-scoped, so
// centralized reads ride on its centralized counterpart too) — every
// packing list recorded under any org the same owner controls.
export async function getPackingListsCentralized(): Promise<CentralizedPackingList[]> {
  const { orgId, userId } = await requireAccess("packing-list:read:centralized");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const rows = await db
    .select({ pl: packingList, organizationName: organization.name })
    .from(packingList)
    .innerJoin(organization, eq(organization.id, packingList.organizationId))
    .where(inArray(packingList.organizationId, ownerOrgIds))
    .orderBy(desc(packingList.createdAt));
  if (rows.length === 0) return [];

  const listIds = rows.map((r) => r.pl.id);
  const [users, items] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(rows.map((r) => r.pl.createdBy))])),
    db.select({ packingListId: packingListItem.packingListId }).from(packingListItem).where(inArray(packingListItem.packingListId, listIds)),
  ]);
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const itemCounts: Record<string, number> = {};
  for (const it of items) itemCounts[it.packingListId] = (itemCounts[it.packingListId] ?? 0) + 1;

  // Resolve inspect rights once per distinct org among the results (not once
  // per row) to avoid N+1 permission fetches.
  const callerPerms = await getUserPermissions(userId, orgId);
  const distinctOtherOrgIds = [...new Set(rows.map((r) => r.pl.organizationId))].filter((oid) => oid !== orgId);
  const otherOrgPermsEntries = await Promise.all(
    distinctOtherOrgIds.map(async (oid) => [oid, await getUserPermissions(userId, oid)] as const),
  );
  const orgPermsMap = new Map<string, string[]>([[orgId, callerPerms], ...otherOrgPermsEntries]);
  const hasCentralizedInspect = hasAccess(callerPerms, "packing-list:inspect:centralized");

  return rows.map(({ pl, organizationName }) => {
    const snap = pl.supplierSnapshot as { name?: string } | null;
    return {
      ...pl,
      createdByName: userMap[pl.createdBy] ?? null,
      supplierName: snap?.name ?? null,
      itemCount: itemCounts[pl.id] ?? 0,
      organizationName,
      isOwnOrg: pl.organizationId === orgId,
      canInspect: hasCentralizedInspect || hasAccess(orgPermsMap.get(pl.organizationId) ?? [], "packing-list:inspect"),
    };
  });
}

// Same detail as getPackingListDetail, but resolvable across every org the
// caller's owner controls — for members explicitly granted
// purchase-order:read:centralized. Cancelling still only works when it's the
// caller's own active org (isOwnOrg); inspecting works whenever canInspect is
// true — see CentralizedPackingList.
export async function getPackingListDetailCentralized(id: string): Promise<CentralizedPackingListWithItems | null> {
  const { orgId, userId } = await requireAccess("packing-list:read:centralized");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const [row] = await db
    .select({ pl: packingList, organizationName: organization.name, businessType: organizationProfile.businessType })
    .from(packingList)
    .innerJoin(organization, eq(organization.id, packingList.organizationId))
    .leftJoin(organizationProfile, eq(organizationProfile.organizationId, packingList.organizationId))
    .where(and(eq(packingList.id, id), inArray(packingList.organizationId, ownerOrgIds)));
  if (!row) return null;
  const { pl, organizationName, businessType } = row;

  const [items, userRows, grs] = await Promise.all([
    db.select().from(packingListItem).where(eq(packingListItem.packingListId, id)).orderBy(asc(packingListItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, pl.createdBy)),
    db.select({ id: goodsReceipt.id, grNo: goodsReceipt.grNo, purchaseOrderId: goodsReceipt.purchaseOrderId, status: goodsReceipt.status })
      .from(goodsReceipt)
      .where(eq(goodsReceipt.packingListId, id)),
  ]);

  const poIds = [...new Set([...grs.map((g) => g.purchaseOrderId), ...items.map((i) => i.purchaseOrderId)])];
  const poRows = poIds.length > 0
    ? await db.select({ id: purchaseOrder.id, poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo }).from(purchaseOrder).where(inArray(purchaseOrder.id, poIds))
    : [];
  const poNoMap = Object.fromEntries(poRows.map((p) => [p.id, p.poNo]));
  const nameMap = await getUserNameMap(items.flatMap((i) => [i.draftInspectedBy, i.draftApprovedBy]));
  const photosByItem = await getPhotosForItems(items.map((i) => i.id));

  const enrichedItems: PackingListItemEnriched[] = await Promise.all(
    items.map(async (i) => {
      let imageUrl: string | null = null;
      if (i.imageKey) {
        try {
          const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: i.imageKey });
          imageUrl = await getSignedUrl(s3, cmd, { expiresIn: 7200 });
        } catch {}
      }
      return {
        ...i,
        imageUrl,
        draftInspectedByName: i.draftInspectedBy ? (nameMap.get(i.draftInspectedBy) ?? null) : null,
        draftApprovedByName: i.draftApprovedBy ? (nameMap.get(i.draftApprovedBy) ?? null) : null,
        photos: photosByItem.get(i.id) ?? [],
      };
    }),
  );

  const callerPerms = await getUserPermissions(userId, orgId);
  const targetPerms = pl.organizationId === orgId ? callerPerms : await getUserPermissions(userId, pl.organizationId);
  const canInspect = hasAccess(callerPerms, "packing-list:inspect:centralized") || hasAccess(targetPerms, "packing-list:inspect");

  return {
    ...pl,
    items: enrichedItems,
    createdByName: userRows[0]?.name ?? null,
    goodsReceipts: grs.map((g) => ({ ...g, poNo: poNoMap[g.purchaseOrderId] ?? null })),
    purchaseOrders: poRows,
    organizationName,
    isOwnOrg: pl.organizationId === orgId,
    businessType: businessType ?? "trading",
    canInspect,
  };
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function createPackingList(input: CreatePackingListInput): Promise<PackingListRow> {
  const { orgId, userId } = await requireAccess("packing-list:create");

  if (input.items.length === 0) throw new Error("Add at least one item");

  const [sup] = await db
    .select()
    .from(supplier)
    .where(and(eq(supplier.id, input.supplierId), eq(supplier.organizationId, orgId)));
  if (!sup) throw new Error("Supplier not found");

  // Re-validate remaining quantity server-side rather than trusting the client
  const itemIds = [...new Set(input.items.map((i) => i.purchaseOrderItemId))];
  const poItems = await db.select().from(purchaseOrderItem).where(inArray(purchaseOrderItem.id, itemIds));
  const poItemMap = Object.fromEntries(poItems.map((i) => [i.id, i]));

  const [grItems, plItems] = await Promise.all([
    // qtyGood (not qtyReceived) and recalled GRs excluded — same reasoning as
    // getPackableItemsForSupplier above: a returned-to-supplier qty was never
    // actually kept, so it must still show as remaining, or this exact
    // re-validation rejects the very re-pack it's supposed to allow.
    db.select({ purchaseOrderItemId: goodsReceiptItem.purchaseOrderItemId, qtyGood: goodsReceiptItem.qtyGood, qtyReceived: goodsReceiptItem.qtyReceived })
      .from(goodsReceiptItem)
      .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
      .where(and(inArray(goodsReceiptItem.purchaseOrderItemId, itemIds), ne(goodsReceipt.status, "recalled"))),
    db.select({ purchaseOrderItemId: packingListItem.purchaseOrderItemId, qtyExpected: packingListItem.qtyExpected })
      .from(packingListItem)
      .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
      .where(and(inArray(packingListItem.purchaseOrderItemId, itemIds), eq(packingList.status, "pending"))),
  ]);
  const receivedByItem: Record<string, number> = {};
  for (const gi of grItems) {
    if (!gi.purchaseOrderItemId) continue;
    const accepted = parseFloat(gi.qtyGood ?? gi.qtyReceived ?? "0") || 0;
    receivedByItem[gi.purchaseOrderItemId] = (receivedByItem[gi.purchaseOrderItemId] ?? 0) + accepted;
  }
  const reservedByItem: Record<string, number> = {};
  for (const pi of plItems) {
    reservedByItem[pi.purchaseOrderItemId] = (reservedByItem[pi.purchaseOrderItemId] ?? 0) + (parseFloat(pi.qtyExpected ?? "0") || 0);
  }

  for (const item of input.items) {
    const poItem = poItemMap[item.purchaseOrderItemId];
    if (!poItem) throw new Error("One of the selected items no longer exists");
    const ordered = parseFloat(poItem.qty ?? "0") || 0;
    const remaining = poItem.shortfallClosedStatus ? 0 : ordered - (receivedByItem[item.purchaseOrderItemId] ?? 0) - (reservedByItem[item.purchaseOrderItemId] ?? 0);
    const qty = parseFloat(item.qtyExpected) || 0;
    if (qty <= 0) throw new Error(`Quantity for ${poItem.productCode ?? "an item"} must be greater than 0`);
    if (qty > remaining + 1e-9) {
      throw new Error(`Quantity for ${poItem.productCode ?? "an item"} exceeds what's remaining to pack (${remaining})`);
    }
  }

  const packingListNo = await generatePackingListNo(orgId);

  const [pl] = await db
    .insert(packingList)
    .values({
      id: nanoid(),
      organizationId: orgId,
      packingListNo,
      supplierId: input.supplierId,
      supplierSnapshot: { name: sup.name, address: sup.address ?? undefined, contactPerson: sup.contactPerson ?? undefined, contactNo: sup.contactNo ?? undefined, email: sup.email ?? undefined },
      supplierRefNo: input.supplierRefNo ?? null,
      expectedDate: input.expectedDate ?? null,
      notes: input.notes ?? null,
      createdBy: userId,
    })
    .returning();

  await db.insert(packingListItem).values(
    input.items.map((item, rowNo) => ({
      id: nanoid(),
      packingListId: pl.id,
      rowNo,
      purchaseOrderId: item.purchaseOrderId,
      purchaseOrderItemId: item.purchaseOrderItemId,
      productId: item.productId ?? null,
      productCode: item.productCode ?? null,
      description: item.description ?? null,
      qtyExpected: item.qtyExpected,
      uom: item.uom ?? null,
      unitPrice: item.unitPrice ?? "0",
      currency: item.currency ?? "MYR",
      sourcingType: item.sourcingType ?? null,
      designBrandName: item.designBrandName ?? null,
      designBrandCode: item.designBrandCode ?? null,
      privateLabelCode: item.privateLabelCode ?? null,
      imageKey: item.imageKey ?? null,
      designBrandSource: item.designBrandSource ?? null,
      privateLabelSource: item.privateLabelSource ?? null,
      oemEditedBy: item.oemEditedBy ?? null,
      descriptionSource: item.descriptionSource ?? null,
      isAdditional: item.isAdditional ?? false,
      editedBy: item.editedBy ?? null,
      setGroupId: item.setGroupId ?? null,
      setGroupLabel: item.setGroupLabel ?? null,
      customerId: item.customerId ?? null,
      customerOrganizationId: item.customerOrganizationId ?? null,
      customerName: item.customerName ?? null,
      customerOrganization: item.customerOrganization ?? null,
      customerPoNo: item.customerPoNo ?? null,
    })),
  );

  revalidatePath("/dashboard/procurement/packing-list");
  return pl;
}

export interface CompleteInspectionInput {
  receivedDate: Date;
  notes?: string;
}

// Shared by every entry point below that touches an in-progress inspection —
// resolves whether the caller may inspect a packing list belonging to
// plOrgId, given their own active org. Own-org just needs packing-list:inspect;
// cross-org needs either the dedicated packing-list:inspect:centralized
// grant, or packing-list:inspect evaluated specifically in the packing
// list's own org (which itself falls back to sibling-org role resolution,
// same mechanism as canEditPoAcrossOrgs in server/purchase-order.ts).
async function assertCanInspectPackingList(plOrgId: string, callerOrgId: string, userId: string): Promise<void> {
  if (plOrgId === callerOrgId) {
    const perms = await getUserPermissions(userId, callerOrgId);
    if (!hasAccess(perms, "packing-list:inspect")) throw new Error("You don't have permission to do this");
    return;
  }
  const ownerOrgIds = await getOwnerOrgIds(callerOrgId);
  if (!ownerOrgIds.includes(plOrgId)) throw new Error("You don't have permission to do this");
  const callerPerms = await getUserPermissions(userId, callerOrgId);
  const targetPerms = await getUserPermissions(userId, plOrgId);
  if (!hasAccess(callerPerms, "packing-list:inspect:centralized") && !hasAccess(targetPerms, "packing-list:inspect")) {
    throw new Error("You don't have permission to do this");
  }
}

// Same shape as assertCanInspectPackingList above, but for the approval
// stage. Own-org just needs packing-list:approve (the Org-Approvals-managed
// key, with its self-action-allowed setting); cross-org needs either the
// dedicated packing-list:approve:centralized grant (a plain permission,
// managed at /dashboard/admin/permissions like inspect:centralized — not
// part of the Org Approvals self-action system), or packing-list:approve
// evaluated specifically in the packing list's own org.
async function assertCanApprovePackingList(plOrgId: string, callerOrgId: string, userId: string): Promise<void> {
  if (plOrgId === callerOrgId) {
    const perms = await getUserPermissions(userId, callerOrgId);
    if (!hasAccess(perms, "packing-list:approve")) throw new Error("You don't have permission to do this");
    return;
  }
  const ownerOrgIds = await getOwnerOrgIds(callerOrgId);
  if (!ownerOrgIds.includes(plOrgId)) throw new Error("You don't have permission to do this");
  const callerPerms = await getUserPermissions(userId, callerOrgId);
  const targetPerms = await getUserPermissions(userId, plOrgId);
  if (!hasAccess(callerPerms, "packing-list:approve:centralized") && !hasAccess(targetPerms, "packing-list:approve")) {
    throw new Error("You don't have permission to do this");
  }
}

export type InspectionPhotoCategory = "return" | "repair";

export type InspectionPhoto = {
  id: string;
  imageKey: string;
  url: string;
  category: InspectionPhotoCategory;
  uploadedByName: string | null;
  createdAt: Date;
};

// Shared by every read path that shows inspection photos (own-org detail,
// centralized detail, the inspect page's poll) — one batched query + one
// batch of presigned URLs per call, not N+1 per item.
async function getPhotosForItems(itemIds: string[]): Promise<Map<string, InspectionPhoto[]>> {
  const map = new Map<string, InspectionPhoto[]>();
  if (itemIds.length === 0) return map;

  const rows = await db
    .select()
    .from(inspectionPhoto)
    .where(inArray(inspectionPhoto.packingListItemId, itemIds))
    .orderBy(asc(inspectionPhoto.createdAt));
  if (rows.length === 0) return map;

  const uploaderIds = [...new Set(rows.map((r) => r.uploadedBy))];
  const uploaders = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, uploaderIds));
  const nameOf = (id: string) => uploaders.find((u) => u.id === id)?.name ?? null;

  await Promise.all(
    rows.map(async (r) => {
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: ITEM_INSPECTIONS_BUCKET, Key: r.imageKey }), { expiresIn: 7200 });
      const arr = map.get(r.packingListItemId) ?? [];
      arr.push({ id: r.id, imageKey: r.imageKey, url, category: r.category as InspectionPhotoCategory, uploadedByName: nameOf(r.uploadedBy), createdAt: r.createdAt });
      map.set(r.packingListItemId, arr);
    }),
  );
  return map;
}

// Requested per packingListItemId (not just a bare "any inspector" check) so
// the upload URL is scoped to a specific packing list's own authorization —
// the same rules as saveInspectionLineDraft. category groups the photo under
// the matching Return or Repair box on the inspect form — a line split
// across both needs its evidence kept straight about which is which.
export async function getInspectionPhotoUploadUrl(packingListItemId: string, filename: string, category: InspectionPhotoCategory): Promise<{ key: string; uploadUrl: string }> {
  const { orgId, userId } = await getSession();
  const [row] = await db
    .select({ pl: packingList })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(eq(packingListItem.id, packingListItemId));
  if (!row) throw new Error("Item not found");
  if (row.pl.status !== "pending") throw new Error("This packing list has already been inspected or cancelled");
  await assertCanInspectPackingList(row.pl.organizationId, orgId, userId);

  const key = `item-inspections/${packingListItemId}/${category}/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({ Bucket: ITEM_INSPECTIONS_BUCKET, Key: key });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

// Persists the DB row once the client has successfully PUT the file to R2.
export async function addInspectionPhoto(packingListItemId: string, imageKey: string, category: InspectionPhotoCategory): Promise<InspectionPhoto> {
  const { orgId, userId } = await getSession();
  const [row] = await db
    .select({ pl: packingList })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(eq(packingListItem.id, packingListItemId));
  if (!row) throw new Error("Item not found");
  if (row.pl.status !== "pending") throw new Error("This packing list has already been inspected or cancelled");
  await assertCanInspectPackingList(row.pl.organizationId, orgId, userId);

  const [photo] = await db.insert(inspectionPhoto).values({ id: nanoid(), packingListItemId, imageKey, category, uploadedBy: userId }).returning();
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: ITEM_INSPECTIONS_BUCKET, Key: imageKey }), { expiresIn: 7200 });
  return { id: photo.id, imageKey: photo.imageKey, url, category: photo.category as InspectionPhotoCategory, uploadedByName: u?.name ?? null, createdAt: photo.createdAt };
}

// Anyone who can inspect this packing list can remove any photo on it, not
// just their own upload — same shared-editing model as the qty/notes fields.
export async function deleteInspectionPhoto(photoId: string): Promise<void> {
  const { orgId, userId } = await getSession();
  const [row] = await db
    .select({ photo: inspectionPhoto, pl: packingList })
    .from(inspectionPhoto)
    .innerJoin(packingListItem, eq(inspectionPhoto.packingListItemId, packingListItem.id))
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(eq(inspectionPhoto.id, photoId));
  if (!row) throw new Error("Photo not found");
  if (row.pl.status !== "pending") throw new Error("This packing list has already been inspected or cancelled");
  await assertCanInspectPackingList(row.pl.organizationId, orgId, userId);

  await db.delete(inspectionPhoto).where(eq(inspectionPhoto.id, photoId));
  await s3.send(new DeleteObjectCommand({ Bucket: ITEM_INSPECTIONS_BUCKET, Key: row.photo.imageKey })).catch(() => {});
}

export interface InspectionLineDraftInput {
  qtyReceived: string;
  qtyReturn: string;
  qtyRepair: string;
  returnNotes?: string;
  repairNotes?: string;
}

// Autosaved as soon as someone edits a line on the inspect form — this IS
// the draft, there's no separate submit-a-whole-form step. Independent
// per-line saves are what let several people inspect different lines of the
// same packing list at the same time without stepping on each other; two
// people editing the exact same line still just resolve last-write-wins,
// same as any other field in this app.
export async function saveInspectionLineDraft(packingListItemId: string, input: InspectionLineDraftInput): Promise<{ inspectedByName: string | null; inspectedById: string; inspectedAt: Date }> {
  const { orgId, userId } = await getSession();

  const [row] = await db
    .select({ item: packingListItem, pl: packingList })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(eq(packingListItem.id, packingListItemId));
  if (!row) throw new Error("Item not found");
  if (row.pl.status !== "pending") throw new Error("This packing list has already been inspected or cancelled");

  await assertCanInspectPackingList(row.pl.organizationId, orgId, userId);

  const received = parseFloat(input.qtyReceived) || 0;
  const ret = parseFloat(input.qtyReturn) || 0;
  const repair = parseFloat(input.qtyRepair) || 0;
  if (received < 0) throw new Error("Received quantity can't be negative");
  if (ret + repair > received + 1e-9) throw new Error("Return + repair quantity can't exceed received quantity");

  const inspectedAt = new Date();
  await db
    .update(packingListItem)
    .set({
      draftQtyReceived: input.qtyReceived,
      draftQtyReturn: input.qtyReturn,
      draftQtyRepair: input.qtyRepair,
      draftReturnNotes: input.returnNotes || null,
      draftRepairNotes: input.repairNotes || null,
      draftInspectedBy: userId,
      draftInspectedAt: inspectedAt,
      // Any edit invalidates a prior approval/rejection — the numbers being
      // signed off on just changed, so this line needs review again.
      draftApprovalStatus: "pending",
      draftApprovalNotes: null,
      draftApprovedBy: null,
      draftApprovedAt: null,
    })
    .where(eq(packingListItem.id, packingListItemId));

  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
  return { inspectedByName: u?.name ?? null, inspectedById: userId, inspectedAt };
}

// The approval stage that gates completePackingListInspection — a second
// person (packing-list:approve) reviews each inspected line's numbers before
// they can be locked into a Goods Receipt. Self-approval is blocked/allowed
// per-org via Org Approvals (see lib/approvals/constants.ts), same mechanism
// as every other approve workflow in this app.
export async function approveInspectionLine(
  packingListItemId: string,
  decision: "approved" | "rejected",
  notes?: string,
): Promise<{ approvedByName: string | null; approvedAt: Date }> {
  const { orgId, userId } = await getSession();

  const [row] = await db
    .select({ item: packingListItem, pl: packingList })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(eq(packingListItem.id, packingListItemId));
  if (!row) throw new Error("Item not found");
  if (row.pl.status !== "pending") throw new Error("This packing list has already been inspected or cancelled");

  await assertCanApprovePackingList(row.pl.organizationId, orgId, userId);
  // Self-action-allowed is a setting of the org the packing list actually
  // belongs to, not the caller's currently-active org. A line nobody has
  // touched yet has no "owner" to self-check against — falls through to the
  // normal approve path, since approving its untouched default (fully
  // accepted, qtyExpected) is a legitimate outcome, not a rubber-stamp of
  // someone else's numbers.
  //
  // Cross-org approval (the caller's active org differs from the packing
  // list's own org — i.e. they got here via packing-list:approve:centralized
  // or an owner's sibling-org membership) gets its own, separately
  // configurable self-action rule rather than sharing the local one — see
  // DEFAULT_SELF_ACTION_ALLOWED in lib/approvals/constants.ts.
  if (row.item.draftInspectedBy) {
    const selfActionKey = orgId === row.pl.organizationId ? "packing-list:approve" : "packing-list:approve:centralized";
    await assertSelfActionAllowed(row.pl.organizationId, selfActionKey, row.item.draftInspectedBy, userId, decision === "approved" ? "approve" : "reject");
  }

  const approvedAt = new Date();
  await db
    .update(packingListItem)
    .set({
      draftApprovalStatus: decision,
      draftApprovalNotes: notes || null,
      draftApprovedBy: userId,
      draftApprovedAt: approvedAt,
    })
    .where(eq(packingListItem.id, packingListItemId));

  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
  revalidatePath(`/dashboard/procurement/packing-list/${row.pl.id}/inspect`);
  revalidatePath(`/dashboard/procurement/packing-list/centralized/${row.pl.id}/inspect`);
  return { approvedByName: u?.name ?? null, approvedAt };
}

// Lets the inspect page decide whether to render approve/reject controls at
// all, without throwing — most people viewing this page only have
// packing-list:inspect, not packing-list:approve. Takes the packing list's
// own org (not necessarily the caller's active org) so this works correctly
// from the centralized cross-org inspect page too.
//
// Also returns what the page needs to hide the buttons on a *specific* line
// rather than just the whole page: currentUserId (to compare against each
// line's draftInspectedBy) and selfApprovalAllowed (the org's setting for
// whether that comparison even matters) — mirrors the selfActionKey branch
// in approveInspectionLine so the button's visibility never promises an
// action the server would then reject.
export async function canApprovePackingListInspection(plOrganizationId: string): Promise<{
  canApprove: boolean;
  currentUserId: string;
  selfApprovalAllowed: boolean;
}> {
  const { orgId, userId } = await getSession();
  let canApprove = true;
  try {
    await assertCanApprovePackingList(plOrganizationId, orgId, userId);
  } catch {
    canApprove = false;
  }
  const selfActionKey = orgId === plOrganizationId ? "packing-list:approve" : "packing-list:approve:centralized";
  const selfApprovalAllowed = await isSelfActionAllowed(plOrganizationId, selfActionKey);
  return { canApprove, currentUserId: userId, selfApprovalAllowed };
}

export type InspectionLineState = {
  packingListItemId: string;
  draftQtyReceived: string | null;
  draftQtyReturn: string | null;
  draftQtyRepair: string | null;
  draftReturnNotes: string | null;
  draftRepairNotes: string | null;
  inspectedByName: string | null;
  inspectedById: string | null;
  inspectedAt: Date | null;
  approvalStatus: string | null;
  approvalNotes: string | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  photos: InspectionPhoto[];
};

// Polled periodically by the inspect form so everyone currently inspecting
// this packing list sees each other's line-by-line progress — including
// newly attached photos and approval decisions — without a full-page reload.
export async function getInspectionLineStates(packingListId: string): Promise<InspectionLineState[]> {
  const { orgId, userId } = await getSession();

  const [pl] = await db.select().from(packingList).where(eq(packingList.id, packingListId));
  if (!pl) throw new Error("Packing list not found");
  await assertCanInspectPackingList(pl.organizationId, orgId, userId);

  const rows = await db.select().from(packingListItem).where(eq(packingListItem.packingListId, packingListId)).orderBy(asc(packingListItem.rowNo));
  const nameMap = await getUserNameMap(rows.flatMap((r) => [r.draftInspectedBy, r.draftApprovedBy]));
  const nameOf = (id: string | null) => (id ? (nameMap.get(id) ?? null) : null);
  const photosByItem = await getPhotosForItems(rows.map((r) => r.id));

  return rows.map((r) => ({
    packingListItemId: r.id,
    draftQtyReceived: r.draftQtyReceived,
    draftQtyReturn: r.draftQtyReturn,
    draftQtyRepair: r.draftQtyRepair,
    draftReturnNotes: r.draftReturnNotes,
    draftRepairNotes: r.draftRepairNotes,
    inspectedByName: nameOf(r.draftInspectedBy),
    inspectedById: r.draftInspectedBy,
    inspectedAt: r.draftInspectedAt,
    approvalStatus: r.draftApprovalStatus,
    approvalNotes: r.draftApprovalNotes,
    approvedByName: nameOf(r.draftApprovedBy),
    approvedAt: r.draftApprovedAt,
    photos: photosByItem.get(r.id) ?? [],
  }));
}

// Shared by both the own-org and centralized (cross-org) inspection entry
// points below, once each has independently authorized the call and
// resolved which org the resulting Goods Receipt(s) belong to. targetOrgId
// is only passed for the cross-org case (undefined = caller's own org).
// Reads whatever's currently saved in each line's draft columns rather than
// taking a bulk submission — completing inspection just locks in the
// current draft state; untouched lines fall back to fully-received/accepted.
async function applyPackingListInspection(
  pl: PackingListRow,
  userId: string,
  input: CompleteInspectionInput,
  targetOrgId?: string,
): Promise<{ goodsReceiptIds: string[] }> {
  const id = pl.id;
  if (pl.status !== "pending") throw new Error("This packing list has already been inspected or cancelled");

  const plItems = await db.select().from(packingListItem).where(eq(packingListItem.packingListId, id)).orderBy(asc(packingListItem.rowNo));
  if (plItems.length === 0) throw new Error("This packing list has no items");

  // Every line needs a sign-off from packing-list:approve before the numbers
  // get locked into a Goods Receipt — an inspector's own entry isn't enough
  // on its own. Rejected lines block the same way: they need to be
  // re-inspected (which resets them to "pending") and re-approved.
  const notApproved = plItems.filter((i) => i.draftApprovalStatus !== "approved");
  if (notApproved.length > 0) {
    throw new Error(
      `${notApproved.length} of ${plItems.length} item${plItems.length !== 1 ? "s" : ""} still need${notApproved.length === 1 ? "s" : ""} approval before this packing list can be completed`,
    );
  }

  // Group lines by their source PO — one Goods Receipt gets created per
  // distinct PO, all sharing this packingListId.
  const byPo = new Map<string, PackingListItemRow[]>();
  for (const plItem of plItems) {
    const arr = byPo.get(plItem.purchaseOrderId) ?? [];
    arr.push(plItem);
    byPo.set(plItem.purchaseOrderId, arr);
  }

  let anyReceived = false;
  const goodsReceiptIds: string[] = [];
  for (const [purchaseOrderId, lines] of byPo) {
    const items: GoodsReceiptItemInput[] = lines.map((plItem) => {
      const received = parseFloat(plItem.draftQtyReceived ?? plItem.qtyExpected) || 0;
      const ret = parseFloat(plItem.draftQtyReturn ?? "0") || 0;
      const repair = parseFloat(plItem.draftQtyRepair ?? "0") || 0;
      // In-house repair still counts as accepted stock — only a return to
      // the supplier actually reduces what's accepted/fed into inventory.
      const good = Math.max(0, received - ret);
      if (received > 0) anyReceived = true;
      return {
        purchaseOrderItemId: plItem.purchaseOrderItemId,
        packingListItemId: plItem.id,
        productId: plItem.productId ?? undefined,
        productCode: plItem.productCode ?? undefined,
        description: plItem.description ?? undefined,
        qtyOrdered: plItem.qtyExpected,
        qtyReceived: String(received),
        qtyGood: String(good),
        qtyReturn: ret > 0 ? String(ret) : undefined,
        qtyRepair: repair > 0 ? String(repair) : undefined,
        returnStatus: ret > 0 ? "pending" : undefined,
        returnNotes: plItem.draftReturnNotes || undefined,
        repairStatus: repair > 0 ? "pending" : undefined,
        repairNotes: plItem.draftRepairNotes || undefined,
        uom: plItem.uom ?? undefined,
        unitPrice: plItem.unitPrice ?? undefined,
        currency: plItem.currency ?? undefined,
      };
    });

    const gr = await createGoodsReceipt({
      purchaseOrderId,
      packingListId: id,
      receivedDate: input.receivedDate,
      notes: input.notes,
      items,
      inspectedBy: userId,
      ...(targetOrgId ? { targetOrgId } : {}),
    });
    goodsReceiptIds.push(gr.id);
  }

  if (!anyReceived) throw new Error("At least one item must have a quantity received greater than 0");

  await db.update(packingList).set({ status: "completed" }).where(eq(packingList.id, id));

  revalidatePath(`/dashboard/procurement/packing-list/${id}`);
  revalidatePath("/dashboard/procurement/packing-list");

  return { goodsReceiptIds };
}

export async function completePackingListInspection(id: string, input: CompleteInspectionInput): Promise<{ goodsReceiptIds: string[] }> {
  const { orgId, userId } = await requireAccess("packing-list:inspect");

  const [pl] = await db
    .select()
    .from(packingList)
    .where(and(eq(packingList.id, id), eq(packingList.organizationId, orgId)));
  if (!pl) throw new Error("Packing list not found");

  return applyPackingListInspection(pl, userId, input);
}

// Cross-org counterpart for members explicitly granted
// packing-list:read:centralized who can also inspect the packing list's own
// org — see assertCanInspectPackingList above.
export async function completePackingListInspectionCentralized(id: string, input: CompleteInspectionInput): Promise<{ goodsReceiptIds: string[] }> {
  const { orgId, userId } = await requireAccess("packing-list:read:centralized");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const [pl] = await db
    .select()
    .from(packingList)
    .where(and(eq(packingList.id, id), inArray(packingList.organizationId, ownerOrgIds)));
  if (!pl) throw new Error("Packing list not found");

  await assertCanInspectPackingList(pl.organizationId, orgId, userId);

  return applyPackingListInspection(pl, userId, input, pl.organizationId);
}

export async function cancelPackingList(id: string): Promise<void> {
  const { orgId } = await requireAccess("packing-list:create");
  const [pl] = await db
    .select()
    .from(packingList)
    .where(and(eq(packingList.id, id), eq(packingList.organizationId, orgId)));
  if (!pl) throw new Error("Packing list not found");
  if (pl.status !== "pending") throw new Error("Only a pending packing list can be cancelled");

  await db.update(packingList).set({ status: "cancelled" }).where(eq(packingList.id, id));
  revalidatePath("/dashboard/procurement/packing-list");
  revalidatePath(`/dashboard/procurement/packing-list/${id}`);
}

// Hard delete — permanently removes the record, unlike cancelPackingList
// which just flips status and keeps it as an audit trail. Restricted to the
// organization owner. Blocked once any Goods Receipt has been recorded
// against it (goodsReceipt.packingListId has no cascade — the DB itself
// would refuse the delete — but checking first gives a clear error instead
// of a raw constraint violation).
export async function deletePackingList(id: string): Promise<void> {
  const { orgId } = await requireOwner();

  const [pl] = await db
    .select()
    .from(packingList)
    .where(and(eq(packingList.id, id), eq(packingList.organizationId, orgId)));
  if (!pl) throw new Error("Packing list not found");

  const [linkedGr] = await db
    .select({ id: goodsReceipt.id })
    .from(goodsReceipt)
    .where(eq(goodsReceipt.packingListId, id))
    .limit(1);
  if (linkedGr) throw new Error("This packing list already has goods receipts recorded against it and can't be deleted");

  await db.delete(packingList).where(eq(packingList.id, id));
  revalidatePath("/dashboard/procurement/packing-list");
}

export interface ReturnResolutionInput {
  type: "replacement" | "credited" | "written_off" | "other";
  // Required (and only meaningful) when type is "replacement" — the packing
  // list carrying the make-good shipment. The supplier may send that
  // shipment before or after the physical return actually goes back, so
  // this is always a manual pick, never inferred.
  packingListId?: string;
  notes?: string;
}

// A line can need both a return AND a repair at once (split across the
// damaged quantity), so each is resolved independently by actionType.
// Only "return" takes a resolution — it's the only side with an external
// counterparty (the supplier) whose settlement is worth recording; a repair
// is done in-house, so "resolved" already fully describes it.
export async function resolveReceiptItemAction(
  goodsReceiptItemId: string,
  actionType: "return" | "repair",
  resolution?: ReturnResolutionInput,
): Promise<{ resolvedByName: string | null; resolvedAt: Date; resolutionType: string | null; resolutionPackingListNo: string | null }> {
  const { orgId, userId } = await getSession();

  const [row] = await db
    .select({ id: goodsReceiptItem.id, orgId: goodsReceipt.organizationId, grStatus: goodsReceipt.status, purchaseOrderItemId: goodsReceiptItem.purchaseOrderItemId })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .where(eq(goodsReceiptItem.id, goodsReceiptItemId));
  if (!row) throw new Error("Item not found");
  await assertCanInspectPackingList(row.orgId, orgId, userId);
  if (row.grStatus === "recalled") throw new Error("This goods receipt has been recalled — nothing to resolve");

  const resolvedAt = new Date();
  let resolutionPackingListNo: string | null = null;

  if (actionType === "return") {
    if (!resolution) throw new Error("Specify how this return was resolved");
    if (resolution.type === "replacement") {
      if (!resolution.packingListId) throw new Error("Select the packing list carrying the replacement");
      const [pl] = await db
        .select({ id: packingList.id, packingListNo: packingList.packingListNo, organizationId: packingList.organizationId })
        .from(packingList)
        .where(eq(packingList.id, resolution.packingListId));
      if (!pl || pl.organizationId !== row.orgId) throw new Error("Packing list not found");
      resolutionPackingListNo = pl.packingListNo;
    }
    await db
      .update(goodsReceiptItem)
      .set({
        returnStatus: "resolved",
        returnResolvedBy: userId,
        returnResolvedAt: resolvedAt,
        returnResolutionType: resolution.type,
        returnResolutionPackingListId: resolution.type === "replacement" ? resolution.packingListId : null,
        returnResolutionNotes: resolution.notes || null,
      })
      .where(and(eq(goodsReceiptItem.id, goodsReceiptItemId), eq(goodsReceiptItem.returnStatus, "pending")));

    // "written_off" on a return means no replacement is ever coming for
    // those units — so the PO item's own shortfall (the ordered-qty gap
    // those units represent) shouldn't keep sitting open on Outstanding
    // Issues or being offered as remaining-to-pack once that's decided.
    // Only fills in an untouched (null) shortfall — never overwrites one
    // someone already closed a different way, and never touches an already
    // written-off one (nothing to update).
    if (resolution.type === "written_off" && row.purchaseOrderItemId) {
      await db
        .update(purchaseOrderItem)
        .set({ shortfallClosedStatus: "written_off", shortfallClosedBy: userId, shortfallClosedAt: resolvedAt })
        .where(and(eq(purchaseOrderItem.id, row.purchaseOrderItemId), isNull(purchaseOrderItem.shortfallClosedStatus)));
    }
  } else {
    await db
      .update(goodsReceiptItem)
      .set({ repairStatus: "resolved", repairResolvedBy: userId, repairResolvedAt: resolvedAt })
      .where(and(eq(goodsReceiptItem.id, goodsReceiptItemId), eq(goodsReceiptItem.repairStatus, "pending")));
  }
  revalidatePath("/dashboard/procurement/purchase-order");
  // Resolving a return also changes whether the same line now counts as a
  // genuine shortfall on the Goods Receipts page's outstanding-issues panel
  // (see getPendingReturnsAndRepairs in server/goods-receipt.ts) — without
  // this, that panel would keep serving a stale cached read.
  revalidatePath("/dashboard/procurement/goods-receipt");
  revalidatePath("/dashboard/procurement/goods-receipt/centralized");

  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
  return {
    resolvedByName: u?.name ?? null,
    resolvedAt,
    resolutionType: actionType === "return" ? resolution!.type : null,
    resolutionPackingListNo,
  };
}

// Feeds the "replacement received" picker when resolving a return — every
// packing list recorded for this supplier, regardless of its own status,
// since the replacement shipment may still be mid-inspection (or not even
// started) at the moment the return itself gets marked resolved.
// targetOrgId lets the centralized Outstanding Issues panel resolve a
// return that belongs to a DIFFERENT org than the caller's active one —
// without it, this would silently query the wrong org's packing lists and
// the picker would just show nothing. Only allowed when the caller actually
// owns that org (same check as every other cross-org read in this file).
export async function getPackingListsForSupplier(supplierId: string, targetOrgId?: string): Promise<{ id: string; packingListNo: string; status: string; createdAt: Date }[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  let scopedOrgId = orgId;
  if (targetOrgId && targetOrgId !== orgId) {
    const ownerOrgIds = await getOwnerOrgIds(orgId);
    if (!ownerOrgIds.includes(targetOrgId)) throw new Error("You don't have permission to view packing lists for that organization");
    scopedOrgId = targetOrgId;
  }
  return db
    .select({ id: packingList.id, packingListNo: packingList.packingListNo, status: packingList.status, createdAt: packingList.createdAt })
    .from(packingList)
    .where(and(eq(packingList.organizationId, scopedOrgId), eq(packingList.supplierId, supplierId)))
    .orderBy(desc(packingList.createdAt));
}
