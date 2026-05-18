"use server";

import { db } from "@/db";
import { member, product } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { eq, and, sql, asc, or, ilike, isNotNull } from "drizzle-orm";
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
        mdaRegistrationNo: sql`COALESCE(EXCLUDED.registration_no, ${product.mdaRegistrationNo})`,
        mdaPageNo: sql`COALESCE(EXCLUDED.page_no, ${product.mdaPageNo})`,
        mdaValidFrom: sql`COALESCE(EXCLUDED.valid_from, ${product.mdaValidFrom})`,
        mdaExpiredOn: sql`COALESCE(EXCLUDED.expired_on, ${product.mdaExpiredOn})`,
        mdaPdfFile: sql`COALESCE(EXCLUDED.pdf_file, ${product.mdaPdfFile})`,
        mdaMatchX: sql`COALESCE(EXCLUDED.match_x, ${product.mdaMatchX})`,
        mdaMatchY: sql`COALESCE(EXCLUDED.match_y, ${product.mdaMatchY})`,
        mdaRowHeight: sql`COALESCE(EXCLUDED.row_height, ${product.mdaRowHeight})`,
        mdaPageWidth: sql`COALESCE(EXCLUDED.page_width, ${product.mdaPageWidth})`,
        mdaPageHeight: sql`COALESCE(EXCLUDED.page_height, ${product.mdaPageHeight})`,
        updatedAt: new Date(),
      },
    });

  return { inserted: validRows.length, updated: 0, total: validRows.length };
}

export async function searchProducts(query: string, brand?: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  if (query.trim().length < 3) return [];

  const ownerOrgId = await getOwnerOrgId(session.user.id, orgId);

  // Split query into individual words — each word must match somewhere
  const words = query.trim().split(/\s+/).filter(Boolean);

  // Build a condition per word — each word must appear in at least one column
  const wordConditions = words.map((word) =>
    or(
      ilike(product.productCode, `%${word}%`),
      ilike(product.description, `%${word}%`),
      ilike(product.supplier, `%${word}%`),
      ilike(product.brand, `%${word}%`),
      ilike(product.mdaRegistrationNo, `%${word}%`),
    ),
  );

  const conditions = [
    eq(product.organizationId, ownerOrgId),
    ...wordConditions,
    // Optional brand filter
    ...(brand ? [ilike(product.brand, `%${brand}%`)] : []),
  ];

  const rows = await db
    .select()
    .from(product)
    .where(and(...conditions))
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

async function getOwnerOrgId(
  userId: string,
  currentOrgId: string,
): Promise<string> {
  // Find the owner of the current organization
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")),
    )
    .limit(1);

  if (!ownerMember) return currentOrgId;

  // Now find the primary org of that owner
  // (the org where they are owner — could be a different org)
  const [primaryOrg] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt)) // earliest org = primary org
    .limit(1);

  return primaryOrg?.organizationId ?? currentOrgId;
}

export async function getDistinctBrands() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const ownerOrgId = await getOwnerOrgId(session.user.id, orgId);

  const rows = await db
    .selectDistinct({ brand: product.brand })
    .from(product)
    .where(
      and(eq(product.organizationId, ownerOrgId), isNotNull(product.brand)),
    )
    .orderBy(asc(product.brand));

  return rows.map((r) => r.brand).filter(Boolean) as string[];
}
