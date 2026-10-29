// Not a "use server" file: plain helpers shared by the Brand Conversion server
// actions and scripts/seed-brand-conversion.ts (which has no user session).
import { db } from "@/db";
import { brandConversion } from "@/db/schema";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cleanText, codeKey, isCoatingVariant, normBrand } from "@/lib/brand-conversion";

export type ConversionInput = {
  brandName: string;
  brandCode: string;
  bestMedicalCode: string;
  description?: string | null;
  uom?: string | null;
  count?: number;
  lastSeen?: string | null;
};

/**
 * Records conversions for an organisation. Rows for the same brand + code +
 * Best Medical code are merged (their counts add up), and rows already in the
 * table have their use count increased, so the most-used conversion becomes
 * the default. Rows missing a code or a Best Medical code are skipped.
 */
export async function upsertConversions(orgId: string, rows: ConversionInput[], source: string): Promise<{ saved: number; skipped: number }> {
  const merged = new Map<string, Required<Pick<ConversionInput, "brandName" | "brandCode" | "bestMedicalCode">> & {
    description: string | null; uom: string | null; count: number; lastSeen: string | null; codeKey: string;
  }>();
  let skipped = 0;
  for (const r of rows) {
    const brandCode = cleanText(r.brandCode);
    const bm = cleanText(r.bestMedicalCode).toUpperCase();
    if (!brandCode || !bm) { skipped++; continue; }
    const brandName = normBrand(r.brandName);
    const key = `${brandName}|${codeKey(brandCode)}|${bm}`;
    const cur = merged.get(key);
    const rawDesc = cleanText(r.description);
    const desc = rawDesc && !isCoatingVariant(rawDesc) ? rawDesc : null;
    const seen = r.lastSeen ?? null;
    if (cur) {
      cur.count += r.count ?? 1;
      if (desc && (!cur.lastSeen || (seen ?? "") >= cur.lastSeen)) cur.description = desc;
      if (seen && (!cur.lastSeen || seen > cur.lastSeen)) cur.lastSeen = seen;
      cur.uom = cur.uom ?? (cleanText(r.uom) || null);
    } else {
      merged.set(key, { brandName, brandCode, bestMedicalCode: bm, codeKey: codeKey(brandCode), description: desc, uom: cleanText(r.uom) || null, count: r.count ?? 1, lastSeen: seen });
    }
  }
  const list = [...merged.values()];
  for (let i = 0; i < list.length; i += 150) {
    await db
      .insert(brandConversion)
      .values(list.slice(i, i + 150).map((m) => ({
        id: nanoid(), organizationId: orgId, brandName: m.brandName, brandCode: m.brandCode, codeKey: m.codeKey,
        bestMedicalCode: m.bestMedicalCode, description: m.description, uom: m.uom, useCount: m.count, lastSeen: m.lastSeen, source,
      })))
      .onConflictDoUpdate({
        target: [brandConversion.organizationId, brandConversion.brandName, brandConversion.codeKey, brandConversion.bestMedicalCode],
        set: {
          useCount: sql`${brandConversion.useCount} + excluded.use_count`,
          description: sql`coalesce(excluded.description, ${brandConversion.description})`,
          uom: sql`coalesce(${brandConversion.uom}, excluded.uom)`,
          lastSeen: sql`greatest(excluded.last_seen, ${brandConversion.lastSeen})`,
        },
      });
  }
  return { saved: list.length, skipped };
}
