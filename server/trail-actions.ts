"use server";

// Which Recall / Cancel / Delete actions the fulfilment trail offers on each
// of its documents, and — when one is blocked — why. Built only from the
// existing blocker checks the document pages use (and the actions re-check
// them anyway), so the trail can never offer something the action refuses.
//
// An action is listed only when it applies to the document's status and the
// viewer holds its permission; it's then either allowed, or disabled with the
// reason. Documents are re-derived from the CPO id — nothing about them is
// taken from the client. Same-org only: sibling-org documents in the trail
// have no actions (their SO is cancelled through the buyer's PO).

import { db } from "@/db";
import { member, purchaseOrder, salesOrder } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireAccess } from "@/lib/auth/require-access";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getCustomerPoForTracking } from "@/server/customer-purchase-order";
import { getSalesOrderRecallBlockers, getSalesOrderCancelBlocker, getSalesOrderDeleteBlockers } from "@/server/sales-order";
import { getPurchaseOrderRecallBlockers, getPurchaseOrderCancelBlocker, getPurchaseOrderDeleteBlocker } from "@/server/purchase-order";
import { purchaseRequisitionBlockers } from "@/server/purchase-requisition";

export type TrailActionKind = "recall" | "cancel" | "delete";
export type TrailAction = { kind: TrailActionKind; allowed: boolean; reason?: string };
export interface TrailActionMap {
  so: TrailAction[];
  prs: Record<string, TrailAction[]>;
  pos: Record<string, TrailAction[]>;
}

const act = (kind: TrailActionKind, reason: string | null | undefined): TrailAction =>
  reason ? { kind, allowed: false, reason } : { kind, allowed: true };

// A blocker lookup that fails (e.g. the viewer lacks that module's read
// permission) drops the action rather than breaking the whole trail.
async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch { return undefined; }
}

export async function getTrailActions(cpoId: string): Promise<TrailActionMap | null> {
  const { orgId, userId } = await requireAccess("customer-po:read");
  const data = await getCustomerPoForTracking(cpoId);
  if (!data) return null;

  const [perms, [m]] = await Promise.all([
    getUserPermissions(userId, orgId),
    db.select({ role: member.role }).from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, orgId), isNull(member.deletedAt))).limit(1),
  ]);
  const can = (p: string) => hasAccess(perms, p);
  const isOwner = m?.role === "owner";
  const out: TrailActionMap = { so: [], prs: {}, pos: {} };

  // ── Sales Order ──
  const so = data.so;
  if (so) {
    if (so.status === "confirmed" && can("sales-order:approve")) {
      const b = await safe(() => getSalesOrderRecallBlockers(so.id));
      if (b) out.so.push(act("recall", b.length ? `Can't recall — active documents raised from it: ${b.join(", ")}` : null));
    }
    if (!["draft", "fulfilled", "cancelled"].includes(so.status) && can("sales-order:approve")) {
      const b = await safe(() => getSalesOrderCancelBlocker(so.id));
      if (b !== undefined) out.so.push(act("cancel", b));
    }
    if (!["submitted", "confirmed", "fulfilled"].includes(so.status) && can("sales-order:delete")) {
      const [row] = await db.select({ createdBy: salesOrder.createdBy }).from(salesOrder).where(eq(salesOrder.id, so.id));
      if (row?.createdBy !== userId) out.so.push(act("delete", "Only the person who created this sales order can delete it"));
      else {
        const b = await safe(() => getSalesOrderDeleteBlockers([so.id]));
        if (b) out.so.push(act("delete", b[so.id]));
      }
    }
  }

  // ── Purchase Requisitions ──
  for (const pr of data.requisitions) {
    const list: TrailAction[] = [];
    const b = await safe(() => purchaseRequisitionBlockers(pr.id));
    if (b) {
      if (pr.status === "approved" && can("purchase-requisition:approve")) list.push(act("recall", b.recall));
      if (pr.status !== "cancelled" && can("purchase-requisition:update")) list.push(act("cancel", b.cancel));
      if (pr.status === "draft" && can("purchase-requisition:delete")) list.push(act("delete", b.delete));
    }
    if (list.length) out.prs[pr.id] = list;
  }

  // ── Purchase Orders (incl. legacy PR rows kept as draft POs) ──
  const approvedAt = data.internalPos.length
    ? new Map((await db.select({ id: purchaseOrder.id, approvedAt: purchaseOrder.approvedAt }).from(purchaseOrder)
        .where(inArray(purchaseOrder.id, data.internalPos.map((p) => p.id)))).map((r) => [r.id, r.approvedAt]))
    : new Map<string, Date | null>();
  for (const po of data.internalPos) {
    const list: TrailAction[] = [];
    if (po.status === "confirmed" && can("purchase-order:approve")) {
      const b = await safe(() => getPurchaseOrderRecallBlockers(po.id));
      if (b) list.push(act("recall", b.length ? `Can't recall — active documents raised from it: ${b.join(", ")}` : null));
    }
    if (po.status === "confirmed" && can("purchase-order:update")) {
      const b = await safe(() => getPurchaseOrderCancelBlocker(po.id));
      if (b !== undefined) list.push(act("cancel", b));
    }
    if (isOwner && !approvedAt.get(po.id) && (po.status === "draft" || po.status === "cancelled")) {
      const b = await safe(() => getPurchaseOrderDeleteBlocker(po.id));
      if (b !== undefined) list.push(act("delete", b));
    }
    if (list.length) out.pos[po.id] = list;
  }

  return out;
}
