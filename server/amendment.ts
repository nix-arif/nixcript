"use server";

// The amendment history of a customer PO, sales order or supplier PO (Rev 1, Rev 2…), for its page.
// Written by lib/amendment/customer-po.ts.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { documentAmendment, user } from "@/db/schema";
import { getSession } from "@/lib/auth/require-access";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import type { AmendmentRecord, DocType } from "@/lib/amendment/customer-po";

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
