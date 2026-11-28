// The draft supplier POs started from a PR (auto-saved from the PO form, never issued: no PO number,
// nothing sent to the supplier). They don't stop the PR being recalled or cancelled; they were made
// from the PR as it was, so recalling or cancelling it discards them. Server-only.

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { purchaseOrder, purchaseOrderItem, purchaseRequisitionItem } from "@/db/schema";
import { isDraftRef } from "@/lib/draft-ref";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});

export type PrPo = { id: string; poNo: string | null; status: string };

/** The PR's supplier POs, split: drafts (never issued) and the issued ones still active (not cancelled). */
export async function posOfPr(orgId: string, prId: string): Promise<{ drafts: PrPo[]; issued: PrPo[]; cancelled: PrPo[] }> {
  const rows = await db
    .select({ id: purchaseOrder.id, poNo: purchaseOrder.poNo, status: purchaseOrder.status, approvedAt: purchaseOrder.approvedAt })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.purchaseRequisitionId, prId)));
  const isDraft = (r: (typeof rows)[number]) => r.status === "draft" && isDraftRef(r.poNo) && !r.approvedAt;
  return {
    drafts: rows.filter(isDraft),
    issued: rows.filter((r) => !isDraft(r) && r.status !== "cancelled"),
    cancelled: rows.filter((r) => r.status === "cancelled"),
  };
}

/**
 * Deletes the PR's draft supplier POs, with their files: the supplier quotation and the line images —
 * but not an image the PR's own lines (or another PO) still use, as a PO line copies the PR's image.
 */
export async function discardDraftPosOfPr(orgId: string, prId: string): Promise<string[]> {
  const { drafts } = await posOfPr(orgId, prId);
  if (drafts.length === 0) return [];
  const ids = drafts.map((d) => d.id);

  const [pos, items] = await Promise.all([
    db.select({ key: purchaseOrder.supplierQuotationKey }).from(purchaseOrder).where(inArray(purchaseOrder.id, ids)),
    db.select({ key: purchaseOrderItem.imageKey }).from(purchaseOrderItem).where(inArray(purchaseOrderItem.purchaseOrderId, ids)),
  ]);
  const quotationKeys = [...new Set(pos.map((p) => p.key).filter((k): k is string => !!k))];
  const imageKeys = [...new Set(items.map((i) => i.key).filter((k): k is string => !!k))];

  // what's still used elsewhere stays
  const [usedQuotations, usedByPr, usedByPos] = await Promise.all([
    quotationKeys.length ? db.select({ key: purchaseOrder.supplierQuotationKey, id: purchaseOrder.id }).from(purchaseOrder)
      .where(inArray(purchaseOrder.supplierQuotationKey, quotationKeys)) : [],
    imageKeys.length ? db.select({ key: purchaseRequisitionItem.imageKey }).from(purchaseRequisitionItem).where(inArray(purchaseRequisitionItem.imageKey, imageKeys)) : [],
    imageKeys.length ? db.select({ key: purchaseOrderItem.imageKey, poId: purchaseOrderItem.purchaseOrderId }).from(purchaseOrderItem).where(inArray(purchaseOrderItem.imageKey, imageKeys)) : [],
  ]);
  const keep = new Set([
    ...usedQuotations.filter((u) => !ids.includes(u.id)).map((u) => u.key),
    ...usedByPr.map((u) => u.key),
    ...usedByPos.filter((u) => !ids.includes(u.poId)).map((u) => u.key),
  ]);

  await db.delete(purchaseOrder).where(inArray(purchaseOrder.id, ids)); // their lines go with them

  const del = (bucket: string | undefined, key: string) =>
    bucket ? s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })) : Promise.resolve();
  await Promise.allSettled([
    ...quotationKeys.filter((k) => !keep.has(k)).map((k) => del(process.env.R2_SUPPLIER_QUOTATION_BUCKET, k)),
    ...imageKeys.filter((k) => !keep.has(k)).map((k) => del(process.env.R2_PROCUREMENT_IMAGES_BUCKET, k)),
  ]);
  return drafts.map((d) => d.poNo ?? d.id);
}
