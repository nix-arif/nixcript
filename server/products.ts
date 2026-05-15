"use server";

import { db } from "@/db";
import { member, product } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { eq, and, sql, asc, or, ilike } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

type ProductRow = {
  productCode: string;
  description?: string;
  unitPrice?: string;
  uom?: string;
  supplier?: string;
  brand?: string;
  registrationNo?: string;
  pageNo?: string;
  validFrom?: string;
  expiredOn?: string;
  pdfFile?: string;
  matchX?: string;
  matchY?: string;
  rowHeight?: string;
  pageWidth?: string;
  pageHeight?: string;
};

export async function seedProducts(rows: ProductRow[]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const validRows = rows.filter((r) => r.productCode?.trim());
  if (!validRows.length) throw new Error("No valid rows to seed");

  const values = validRows.map((row) => ({
    id: nanoid(),
    organizationId: orgId,
    productCode: row.productCode.trim(),
    description: row.description,
    unitPrice: row.unitPrice,
    uom: row.uom,
    supplier: row.supplier,
    brand: row.brand,
    registrationNo: row.registrationNo,
    pageNo: row.pageNo,
    validFrom: row.validFrom,
    expiredOn: row.expiredOn,
    pdfFile: row.pdfFile,
    matchX: row.matchX,
    matchY: row.matchY,
    rowHeight: row.rowHeight,
    pageWidth: row.pageWidth,
    pageHeight: row.pageHeight,
  }));

  await db
    .insert(product)
    .values(values)
    .onConflictDoUpdate({
      target: [product.productCode, product.organizationId],
      set: {
        description: sql`COALESCE(EXCLUDED.description, ${product.description})`,
        unitPrice: sql`COALESCE(EXCLUDED.unit_price, ${product.unitPrice})`,
        uom: sql`COALESCE(EXCLUDED.uom, ${product.uom})`,
        supplier: sql`COALESCE(EXCLUDED.supplier, ${product.supplier})`,
        brand: sql`COALESCE(EXCLUDED.brand, ${product.brand})`,
        registrationNo: sql`COALESCE(EXCLUDED.registration_no, ${product.registrationNo})`,
        pageNo: sql`COALESCE(EXCLUDED.page_no, ${product.pageNo})`,
        validFrom: sql`COALESCE(EXCLUDED.valid_from, ${product.validFrom})`,
        expiredOn: sql`COALESCE(EXCLUDED.expired_on, ${product.expiredOn})`,
        pdfFile: sql`COALESCE(EXCLUDED.pdf_file, ${product.pdfFile})`,
        matchX: sql`COALESCE(EXCLUDED.match_x, ${product.matchX})`,
        matchY: sql`COALESCE(EXCLUDED.match_y, ${product.matchY})`,
        rowHeight: sql`COALESCE(EXCLUDED.row_height, ${product.rowHeight})`,
        pageWidth: sql`COALESCE(EXCLUDED.page_width, ${product.pageWidth})`,
        pageHeight: sql`COALESCE(EXCLUDED.page_height, ${product.pageHeight})`,
        updatedAt: new Date(),
      },
    });

  return { inserted: validRows.length, updated: 0, total: validRows.length };
}

export async function searchProducts(query: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  if (query.trim().length < 3) return [];

  // Read from owner's org — all orgs share the same product data
  const ownerOrgId = await getOwnerOrgId(session.user.id, orgId);

  const rows = await db
    .select()
    .from(product)
    .where(
      and(
        eq(product.organizationId, ownerOrgId),
        or(
          ilike(product.productCode, `%${query}%`),
          ilike(product.description, `%${query}%`),
          ilike(product.supplier, `%${query}%`),
          ilike(product.brand, `%${query}%`),
          ilike(product.registrationNo, `%${query}%`),
        ),
      ),
    )
    .orderBy(asc(product.productCode))
    .limit(50);

  return rows;
}

export async function getProducts(page = 1, limit = 50) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const ownerOrgId = await getOwnerOrgId(session.user.id, orgId);
  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(product)
    .where(eq(product.organizationId, ownerOrgId))
    .orderBy(asc(product.productCode))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(product)
    .where(eq(product.organizationId, ownerOrgId));

  return { rows, total: Number(count), page, limit };
}

// Helper to get the owner's organization id
async function getOwnerOrgId(
  userId: string,
  currentOrgId: string,
): Promise<string> {
  // Check if current user is owner of current org
  const [currentMember] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, currentOrgId)),
    )
    .limit(1);

  if (currentMember?.role === "owner") return currentOrgId;

  // Otherwise find the org where this user is owner
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "owner")))
    .limit(1);

  return ownerMember?.organizationId ?? currentOrgId;
}
