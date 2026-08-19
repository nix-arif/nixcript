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
        mdaRegistrationNo: sql`COALESCE(EXCLUDED.mda_registration_no, ${product.mdaRegistrationNo})`,
        mdaPageNo: sql`COALESCE(EXCLUDED.mda_page_no, ${product.mdaPageNo})`,
        mdaValidFrom: sql`COALESCE(EXCLUDED.mda_valid_from, ${product.mdaValidFrom})`,
        mdaExpiredOn: sql`COALESCE(EXCLUDED.mda_expired_on, ${product.mdaExpiredOn})`,
        mdaPdfFile: sql`COALESCE(EXCLUDED.mda_pdf_file, ${product.mdaPdfFile})`,
        mdaMatchX: sql`COALESCE(EXCLUDED.mda_match_x, ${product.mdaMatchX})`,
        mdaMatchY: sql`COALESCE(EXCLUDED.mda_match_y, ${product.mdaMatchY})`,
        mdaRowHeight: sql`COALESCE(EXCLUDED.mda_row_height, ${product.mdaRowHeight})`,
        mdaPageWidth: sql`COALESCE(EXCLUDED.mda_page_width, ${product.mdaPageWidth})`,
        mdaPageHeight: sql`COALESCE(EXCLUDED.mda_page_height, ${product.mdaPageHeight})`,
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

// Lightweight index: letter → count. One GROUP BY query, no product rows fetched.
export async function getGlossaryIndex(): Promise<{ letter: string; count: number }[]> {
  const { orgId } = await requireAccess("product:read");
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);

  const rows = await db.execute(sql`
    SELECT
      CASE
        WHEN UPPER(LEFT(product_code, 1)) ~ '^[A-Z]$'
        THEN UPPER(LEFT(product_code, 1))
        ELSE '#'
      END AS letter,
      COUNT(DISTINCT product_code)::int AS count
    FROM product
    WHERE organization_id = ANY(ARRAY[${sql.join(ownerOrgIds.map((id) => sql`${id}`), sql`, `)}])
    GROUP BY letter
    ORDER BY letter
  `);

  const data = (rows.rows ?? rows) as { letter: string; count: number }[];
  return data.sort((a, b) => {
    if (a.letter === "#") return 1;
    if (b.letter === "#") return -1;
    return a.letter.localeCompare(b.letter);
  });
}

// Fetch one letter's products, deduplicated, paginated.
export async function getGlossaryByLetter(
  letter: string,
  page = 1,
  limit = 100,
): Promise<{ rows: GlossaryProduct[]; total: number }> {
  const { orgId } = await requireAccess("product:read");
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);

  const condition = letter === "#"
    ? and(
        inArray(product.organizationId, ownerOrgIds),
        sql`UPPER(LEFT(${product.productCode}, 1)) !~ '^[A-Z]$'`,
      )
    : and(
        inArray(product.organizationId, ownerOrgIds),
        sql`UPPER(LEFT(${product.productCode}, 1)) = ${letter}`,
      );

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(DISTINCT ${product.productCode})` })
    .from(product)
    .where(condition);

  const rows = await db
    .selectDistinctOn([product.productCode], {
      productCode: product.productCode,
      description: product.description,
      brand: product.brand,
      uom: product.uom,
      supplier: product.supplier,
      sellingUnitPrice: product.sellingUnitPrice,
      sellingPriceCurrency: product.sellingPriceCurrency,
      imageUploadedAt: product.imageUploadedAt,
    })
    .from(product)
    .where(condition)
    .orderBy(asc(product.productCode))
    .limit(limit)
    .offset((page - 1) * limit);

  return { rows, total: Number(total) };
}

// Search across all products, paginated.
export async function searchGlossary(
  query: string,
  page = 1,
  limit = 50,
): Promise<{ rows: GlossaryProduct[]; total: number }> {
  const { orgId } = await requireAccess("product:read");
  if (!query.trim()) return { rows: [], total: 0 };
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  const q = `%${query.trim()}%`;

  const condition = and(
    inArray(product.organizationId, ownerOrgIds),
    or(
      ilike(product.productCode, q),
      ilike(product.description, q),
      ilike(product.brand, q),
      ilike(product.supplier, q),
    ),
  );

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(DISTINCT ${product.productCode})` })
    .from(product)
    .where(condition);

  const rows = await db
    .selectDistinctOn([product.productCode], {
      productCode: product.productCode,
      description: product.description,
      brand: product.brand,
      uom: product.uom,
      supplier: product.supplier,
      sellingUnitPrice: product.sellingUnitPrice,
      sellingPriceCurrency: product.sellingPriceCurrency,
      imageUploadedAt: product.imageUploadedAt,
    })
    .from(product)
    .where(condition)
    .orderBy(asc(product.productCode))
    .limit(limit)
    .offset((page - 1) * limit);

  return { rows, total: Number(total) };
}

export type GlossaryProduct = {
  productCode: string;
  description: string | null;
  brand: string | null;
  uom: string | null;
  supplier: string | null;
  sellingUnitPrice: string | null;
  sellingPriceCurrency: string;
  imageUploadedAt: Date | null;
};

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

export async function getProductByCode(code: string): Promise<{
  description: string | null;
  uom: string | null;
  sourcingType: string | null;
  designBrandName: string | null;
  designBrandCode: string | null;
  privateLabelCode: string | null;
} | null> {
  if (!code.trim()) return null;
  const { orgId } = await requireAccess("product:read");
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  const [row] = await db
    .select({
      description: product.description,
      uom: product.uom,
      sourcingType: product.sourcingType,
      designBrandName: product.designBrandName,
      designBrandCode: product.designBrandCode,
      privateLabelCode: product.privateLabelCode,
    })
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
        Key: `${productCode.replace(/\//g, ":")}.jpg`,
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

export async function setProductRental(productId: string, isRental: boolean) {
  const { orgId } = await requireAccess("product:seed");
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  await db
    .update(product)
    .set({ isRental, updatedAt: new Date() })
    .where(and(eq(product.id, productId), inArray(product.organizationId, ownerOrgIds)));
}

export interface ProductSourcingInput {
  sourcingType: "trading" | "oem" | "both" | null;
  designBrandName?: string | null;
  designBrandCode?: string | null;
  privateLabelCode?: string | null;
  embossRequired?: boolean;
  qrCodeRequired?: boolean;
}

export async function updateProductSourcing(productId: string, data: ProductSourcingInput) {
  const { orgId } = await requireAccess("product:seed");
  const ownerOrgIds = await getAllOwnerOrgIds(orgId);
  await db
    .update(product)
    .set({
      sourcingType: data.sourcingType,
      designBrandName: data.designBrandName ?? null,
      designBrandCode: data.designBrandCode ?? null,
      privateLabelCode: data.privateLabelCode ?? null,
      embossRequired: data.embossRequired ?? false,
      qrCodeRequired: data.qrCodeRequired ?? false,
      updatedAt: new Date(),
    })
    .where(and(eq(product.id, productId), inArray(product.organizationId, ownerOrgIds)));
}
