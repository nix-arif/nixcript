"use server";

import { db } from "@/db";
import { member, product } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, sql, asc, or, ilike, isNotNull, inArray } from "drizzle-orm";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Forbidden");
  return { orgId, userId: session.user.id };
}

type ProductRow = {
  productCode: string;
  description?: string;
  sellingUnitPrice?: string;
  uom?: string;
  supplier?: string;
  brand?: string;
  mdaRegistrationNo?: string;
  mdaPageNo?: string;
  mdaValidFrom?: string;
  mdaExpiredOn?: string;
  mdaPdfFile?: string;
  mdaMatchX?: string;
  mdaMatchY?: string;
  mdaRowHeight?: string;
  mdaPageWidth?: string;
  mdaPageHeight?: string;
};

export async function seedProducts(rows: ProductRow[]) {
  const { orgId } = await requireAccess("product:seed");

  const validRows = rows.filter((r) => r.productCode?.trim());
  if (!validRows.length) throw new Error("No valid rows to seed");

  const values = validRows.map((row) => ({
    id: nanoid(),
    organizationId: orgId,
    productCode: row.productCode.trim(),
    description: row.description,
    sellingUnitPrice: row.sellingUnitPrice,
    uom: row.uom,
    supplier: row.supplier,
    brand: row.brand,
    mdaRegistrationNo: row.mdaRegistrationNo,
    mdaPageNo: row.mdaPageNo,
    mdaValidFrom: row.mdaValidFrom,
    mdaExpiredOn: row.mdaExpiredOn,
    mdaPdfFile: row.mdaPdfFile,
    mdaMatchX: row.mdaMatchX,
    mdaMatchY: row.mdaMatchY,
    mdaRowHeight: row.mdaRowHeight,
    mdaPageWidth: row.mdaPageWidth,
    mdaPageHeight: row.mdaPageHeight,
  }));

  await db
    .insert(product)
    .values(values)
    .onConflictDoUpdate({
      target: [product.productCode, product.organizationId],
      set: {
        description: sql`COALESCE(EXCLUDED.description, ${product.description})`,
        sellingUnitPrice: sql`COALESCE(EXCLUDED.selling_unit_price, ${product.sellingUnitPrice})`,
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
  const { orgId } = await requireAccess("product:read");

  if (query.trim().length < 3) return [];

  const ownerOrgIds = await getAllOwnerOrgIds(orgId);

  const words = query.trim().split(/\s+/).filter(Boolean);

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
    inArray(product.organizationId, ownerOrgIds),
    ...wordConditions,
    ...(brand ? [ilike(product.brand, `%${brand}%`)] : []),
  ];

  const rows = await db
    .select()
    .from(product)
    .where(and(...conditions))
    .orderBy(asc(product.productCode))
    .limit(100);

  // Deduplicate by productCode — same product may exist in multiple owner orgs
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.productCode)) return false;
    seen.add(r.productCode);
    return true;
  }).slice(0, 50);
}

export async function getProducts(page = 1, limit = 50) {
  const { orgId } = await requireAccess("product:read");

  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(product)
    .where(inArray(product.organizationId, ownerOrgIds))
    .orderBy(asc(product.productCode))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(product)
    .where(inArray(product.organizationId, ownerOrgIds));

  return { rows, total: Number(count), page, limit };
}

// Returns all org IDs the owner of currentOrgId controls, so product queries
// work regardless of which org products were seeded into.
async function getAllOwnerOrgIds(
  currentOrgId: string,
): Promise<string[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")))
    .limit(1);

  if (!ownerMember) return [currentOrgId];

  const ownedOrgs = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")));

  const ids = ownedOrgs.map((o) => o.organizationId);
  return ids.length ? ids : [currentOrgId];
}

export async function getProductDetailsByCodes(codes: string[]) {
  const { orgId } = await requireAccess("product:read");
  if (!codes.length) return [];
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  const rows = await db
    .select({
      productCode: product.productCode,
      description: product.description,
      mdaRegistrationNo: product.mdaRegistrationNo,
      mdaValidFrom: product.mdaValidFrom,
      mdaExpiredOn: product.mdaExpiredOn,
      hasPdf: product.mdaPdfFile,
    })
    .from(product)
    .where(and(inArray(product.organizationId, ownerOrgIds), inArray(product.productCode, codes)));
  // Deduplicate by productCode
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.productCode)) return false;
    seen.add(r.productCode);
    return true;
  });
}

export async function getProductPriceDetails(codes: string[]) {
  const { orgId } = await requireAccess("product:read");
  if (!codes.length) return [];
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  const rows = await db
    .select({
      productCode: product.productCode,
      description: product.description,
      sellingUnitPrice: product.sellingUnitPrice,
      uom: product.uom,
      mdaRegistrationNo: product.mdaRegistrationNo,
    })
    .from(product)
    .where(and(inArray(product.organizationId, ownerOrgIds), inArray(product.productCode, codes)));
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.productCode)) return false;
    seen.add(r.productCode);
    return true;
  });
}

export async function getDistinctBrands() {
  const { orgId } = await requireAccess("product:read");

  const ownerOrgIds = await getAllOwnerOrgIds(orgId);

  const rows = await db
    .selectDistinct({ brand: product.brand })
    .from(product)
    .where(and(inArray(product.organizationId, ownerOrgIds), isNotNull(product.brand)))
    .orderBy(asc(product.brand));

  return rows.map((r) => r.brand).filter(Boolean) as string[];
}
