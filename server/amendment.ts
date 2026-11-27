"use server";

// The amendment history of a customer PO, sales order or supplier PO (Rev 1, Rev 2…), for its page.
// Written by lib/amendment/customer-po.ts.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerPurchaseOrder, documentAmendment, purchaseOrder, purchaseOrderItem, salesOrder, salesOrderItem, user } from "@/db/schema";
import { getSession } from "@/lib/auth/require-access";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import type { AmendmentRecord, DocSnapshot, DocType } from "@/lib/amendment/customer-po";

export async function getDocumentAmendments(docType: DocType, docId: string): Promise<AmendmentRecord[]> {
  const { orgId } = await getSession();
  const orgIds = await getOwnerOrgIds(orgId);
  try {
    const rows = await db
      .select({
        id: documentAmendment.id,
        revision: documentAmendment.revision,
        reason: documentAmendment.reason,
        changes: documentAmendment.changes,
        createdAt: documentAmendment.createdAt,
        createdByName: user.name,
      })
      .from(documentAmendment)
      .leftJoin(user, eq(user.id, documentAmendment.createdBy))
      .where(and(eq(documentAmendment.docType, docType), eq(documentAmendment.docId, docId), inArray(documentAmendment.organizationId, orgIds)))
      .orderBy(desc(documentAmendment.revision));
    return rows.map((r) => ({ id: r.id, revision: r.revision, reason: r.reason, summary: r.changes?.summary ?? [], createdAt: r.createdAt, createdByName: r.createdByName }));
  } catch {
    return []; // a database without the amendments table yet
  }
}

/** Each document's current revision (only those amended), for a list: { docId: revision }. */
export async function getDocumentRevisions(docType: DocType, docIds: string[]): Promise<Record<string, number>> {
  if (docIds.length === 0) return {};
  const { orgId } = await getSession();
  const orgIds = await getOwnerOrgIds(orgId);
  try {
    const rows = await db
      .select({ docId: documentAmendment.docId, revision: sql<number>`max(${documentAmendment.revision})::int` })
      .from(documentAmendment)
      .where(and(eq(documentAmendment.docType, docType), inArray(documentAmendment.docId, docIds), inArray(documentAmendment.organizationId, orgIds)))
      .groupBy(documentAmendment.docId);
    return Object.fromEntries(rows.map((r) => [r.docId, r.revision]));
  } catch {
    return {};
  }
}

export type DocVersion = {
  revision: number;
  /** null: not kept (amended before versions were saved) */
  snapshot: DocSnapshot | null;
  /** The amendment that made this version (none for Rev 0) */
  reason: string | null;
  createdAt: Date | null;
  createdByName: string | null;
  current: boolean;
};

// The live document as a snapshot (the same shape as one kept with a revision)
async function currentSnapshot(docType: DocType, docId: string, orgIds: string[]): Promise<DocSnapshot | null> {
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
  if (docType === "cpo") {
    const [c] = await db.select().from(customerPurchaseOrder).where(and(eq(customerPurchaseOrder.id, docId), inArray(customerPurchaseOrder.organizationId, orgIds)));
    if (!c) return null;
    const { items, ...doc } = c;
    return plain({ doc, items: items ?? [] });
  }
  if (docType === "so") {
    const [so] = await db.select().from(salesOrder).where(and(eq(salesOrder.id, docId), inArray(salesOrder.organizationId, orgIds)));
    if (!so) return null;
    const items = await db.select().from(salesOrderItem).where(eq(salesOrderItem.salesOrderId, docId)).orderBy(asc(salesOrderItem.rowNo));
    return plain({ doc: so, items });
  }
  const [po] = await db.select().from(purchaseOrder).where(and(eq(purchaseOrder.id, docId), inArray(purchaseOrder.organizationId, orgIds)));
  if (!po) return null;
  const items = await db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, docId)).orderBy(asc(purchaseOrderItem.rowNo));
  return plain({ doc: po, items });
}

/**
 * Every version of a document, oldest first: Rev 0 (as first recorded) … the current one.
 * A version's contents are what the next amendment kept as "before"; the last one is the live document.
 */
export async function getDocumentVersions(docType: DocType, docId: string): Promise<DocVersion[]> {
  const { orgId } = await getSession();
  const orgIds = await getOwnerOrgIds(orgId);
  const current = await currentSnapshot(docType, docId, orgIds);
  if (!current) return [];
  const revs = (await getDocumentAmendments(docType, docId)).slice().sort((a, b) => a.revision - b.revision);
  let befores: Record<number, DocSnapshot | undefined> = {};
  try {
    const rows = await db
      .select({ revision: documentAmendment.revision, changes: documentAmendment.changes })
      .from(documentAmendment)
      .where(and(eq(documentAmendment.docType, docType), eq(documentAmendment.docId, docId), inArray(documentAmendment.organizationId, orgIds)));
    befores = Object.fromEntries(rows.map((r) => [r.revision, r.changes?.before as DocSnapshot | undefined]));
  } catch {
    // no amendments table yet
  }
  const latest = revs.length ? revs[revs.length - 1].revision : 0;
  const out: DocVersion[] = [];
  for (let r = 0; r <= latest; r++) {
    const made = revs.find((x) => x.revision === r);
    out.push({
      revision: r,
      snapshot: r === latest ? current : befores[r + 1] ?? null,
      reason: made?.reason ?? null,
      createdAt: made?.createdAt ?? null,
      createdByName: made?.createdByName ?? null,
      current: r === latest,
    });
  }
  return out;
}
