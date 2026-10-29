"use server";

import { db } from "@/db";
import { brandConversion, member, product } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { cleanText, codeKey, normBrand, resolveConversion, type ConversionResult, type Mapping } from "@/lib/brand-conversion";
import { upsertConversions, type ConversionInput } from "./brand-conversion-core";

const PAGE = "/dashboard/products/brand-conversion";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId: session.user.id };
}

// The product catalogue can live in a sibling company of the same owner (same
// rule the Picture Reference page uses), so descriptions are looked up across
// every company the owner owns, preferring the active one.
async function catalogueOrgIds(orgId: string): Promise<string[]> {
  const [owner] = await db.select({ userId: member.userId }).from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner"))).limit(1);
  if (!owner) return [orgId];
  const owned = await db.select({ organizationId: member.organizationId }).from(member)
    .where(and(eq(member.userId, owner.userId), eq(member.role, "owner")));
  return [...new Set([orgId, ...owned.map((o) => o.organizationId)])];
}

async function loadCatalogue(orgId: string, codes: string[]) {
  const out = new Map<string, { description: string | null; uom: string | null; own: boolean }>();
  const keys = [...new Set(codes.map(codeKey).filter(Boolean))];
  if (keys.length === 0) return out;
  const orgIds = await catalogueOrgIds(orgId);
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await db
      .select({ code: product.productCode, description: product.description, uom: product.uom, organizationId: product.organizationId })
      .from(product)
      .where(and(inArray(product.organizationId, orgIds), inArray(sql<string>`upper(${product.productCode})`, keys.slice(i, i + 500))));
    for (const r of rows) {
      const k = codeKey(r.code);
      const prev = out.get(k);
      const own = r.organizationId === orgId;
      if (!prev || (own && !prev.own) || (!prev.description && r.description)) out.set(k, { description: r.description, uom: r.uom, own });
    }
  }
  return out;
}

/** Convert a list of brand codes. Returns one result per input, in order. */
export async function convertBrandCodes(items: { brand: string; code: string }[]): Promise<ConversionResult[]> {
  const { orgId } = await requireAccess("brand-conversion:read");
  if (items.length > 5000) throw new Error("That's too many rows at once — split the sheet into smaller files");

  const keys = [...new Set(items.map((i) => codeKey(i.code)).filter(Boolean))];
  const byKey = new Map<string, Mapping[]>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await db.select().from(brandConversion)
      .where(and(eq(brandConversion.organizationId, orgId), inArray(brandConversion.codeKey, keys.slice(i, i + 500))));
    for (const r of rows) {
      const arr = byKey.get(r.codeKey) ?? [];
      arr.push({ brandName: r.brandName, bestMedicalCode: r.bestMedicalCode, description: r.description, uom: r.uom, useCount: r.useCount, lastSeen: r.lastSeen });
      byKey.set(r.codeKey, arr);
    }
  }
  // Catalogue lookups: every Best Medical code we might suggest, plus the typed codes (which may already be Best Medical codes)
  const catalogue = await loadCatalogue(orgId, [...items.map((i) => i.code), ...[...byKey.values()].flat().map((m) => m.bestMedicalCode)]);
  return items.map((it) => resolveConversion(it, byKey, catalogue));
}

/** Descriptions for codes the user typed in by hand (not-found rows). */
export async function describeCodes(codes: string[]): Promise<Record<string, { description: string; uom: string }>> {
  const { orgId } = await requireAccess("brand-conversion:read");
  const cat = await loadCatalogue(orgId, codes);
  return Object.fromEntries(codes.map((c) => [codeKey(c), { description: cat.get(codeKey(c))?.description ?? "", uom: cat.get(codeKey(c))?.uom ?? "" }]));
}

// ── Managing the conversion list ────────────────────────────────────────────

export type BrandConversionRow = typeof brandConversion.$inferSelect;

export async function listBrandConversions(input: { search?: string; offset?: number }): Promise<{ rows: BrandConversionRow[]; total: number }> {
  const { orgId } = await requireAccess("brand-conversion:read");
  const q = cleanText(input.search);
  const where = q
    ? and(eq(brandConversion.organizationId, orgId), or(
        ilike(brandConversion.brandCode, `%${q}%`), ilike(brandConversion.bestMedicalCode, `%${q}%`),
        ilike(brandConversion.brandName, `%${q}%`), ilike(brandConversion.description, `%${q}%`)))
    : eq(brandConversion.organizationId, orgId);
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(brandConversion).where(where)
      .orderBy(asc(brandConversion.brandName), asc(brandConversion.codeKey), desc(brandConversion.useCount))
      .limit(100).offset(input.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(brandConversion).where(where),
  ]);
  return { rows, total: n };
}

export async function saveBrandConversion(input: {
  id?: string; brandName: string; brandCode: string; bestMedicalCode: string; description?: string;
}): Promise<void> {
  const { orgId } = await requireAccess("brand-conversion:manage");
  const brandCode = cleanText(input.brandCode);
  const bm = cleanText(input.bestMedicalCode).toUpperCase();
  if (!brandCode) throw new Error("Enter the brand code");
  if (!bm) throw new Error("Enter the Best Medical code");
  const values = { brandName: normBrand(input.brandName), brandCode, codeKey: codeKey(brandCode), bestMedicalCode: bm, description: cleanText(input.description) || null };
  if (input.id) {
    const [clash] = await db.select({ id: brandConversion.id }).from(brandConversion).where(and(
      eq(brandConversion.organizationId, orgId), eq(brandConversion.brandName, values.brandName),
      eq(brandConversion.codeKey, values.codeKey), eq(brandConversion.bestMedicalCode, bm))).limit(1);
    if (clash && clash.id !== input.id) throw new Error("That conversion is already in the list");
    await db.update(brandConversion).set({ ...values, source: "manual" })
      .where(and(eq(brandConversion.id, input.id), eq(brandConversion.organizationId, orgId)));
  } else {
    await db.insert(brandConversion).values({ id: nanoid(), organizationId: orgId, ...values, source: "manual", lastSeen: new Date().toISOString().slice(0, 10) })
      .onConflictDoUpdate({
        target: [brandConversion.organizationId, brandConversion.brandName, brandConversion.codeKey, brandConversion.bestMedicalCode],
        set: { useCount: sql`${brandConversion.useCount} + 1`, description: values.description ?? sql`${brandConversion.description}` },
      });
  }
  revalidatePath(PAGE);
}

export async function deleteBrandConversion(id: string): Promise<void> {
  const { orgId } = await requireAccess("brand-conversion:manage");
  await db.delete(brandConversion).where(and(eq(brandConversion.id, id), eq(brandConversion.organizationId, orgId)));
  revalidatePath(PAGE);
}

/** Add conversions in bulk — from a finished order sheet, or conversions typed in on the page. */
export async function importBrandConversions(rows: ConversionInput[], source: string): Promise<{ saved: number; skipped: number }> {
  const { orgId } = await requireAccess("brand-conversion:manage");
  if (rows.length > 5000) throw new Error("That's too many rows at once — split the sheet into smaller files");
  const res = await upsertConversions(orgId, rows.map((r) => ({ ...r, lastSeen: r.lastSeen ?? new Date().toISOString().slice(0, 10) })), cleanText(source) || "import");
  revalidatePath(PAGE);
  return res;
}
