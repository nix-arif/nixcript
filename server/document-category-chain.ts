"use server";

// The Categories card on the customer PO, sales order, PR and supplier PO pages: shows a document's
// categories and changes them. A change follows down the chain (lib/document-category/inherit.ts).

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customerPurchaseOrder, documentCategory, purchaseOrder, purchaseRequisition, salesOrder } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { cascadeCategories, mapCategoriesToOrg } from "@/lib/document-category/inherit";

export type CategoryDocKind = "cpo" | "so" | "pr" | "po";
export type CategoryOption = { id: string; name: string; color: string | null };

const TABLE = { cpo: customerPurchaseOrder, so: salesOrder, pr: purchaseRequisition, po: purchaseOrder } as const;
const PERM: Record<CategoryDocKind, string> = {
  cpo: "customer-po",
  so: "sales-order",
  pr: "purchase-requisition",
  po: "purchase-order",
};
const PATH: Record<CategoryDocKind, string> = {
  cpo: "/dashboard/sales/customer-po",
  so: "/dashboard/sales/order",
  pr: "/dashboard/procurement/requisition",
  po: "/dashboard/procurement/purchase-order",
};

async function loadDoc(kind: CategoryDocKind, id: string) {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, `${PERM[kind]}:read`)) throw new Error("Forbidden");
  const t = TABLE[kind];
  const [doc] = await db
    .select({ id: t.id, organizationId: t.organizationId, categoryIds: t.categoryIds, status: t.status })
    .from(t)
    .where(and(eq(t.id, id), inArray(t.organizationId, await getOwnerOrgIds(orgId))));
  if (!doc) throw new Error("Not found");
  return { doc, orgId, perms };
}

export async function getDocumentCategoryState(kind: CategoryDocKind, id: string): Promise<{
  selected: string[];
  options: CategoryOption[];
  canEdit: boolean;
}> {
  const { doc, orgId, perms } = await loadDoc(kind, id);
  const options = await db
    .select({ id: documentCategory.id, name: documentCategory.name, color: documentCategory.color })
    .from(documentCategory)
    .where(eq(documentCategory.organizationId, doc.organizationId))
    .orderBy(asc(documentCategory.position), asc(documentCategory.createdAt));
  const own = new Set(options.map((o) => o.id));
  return {
    selected: ((doc.categoryIds ?? []) as string[]).filter((c) => own.has(c)),
    options,
    // changed from the document's own company, and not once it's cancelled
    canEdit: doc.organizationId === orgId && doc.status !== "cancelled" && hasAccess(perms, `${PERM[kind]}:update`),
  };
}

export async function setDocumentCategories(kind: CategoryDocKind, id: string, categoryIds: string[]): Promise<string[]> {
  const { doc, orgId, perms } = await loadDoc(kind, id);
  if (doc.organizationId !== orgId) throw new Error("Switch to the company this document belongs to, to change its categories");
  if (!hasAccess(perms, `${PERM[kind]}:update`)) throw new Error("Forbidden");
  if (doc.status === "cancelled") throw new Error("A cancelled document's categories can't be changed");
  const next = await mapCategoriesToOrg(categoryIds, doc.organizationId);
  const old = (doc.categoryIds ?? []) as string[];
  const t = TABLE[kind];
  await db.update(t).set({ categoryIds: next }).where(eq(t.id, id));
  await cascadeCategories(kind, id, old, next);
  revalidatePath(`${PATH[kind]}/${id}`);
  return next;
}
