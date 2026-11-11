"use server";

import { db } from "@/db";
import {
  goodsReceipt,
  goodsReceiptItem,
  member,
  organization,
  packingList,
  packingListAmendment,
  packingListItem,
  packingListRevision,
  purchaseOrder,
  purchaseOrderItem,
  returnReplacementAttempt,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";

const num = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;

async function requireCentralizedRead() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "purchase-order:read:centralized")) throw new Error("You don't have permission to do this");

  const [ownerMember] = await db.select().from(member).where(and(eq(member.organizationId, orgId), eq(member.role, "owner"))).limit(1);
  let orgIds = [orgId];
  if (ownerMember) {
    const owned = await db.select({ organizationId: member.organizationId }).from(member).where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")));
    const ids = [...new Set(owned.map((m) => m.organizationId))];
    if (ids.length > 0) orgIds = ids;
  }
  return { orgIds };
}

export type TrackPoHit = {
  id: string;
  poNo: string | null;
  prNo: string | null;
  status: string;
  supplierName: string | null;
  organizationName: string | null;
};

// Type-ahead for the tracking page: matches the PO number (or the PR number it
// started as) across every org the caller owns.
export async function searchPurchaseOrdersForTracking(query: string): Promise<TrackPoHit[]> {
  const { orgIds } = await requireCentralizedRead();
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db
    .select({ id: purchaseOrder.id, poNo: purchaseOrder.poNo, prNo: purchaseOrder.prNo, status: purchaseOrder.status, supplierSnapshot: purchaseOrder.supplierSnapshot, orgId: purchaseOrder.organizationId })
    .from(purchaseOrder)
    .where(and(inArray(purchaseOrder.organizationId, orgIds), or(ilike(purchaseOrder.poNo, `%${q}%`), ilike(purchaseOrder.prNo, `%${q}%`))))
    .orderBy(asc(purchaseOrder.poNo))
    .limit(20);
  const orgs = await db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, orgIds));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((r) => ({
    id: r.id,
    poNo: r.poNo,
    prNo: r.prNo,
    status: r.status,
    supplierName: (r.supplierSnapshot as { name?: string } | null)?.name ?? null,
    organizationName: orgName.get(r.orgId) ?? null,
  }));
}

export type TrackLine = {
  id: string;
  rowNo: number;
  productCode: string | null;
  description: string | null;
  uom: string | null;
  qtyOrdered: number;
  qtyAccepted: number;
  // Rejected units still waiting to be sent back / settled
  qtyPendingReturn: number;
  packingListCount: number;
};

export type TrackPo = {
  id: string;
  poNo: string | null;
  prNo: string | null;
  status: string;
  supplierName: string | null;
  organizationId: string;
  organizationName: string | null;
  lines: TrackLine[];
};

export async function getPoForTracking(purchaseOrderId: string): Promise<TrackPo | null> {
  const { orgIds } = await requireCentralizedRead();
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, purchaseOrderId), inArray(purchaseOrder.organizationId, orgIds)));
  if (!po) return null;

  const items = await db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, po.id)).orderBy(asc(purchaseOrderItem.rowNo));
  const itemIds = items.map((i) => i.id);
  const [grItems, plItems, [org]] = await Promise.all([
    itemIds.length === 0 ? [] : db
      .select({ poItemId: goodsReceiptItem.purchaseOrderItemId, qtyGood: goodsReceiptItem.qtyGood, qtyReceived: goodsReceiptItem.qtyReceived, qtyReturn: goodsReceiptItem.qtyReturn, returnStatus: goodsReceiptItem.returnStatus })
      .from(goodsReceiptItem)
      .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
      .where(and(inArray(goodsReceiptItem.purchaseOrderItemId, itemIds), eq(goodsReceipt.status, "confirmed"))),
    itemIds.length === 0 ? [] : db
      .select({ poItemId: packingListItem.purchaseOrderItemId })
      .from(packingListItem)
      .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
      .where(and(inArray(packingListItem.purchaseOrderItemId, itemIds), inArray(packingList.status, ["pending", "completed"]), isNull(packingListItem.removedAt))),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, po.organizationId)),
  ]);

  const lines: TrackLine[] = items.map((i) => {
    const mine = grItems.filter((g) => g.poItemId === i.id);
    return {
      id: i.id,
      rowNo: i.rowNo,
      productCode: i.productCode,
      description: i.description,
      uom: i.uom,
      qtyOrdered: num(i.qty),
      qtyAccepted: mine.reduce((s, g) => s + num(g.qtyGood ?? g.qtyReceived), 0),
      qtyPendingReturn: mine.filter((g) => g.returnStatus === "pending").reduce((s, g) => s + num(g.qtyReturn), 0),
      packingListCount: plItems.filter((p) => p.poItemId === i.id).length,
    };
  });
  return {
    id: po.id,
    poNo: po.poNo,
    prNo: po.prNo,
    status: po.status,
    supplierName: (po.supplierSnapshot as { name?: string } | null)?.name ?? null,
    organizationId: po.organizationId,
    organizationName: org?.name ?? null,
    lines,
  };
}

