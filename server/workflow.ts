"use server";

import { db } from "@/db";
import {
  salesOrder,
  customerPurchaseOrder,
  purchaseRequisition,
  purchaseOrder,
  goodsReceipt,
  deliveryOrder,
  invoice,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { and, eq, inArray, desc } from "drizzle-orm";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("Not signed in");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Permission denied");
  return { orgId };
}

// ── Types ────────────────────────────────────────────────────────────────────

export type WfPr  = { id: string; prNo: string; status: string; customerPoId: string | null };
export type WfPo  = { id: string; poNo: string | null; status: string; supplierName: string | null };
export type WfDo  = { id: string; doNo: string; status: string };
export type WfInv = { id: string; invoiceNo: string; status: string; grandTotal: string };

// One row = one CPO (null CPO for warranty / sample / replacement SOs)
export type WorkflowRow = {
  // CPO — null when SO has no linked CPO
  cpoId:       string | null;
  cpoNo:       string | null;
  cpoStatus:   string | null;
  cpoAmount:   string | null;
  cpoCurrency: string | null;

  // Sales Order
  soId:           string;
  soNo:           string;
  soStatus:       string;
  soCreatedAt:    Date;
  soGrandTotal:   string;
  customerName:   string | null;
  customerOrgName: string | null;

  // Procurement — lives at SO level (same across all CPO rows of the same SO)
  prs:          WfPr[];
  pos:          WfPo[];
  grCount:      number; // GRs received
  grPending:    number; // confirmed POs with no GR yet

  // Fulfilment — scoped to this CPO (or all SO docs when no CPO)
  dos:      WfDo[];
  invoices: WfInv[];

  // Rowspan helpers — SO / PR / PO / GR cells span all CPO rows of the same SO
  soRowSpan:   number;  // > 1 on first row, 0 on subsequent rows (skip render)
  isFirstInSo: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupBy<T>(arr: T[], key: (item: T) => string | null | undefined): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    if (!k) continue;
    (out[k] ??= []).push(item);
  }
  return out;
}

// ── Query ────────────────────────────────────────────────────────────────────

