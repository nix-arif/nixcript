// How far buying has got for a confirmed SO that's short of stock ("Pending PR" by its stock status
// alone). Worked out from what was raised for it, so the tag tells the truth:
//   pending-pr       nothing raised yet: a PR is needed
//   pr-raised        a PR is in, no supplier PO confirmed yet
//   ordered          a supplier PO is confirmed, nothing received: waiting for the supplier
//   partly-received  goods have come in against it, but not all the stock is there yet
//   pending-do       its stock is reserved: ready for a delivery order
// The same stage is shown on every document of the order (its customer PO, SO, PR and supplier POs).
// Server-only (reads the database); the tags are components/so-stock-chip.tsx.

import { and, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { goodsReceipt, purchaseOrder, purchaseRequisition, salesOrder } from "@/db/schema";

export type SoProcurementStage = "pending-pr" | "pr-raised" | "ordered" | "partly-received" | "pending-do";
export type SoProcurement = { stage: SoProcurementStage; prNos: string[]; poNos: string[] };

export async function soProcurementStages(orgIds: string[], soIds: string[]): Promise<Record<string, SoProcurement>> {
  if (soIds.length === 0 || orgIds.length === 0) return {};
  const sos = await db
    .select({ id: salesOrder.id, reservation: salesOrder.stockReservationStatus })
    .from(salesOrder)
    .where(and(inArray(salesOrder.id, soIds), inArray(salesOrder.organizationId, orgIds), eq(salesOrder.status, "confirmed"), inArray(salesOrder.stockReservationStatus, ["insufficient", "reserved"])));
  const reserved = new Set(sos.filter((s) => s.reservation === "reserved").map((s) => s.id));
  const ids = sos.map((s) => s.id);
  if (ids.length === 0) return {};

  const prs = await db
    .select({ id: purchaseRequisition.id, prNo: purchaseRequisition.prNo, soId: purchaseRequisition.salesOrderId })
    .from(purchaseRequisition)
    .where(and(inArray(purchaseRequisition.salesOrderId, ids), ne(purchaseRequisition.status, "cancelled"), ne(purchaseRequisition.status, "rejected")));
  const soOfPr = new Map(prs.map((p) => [p.id, p.soId as string]));
  const pos = await db
    .select({ id: purchaseOrder.id, poNo: purchaseOrder.poNo, status: purchaseOrder.status, soId: purchaseOrder.salesOrderId, prId: purchaseOrder.purchaseRequisitionId })
    .from(purchaseOrder)
    .where(and(
      ne(purchaseOrder.status, "cancelled"),
      prs.length ? or(inArray(purchaseOrder.salesOrderId, ids), inArray(purchaseOrder.purchaseRequisitionId, prs.map((p) => p.id))) : inArray(purchaseOrder.salesOrderId, ids),
    ));
  const received = pos.length
    ? new Set((await db.selectDistinct({ id: goodsReceipt.purchaseOrderId }).from(goodsReceipt)
        .where(and(inArray(goodsReceipt.purchaseOrderId, pos.map((p) => p.id)), ne(goodsReceipt.status, "recalled")))).map((r) => r.id))
    : new Set<string>();

  const out: Record<string, SoProcurement> = {};
  for (const soId of ids) {
    const myPrs = prs.filter((p) => p.soId === soId);
    const myPos = pos.filter((p) => (p.soId && p.soId === soId) || (p.prId && soOfPr.get(p.prId) === soId));
    const issued = myPos.filter((p) => p.status === "confirmed" || p.status === "fulfilled");
    const stage: SoProcurementStage =
      reserved.has(soId) ? "pending-do"
        : myPos.some((p) => received.has(p.id) || p.status === "fulfilled") ? "partly-received"
        : issued.length > 0 ? "ordered"
        : myPrs.length > 0 || myPos.length > 0 ? "pr-raised"
        : "pending-pr";
    out[soId] = { stage, prNos: myPrs.map((p) => p.prNo), poNos: (issued.length ? issued : myPos).map((p) => p.poNo ?? "").filter(Boolean) };
  }
  return out;
}