export type TraceEvent = {
  at: Date | null;
  tone: "neutral" | "info" | "good" | "bad" | "warn";
  title: string;
  detail?: string;
  ref?: { kind: "packing-list" | "goods-receipt"; id: string; no: string; organizationId: string };
};

export type ItemTrace = {
  line: { id: string; rowNo: number; productCode: string | null; description: string | null; uom: string | null };
  po: { id: string; poNo: string | null; prNo: string | null; status: string; supplierName: string | null; organizationId: string; organizationName: string | null };
  summary: {
    ordered: number;
    accepted: number;
    pendingReturn: number;
    pendingRepair: number;
    reservedOnPendingPls: number;
    stillToPack: number;
    surplus: number;
    shortfallClosed: string | null;
    // The most recent packing list carrying this line — where it stands now
    finalPackingList: { id: string; no: string; status: string; organizationId: string } | null;
  };
  events: TraceEvent[];
};

// The whole life of one PO line: ordered → every packing list that carried it
// → each inspection → returns / repairs → sent back → replacement shipments →
// closed. Read-only, oldest first.
export async function getItemTrace(purchaseOrderItemId: string): Promise<ItemTrace | null> {
  const { orgIds } = await requireCentralizedRead();

  const [row] = await db
    .select({ item: purchaseOrderItem, po: purchaseOrder })
    .from(purchaseOrderItem)
    .innerJoin(purchaseOrder, eq(purchaseOrderItem.purchaseOrderId, purchaseOrder.id))
    .where(and(eq(purchaseOrderItem.id, purchaseOrderItemId), inArray(purchaseOrder.organizationId, orgIds)));
  if (!row) return null;
  const { item, po } = row;
  const orgId = po.organizationId;

  const [orgRow] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId));

  const pls = await db
    .select({
      lineId: packingListItem.id,
      qtyExpected: packingListItem.qtyExpected,
      draftReceived: packingListItem.draftQtyReceived,
      draftReturn: packingListItem.draftQtyReturn,
      plId: packingList.id,
      plNo: packingList.packingListNo,
      plStatus: packingList.status,
      plCreatedAt: packingList.createdAt,
      removedAt: packingListItem.removedAt,
      removedReason: packingListItem.removedReason,
    })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    // removed lines stay in: they're part of the history (shown as removed),
    // just not counted in the summary below
    .where(eq(packingListItem.purchaseOrderItemId, item.id))
    .orderBy(asc(packingList.createdAt));

  const grs = await db
    .select({
      id: goodsReceiptItem.id,
      qtyOrdered: goodsReceiptItem.qtyOrdered,
      qtyReceived: goodsReceiptItem.qtyReceived,
      qtyGood: goodsReceiptItem.qtyGood,
      qtyReturn: goodsReceiptItem.qtyReturn,
      qtyRepair: goodsReceiptItem.qtyRepair,
      returnStatus: goodsReceiptItem.returnStatus,
      returnNotes: goodsReceiptItem.returnNotes,
      repairStatus: goodsReceiptItem.repairStatus,
      repairNotes: goodsReceiptItem.repairNotes,
      repairResolvedAt: goodsReceiptItem.repairResolvedAt,
      shippedAt: goodsReceiptItem.returnShippedAt,
      shipRef: goodsReceiptItem.returnShipRef,
      resolvedAt: goodsReceiptItem.returnResolvedAt,
      resolvedBy: goodsReceiptItem.returnResolvedBy,
      resolutionType: goodsReceiptItem.returnResolutionType,
      resolutionNotes: goodsReceiptItem.returnResolutionNotes,
      inspectedAt: goodsReceiptItem.inspectedAt,
      inspectedBy: goodsReceiptItem.inspectedBy,
      grId: goodsReceipt.id,
      grNo: goodsReceipt.grNo,
      grStatus: goodsReceipt.status,
      receivedDate: goodsReceipt.receivedDate,
      plId: goodsReceipt.packingListId,
    })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .where(eq(goodsReceiptItem.purchaseOrderItemId, item.id))
    .orderBy(asc(goodsReceipt.receivedDate));

  // Replacement shipments in both directions: this line's returns being made
  // good by some packing list line, and this line carrying someone's replacement.
  const lineIds = pls.map((p) => p.lineId);
  const retIds = grs.map((g) => g.id);
  const attempts = (lineIds.length === 0 && retIds.length === 0) ? [] : await db
    .select({
      id: returnReplacementAttempt.id,
      attemptNo: returnReplacementAttempt.attemptNo,
      qtyAllocated: returnReplacementAttempt.qtyAllocated,
      qtyGood: returnReplacementAttempt.qtyGood,
      qtyFailed: returnReplacementAttempt.qtyFailed,
      status: returnReplacementAttempt.status,
      linkedAt: returnReplacementAttempt.createdAt,
      inspectedAt: returnReplacementAttempt.inspectedAt,
      returnItemId: returnReplacementAttempt.goodsReceiptItemId,
      lineId: returnReplacementAttempt.packingListItemId,
    })
    .from(returnReplacementAttempt)
    .where(or(
      lineIds.length > 0 ? inArray(returnReplacementAttempt.packingListItemId, lineIds) : undefined,
      retIds.length > 0 ? inArray(returnReplacementAttempt.goodsReceiptItemId, retIds) : undefined,
    ));

  // Names needed to label attempts whose other side belongs to another line
  const otherLineIds = [...new Set(attempts.map((a) => a.lineId))];
  const lineInfo = otherLineIds.length === 0 ? [] : await db
    .select({ lineId: packingListItem.id, plId: packingList.id, plNo: packingList.packingListNo, plStatus: packingList.status })
    .from(packingListItem)
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(inArray(packingListItem.id, otherLineIds));
  const lineMap = new Map(lineInfo.map((l) => [l.lineId, l]));
  const returnMap = new Map(grs.map((g) => [g.id, g]));
  const otherReturnIds = [...new Set(attempts.map((a) => a.returnItemId).filter((id) => !returnMap.has(id)))];
  const otherReturns = otherReturnIds.length === 0 ? [] : await db
    .select({ id: goodsReceiptItem.id, grNo: goodsReceipt.grNo, grId: goodsReceipt.id })
    .from(goodsReceiptItem)
    .innerJoin(goodsReceipt, eq(goodsReceiptItem.goodsReceiptId, goodsReceipt.id))
    .where(inArray(goodsReceiptItem.id, otherReturnIds));
  const otherReturnMap = new Map(otherReturns.map((r) => [r.id, r]));

  // Changes after the fact: corrections to completed lines (amendments) and
  // lines added to an open packing list by an approved change (revisions)
  const amendments = lineIds.length === 0 ? [] : await db
    .select()
    .from(packingListAmendment)
    .where(inArray(packingListAmendment.packingListItemId, lineIds))
    .orderBy(asc(packingListAmendment.requestedAt));
  const plIds = [...new Set(pls.map((p) => p.plId))];
  const revisions = plIds.length === 0 ? [] : (await db
    .select()
    .from(packingListRevision)
    .where(and(inArray(packingListRevision.packingListId, plIds), eq(packingListRevision.status, "approved"))))
    .filter((r) => r.addItems.some((a) => a.purchaseOrderItemId === item.id));
  const amendedGri = new Set(amendments.filter((a) => a.status === "approved" && a.goodsReceiptItemId).map((a) => a.goodsReceiptItemId!));

  const userIds = [...new Set([
    ...grs.map((g) => g.inspectedBy), ...grs.map((g) => g.resolvedBy),
    ...amendments.flatMap((a) => [a.requestedBy, a.decidedBy]), ...revisions.flatMap((r) => [r.requestedBy, r.decidedBy]),
  ].filter((v): v is string => !!v))];
  const userRows = userIds.length === 0 ? [] : await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
  const userName = new Map(userRows.map((u) => [u.id, u.name]));

  const uom = item.uom ?? "";
  const events: TraceEvent[] = [];

  events.push({
    at: po.createdAt,
    tone: "neutral",
    title: `Ordered ${num(item.qty)} ${uom} on ${po.poNo ?? po.prNo ?? "PO"}`.trim(),
    detail: po.status ? `PO status now: ${po.status}` : undefined,
  });

  for (const p of pls) {
    events.push({
      at: p.plCreatedAt,
      tone: p.plStatus === "cancelled" ? "warn" : "info",
      title: `Packing list ${p.plNo}: ${num(p.qtyExpected)} ${uom} expected`.trim(),
      detail: p.plStatus === "cancelled" ? "Packing list was cancelled" : p.plStatus === "pending" ? "Not inspected yet" : undefined,
      ref: { kind: "packing-list", id: p.plId, no: p.plNo, organizationId: orgId },
    });
    if (p.removedAt) {
      events.push({
        at: p.removedAt, tone: "warn",
        title: `Removed from packing list ${p.plNo}`,
        detail: p.removedReason ?? undefined,
        ref: { kind: "packing-list", id: p.plId, no: p.plNo, organizationId: orgId },
      });
    }
  }

  for (const g of grs) {
    const recalled = g.grStatus === "recalled";
    const plNo = g.plId ? pls.find((p) => p.plId === g.plId)?.plNo ?? null : null;
    const received = num(g.qtyReceived);
    const good = num(g.qtyGood ?? g.qtyReceived);
    const ret = num(g.qtyReturn);
    const repair = num(g.qtyRepair);
    const short = Math.max(0, num(g.qtyOrdered) - received);
    const parts = [`received ${received}`, `accepted ${good}`];
    if (ret > 0) parts.push(`return ${ret}`);
    if (repair > 0) parts.push(`repair ${repair}`);
    if (short > 0) parts.push(`short ${short}`);
    events.push({
      at: g.inspectedAt ?? g.receivedDate,
      tone: recalled ? "warn" : ret > 0 || short > 0 ? "bad" : "good",
      title: `${recalled ? "Recalled receipt" : "Inspected"} ${g.grNo}${plNo ? ` (${plNo})` : ""}: ${parts.join(" · ")}`,
      detail: [amendedGri.has(g.id) ? "figures as amended — see the amendment below" : null, g.inspectedBy ? `by ${userName.get(g.inspectedBy) ?? "—"}` : null, g.returnNotes ? `return reason: ${g.returnNotes}` : null, g.repairNotes ? `repair: ${g.repairNotes}` : null].filter(Boolean).join(" · ") || undefined,
      ref: { kind: "goods-receipt", id: g.grId, no: g.grNo, organizationId: orgId },
    });
    if (recalled) continue;
    if (ret > 0 && g.shippedAt) {
      events.push({ at: g.shippedAt, tone: "info", title: `Returned ${ret} ${uom} to supplier (${g.grNo})`.trim(), detail: g.shipRef ? `ref ${g.shipRef}` : undefined });
    }
    if (ret > 0 && g.returnStatus === "resolved" && g.resolvedAt) {
      const label = ({ replacement: "replacement received", credited: "credited by supplier", written_off: "written off", other: "settled another way" } as Record<string, string>)[g.resolutionType ?? ""] ?? "resolved";
      events.push({
        at: g.resolvedAt, tone: "good", title: `Return on ${g.grNo} closed — ${label}`,
        detail: [g.resolvedBy ? `by ${userName.get(g.resolvedBy) ?? "—"}` : null, g.resolutionNotes].filter(Boolean).join(" · ") || undefined,
      });
    }
    if (repair > 0 && g.repairStatus === "resolved" && g.repairResolvedAt) {
      events.push({ at: g.repairResolvedAt, tone: "good", title: `Repair of ${repair} ${uom} completed (${g.grNo})`.trim() });
    }
  }

  for (const a of attempts) {
    const line = lineMap.get(a.lineId);
    const myReturn = returnMap.get(a.returnItemId);
    const other = otherReturnMap.get(a.returnItemId);
    const retLabel = myReturn ? myReturn.grNo : other?.grNo ?? "a return";
    const plLabel = line?.plNo ?? "a packing list";
    events.push({
      at: a.linkedAt, tone: "info",
      title: `Replacement attempt ${a.attemptNo}: ${num(a.qtyAllocated)} ${uom} placed on ${plLabel} for the return on ${retLabel}`.trim(),
      ref: line ? { kind: "packing-list", id: line.plId, no: line.plNo, organizationId: orgId } : undefined,
    });
    if (a.status === "inspected") {
      const failed = num(a.qtyFailed);
      events.push({
        at: a.inspectedAt, tone: failed > 0 ? "bad" : "good",
        title: `Attempt ${a.attemptNo} inspected: ${num(a.qtyGood)} good${failed > 0 ? ` · ${failed} failed` : ""}`,
      });
    }
  }

  for (const a of amendments) {
    if (a.status === "cancelled") continue;
    const plNo = pls.find((p) => p.lineId === a.packingListItemId)?.plNo ?? null;
    const where = `${a.grNo ?? "the receipt"}${plNo ? ` (${plNo})` : ""}`;
    const diff = (label: string, x: string, y: string) => (num(x) === num(y) ? null : `${label} ${num(x)} → ${num(y)}`);
    const what = a.kind === "remove"
      ? `take the line off ${where}`
      : [diff("received", a.oldQtyReceived, a.newQtyReceived), diff("return", a.oldQtyReturn, a.newQtyReturn), diff("repair", a.oldQtyRepair, a.newQtyRepair)].filter(Boolean).join(" · ") || "notes";
    const by = `asked by ${userName.get(a.requestedBy) ?? "—"}`;
    const decider = a.decidedBy ? userName.get(a.decidedBy) ?? "—" : null;
    if (a.status === "approved") {
      const delta = num(a.stockDelta);
      events.push({
        at: a.decidedAt, tone: "warn",
        title: a.kind === "remove" ? `Line removed from ${where} by an approved change` : `Amended ${where}: ${what}`,
        detail: [`“${a.reason}”`, by, `approved by ${decider}`, delta !== 0 ? `stock ${delta > 0 ? "+" : ""}${delta} ${uom}`.trim() : null].filter(Boolean).join(" · "),
      });
    } else if (a.status === "rejected") {
      events.push({ at: a.decidedAt, tone: "neutral", title: `Change to ${where} rejected (${what})`, detail: [`“${a.reason}”`, by, `rejected by ${decider}`, a.decisionNotes].filter(Boolean).join(" · ") });
    } else {
      events.push({ at: a.requestedAt, tone: "info", title: `Change to ${where} awaiting approval (${what})`, detail: [`“${a.reason}”`, by].join(" · ") });
    }
  }
  for (const r of revisions) {
    const plNo = pls.find((p) => p.plId === r.packingListId)?.plNo ?? "a packing list";
    const qty = r.addItems.find((x) => x.purchaseOrderItemId === item.id)?.qty ?? 0;
    events.push({
      at: r.decidedAt, tone: "info",
      title: `Added to packing list ${plNo} by an approved change: ${qty} ${uom}`.trim(),
      detail: [`“${r.reason}”`, `asked by ${userName.get(r.requestedBy) ?? "—"}`, r.decidedBy ? `approved by ${userName.get(r.decidedBy) ?? "—"}` : null].filter(Boolean).join(" · "),
      ref: { kind: "packing-list", id: r.packingListId, no: plNo, organizationId: orgId },
    });
  }

  if (item.shortfallClosedStatus && item.shortfallClosedAt) {
    events.push({ at: item.shortfallClosedAt, tone: "warn", title: `Shortfall ${item.shortfallClosedStatus === "written_off" ? "written off" : "closed as resolved"}` });
  }

  events.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

  const active = grs.filter((g) => g.grStatus === "confirmed");
  const accepted = active.reduce((s, g) => s + num(g.qtyGood ?? g.qtyReceived), 0);
  const reserved = pls.filter((p) => p.plStatus === "pending" && !p.removedAt).reduce((s, p) => s + num(p.qtyExpected), 0);
  const ordered = num(item.qty);
  const live = pls.filter((p) => p.plStatus !== "cancelled" && !p.removedAt);
  const last = live[live.length - 1];

  return {
    line: { id: item.id, rowNo: item.rowNo, productCode: item.productCode, description: item.description, uom: item.uom },
    po: { id: po.id, poNo: po.poNo, prNo: po.prNo, status: po.status, supplierName: (po.supplierSnapshot as { name?: string } | null)?.name ?? null, organizationId: orgId, organizationName: orgRow?.name ?? null },
    summary: {
      ordered,
      accepted,
      pendingReturn: active.filter((g) => g.returnStatus === "pending").reduce((s, g) => s + num(g.qtyReturn), 0),
      pendingRepair: active.filter((g) => g.repairStatus === "pending").reduce((s, g) => s + num(g.qtyRepair), 0),
      reservedOnPendingPls: reserved,
      stillToPack: item.shortfallClosedStatus ? 0 : Math.max(0, ordered - accepted - reserved),
      surplus: Math.max(0, accepted - ordered),
      shortfallClosed: item.shortfallClosedStatus,
      finalPackingList: last ? { id: last.plId, no: last.plNo, status: last.plStatus, organizationId: orgId } : null,
    },
    events,
  };
}
