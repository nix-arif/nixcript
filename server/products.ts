"use server";

import { db } from "@/db";
import { member, product } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, sql, asc, or, ilike, isNotNull, inArray } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
});
const PRODUCT_IMAGES_BUCKET = process.env.R2_PRODUCT_IMAGES_BUCKET!;

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

export async function getProductByCode(code: string): Promise<{ description: string | null; uom: string | null } | null> {
  if (!code.trim()) return null;
  const { orgId } = await requireAccess("product:read");
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  const [row] = await db
    .select({ description: product.description, uom: product.uom })
    .from(product)
    .where(and(inArray(product.organizationId, ownerOrgIds), ilike(product.productCode, code.trim())))
    .limit(1);
  return row ?? null;
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

export async function updateProductSellingPrices(
  rows: { productCode: string; sellingUnitPrice?: string; currency?: string; description?: string }[],
): Promise<{ updated: number }> {
  const { orgId } = await requireAccess("product:update-price");
  if (!rows.length) return { updated: 0 };

  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  const codes = [...new Set(rows.map((r) => r.productCode.trim()).filter(Boolean))];

  const existing = await db
    .select({ productCode: product.productCode, organizationId: product.organizationId })
    .from(product)
    .where(and(inArray(product.organizationId, ownerOrgIds), inArray(product.productCode, codes)));

  const existingMap = new Map<string, string>(); // productCode → orgId
  for (const e of existing) {
    if (!existingMap.has(e.productCode)) existingMap.set(e.productCode, e.organizationId);
  }

  const unknown = codes.filter((c) => !existingMap.has(c));
  if (unknown.length > 0) {
    throw new Error(
      `Update only — ${unknown.length} code${unknown.length !== 1 ? "s" : ""} not found in database: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}`,
    );
  }

  await Promise.all(
    rows.map((r) =>
      db
        .update(product)
        .set({
          ...(r.sellingUnitPrice ? { sellingUnitPrice: r.sellingUnitPrice } : {}),
          ...(r.sellingUnitPrice && r.currency ? { sellingPriceCurrency: r.currency } : {}),
          ...(r.description !== undefined && r.description !== "" ? { description: r.description } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(product.organizationId, existingMap.get(r.productCode.trim())!),
            eq(product.productCode, r.productCode.trim()),
          ),
        ),
    ),
  );

  return { updated: rows.length };
}

export async function getProductImageUploadUrls(
  items: { productCode: string; contentType: string }[],
): Promise<{ productCode: string; uploadUrl: string }[]> {
  await requireAccess("product:upload-image");
  return Promise.all(
    items.map(async ({ productCode, contentType }) => {
      const cmd = new PutObjectCommand({
        Bucket: PRODUCT_IMAGES_BUCKET,
        Key: `${productCode}.jpg`,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
      return { productCode, uploadUrl };
    }),
  );
}

export async function markProductImagesUploaded(productCodes: string[]): Promise<void> {
  if (!productCodes.length) return;
  const { orgId } = await requireAccess("product:upload-image");
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  const unique = [...new Set(productCodes.map((c) => c.trim()).filter(Boolean))];
  const now = new Date();
  await Promise.all(
    unique.map((code) =>
      db
        .update(product)
        .set({ imageUploadedAt: now })
        .where(and(inArray(product.organizationId, ownerOrgIds), eq(product.productCode, code))),
    ),
  );
}

export async function checkProductCodesExist(
  codes: string[],
): Promise<Record<string, boolean>> {
  if (!codes.length) return {};
  const { orgId } = await requireAccess("product:upload-image");
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  const rows = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(inArray(product.organizationId, ownerOrgIds), inArray(product.productCode, unique)));
  const found = new Set(rows.map((r) => r.productCode));
  return Object.fromEntries(unique.map((c) => [c, found.has(c)]));
}