export async function getWorkflowSummary(): Promise<WorkflowRow[]> {
  const { orgId } = await requireAccess("sales-order:read");

  const sos = await db
    .select({
      id: salesOrder.id,
      soNo: salesOrder.soNo,
      status: salesOrder.status,
      createdAt: salesOrder.createdAt,
      grandTotal: salesOrder.grandTotal,
      customerSnapshot: salesOrder.customerSnapshot,
    })
    .from(salesOrder)
    .where(and(eq(salesOrder.organizationId, orgId), inArray(salesOrder.status, ["confirmed", "fulfilled"])))
    .orderBy(desc(salesOrder.createdAt))
    .limit(100);

  if (!sos.length) return [];

  const soIds = sos.map((s) => s.id);

  const [cpos, prs, pos, dos, invoices] = await Promise.all([
    db
      .select({
        id: customerPurchaseOrder.id,
        customerPoNo: customerPurchaseOrder.customerPoNo,
        salesOrderId: customerPurchaseOrder.salesOrderId,
        status: customerPurchaseOrder.status,
        amount: customerPurchaseOrder.amount,
        currency: customerPurchaseOrder.currency,
      })
      .from(customerPurchaseOrder)
      .where(inArray(customerPurchaseOrder.salesOrderId, soIds)),

    db
      .select({
        id: purchaseRequisition.id,
        prNo: purchaseRequisition.prNo,
        salesOrderId: purchaseRequisition.salesOrderId,
        customerPoId: purchaseRequisition.customerPoId,
        status: purchaseRequisition.status,
      })
      .from(purchaseRequisition)
      .where(and(eq(purchaseRequisition.organizationId, orgId), inArray(purchaseRequisition.salesOrderId, soIds))),

    db
      .select({
        id: purchaseOrder.id,
        poNo: purchaseOrder.poNo,
        salesOrderId: purchaseOrder.salesOrderId,
        status: purchaseOrder.status,
        supplierSnapshot: purchaseOrder.supplierSnapshot,
      })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.organizationId, orgId), inArray(purchaseOrder.salesOrderId, soIds))),

    db
      .select({
        id: deliveryOrder.id,
        doNo: deliveryOrder.doNo,
        salesOrderId: deliveryOrder.salesOrderId,
        customerPoId: deliveryOrder.customerPoId,
        status: deliveryOrder.status,
      })
      .from(deliveryOrder)
      .where(and(eq(deliveryOrder.organizationId, orgId), inArray(deliveryOrder.salesOrderId, soIds))),

    db
      .select({
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        salesOrderId: invoice.salesOrderId,
        customerPoId: invoice.customerPoId,
        status: invoice.status,
        grandTotal: invoice.grandTotal,
      })
      .from(invoice)
      .where(and(eq(invoice.organizationId, orgId), inArray(invoice.salesOrderId, soIds))),
  ]);

  const poIds = pos.map((p) => p.id);
  const grs = poIds.length
    ? await db
        .select({ id: goodsReceipt.id, purchaseOrderId: goodsReceipt.purchaseOrderId })
        .from(goodsReceipt)
        .where(inArray(goodsReceipt.purchaseOrderId, poIds))
    : [];

  const cpoBySOId   = groupBy(cpos, (c) => c.salesOrderId);
  // PRs split into CPO-linked vs SO-level (no CPO)
  const prsByCpoId  = groupBy(prs,  (p) => p.customerPoId);     // CPO-specific PRs
  const prsSoLevel  = groupBy(prs.filter((p) => !p.customerPoId), (p) => p.salesOrderId); // SO-wide PRs
  const posBySOId   = groupBy(pos,  (p) => p.salesOrderId);
  const dosByCpoId = groupBy(dos,     (d) => d.customerPoId);
  const invByCpoId = groupBy(invoices,(i) => i.customerPoId);
  const dosBySOId  = groupBy(dos,     (d) => d.salesOrderId);
  const invBySOId  = groupBy(invoices,(i) => i.salesOrderId);
  const grsByPOId  = groupBy(grs,     (g) => g.purchaseOrderId);

  const rows: WorkflowRow[] = [];

  for (const so of sos) {
    const snap    = so.customerSnapshot as { name: string; organizationName?: string } | null;
    const soCpos  = cpoBySOId[so.id] ?? [];
    const soPos   = posBySOId[so.id] ?? [];
    const grCount   = soPos.reduce((s, po) => s + (grsByPOId[po.id]?.length ?? 0), 0);
    const grPending = soPos.filter(
      (po) => po.status === "confirmed" && (grsByPOId[po.id]?.length ?? 0) === 0
    ).length;

    const soLevelPrs = (prsSoLevel[so.id] ?? []).map((p) => ({
      id: p.id, prNo: p.prNo, status: p.status, customerPoId: null,
    }));

    const common = {
      soId:            so.id,
      soNo:            so.soNo,
      soStatus:        so.status,
      soCreatedAt:     so.createdAt,
      soGrandTotal:    so.grandTotal,
      customerName:    snap?.name ?? null,
      customerOrgName: snap?.organizationName ?? null,
      pos: soPos.map((p) => {
        const s = p.supplierSnapshot as { name: string } | null;
        return { id: p.id, poNo: p.poNo, status: p.status, supplierName: s?.name ?? null };
      }),
      grCount,
      grPending,
    };

    const soRowSpan = Math.max(soCpos.length, 1);

    if (soCpos.length > 0) {
      for (let i = 0; i < soCpos.length; i++) {
        const cpo = soCpos[i];
        // PRs for this CPO = CPO-specific ones + SO-level ones (shown on first row only)
        const cpoPrs = (prsByCpoId[cpo.id] ?? []).map((p) => ({
          id: p.id, prNo: p.prNo, status: p.status, customerPoId: p.customerPoId,
        }));
        const prs = i === 0
          ? [...cpoPrs, ...soLevelPrs]  // first row gets CPO PRs + unlinked SO PRs
          : cpoPrs;                     // subsequent rows get only their CPO PRs

        rows.push({
          ...common,
          prs,
          cpoId:       cpo.id,
          cpoNo:       cpo.customerPoNo,
          cpoStatus:   cpo.status,
          cpoAmount:   cpo.amount,
          cpoCurrency: cpo.currency,
          dos:      (dosByCpoId[cpo.id] ?? []).map((d) => ({ id: d.id, doNo: d.doNo, status: d.status })),
          invoices: (invByCpoId[cpo.id] ?? []).map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, status: i.status, grandTotal: i.grandTotal })),
          soRowSpan:   i === 0 ? soRowSpan : 0,
          isFirstInSo: i === 0,
        });
      }
    } else {
      // No CPO (warranty / sample / replacement)
      rows.push({
        ...common,
        prs: soLevelPrs,
        cpoId:       null,
        cpoNo:       null,
        cpoStatus:   null,
        cpoAmount:   null,
        cpoCurrency: null,
        dos:      (dosBySOId[so.id] ?? []).map((d) => ({ id: d.id, doNo: d.doNo, status: d.status })),
        invoices: (invBySOId[so.id] ?? []).map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, status: i.status, grandTotal: i.grandTotal })),
        soRowSpan:   1,
        isFirstInSo: true,
      });
    }
  }

  return rows;
}
