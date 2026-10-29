// Seeds the brand_conversion table from a folder of past order sheets
// (.xlsx / .ods) that have "Design Brand Code to Refer" and "Best Medical Code
// to Emboss" columns — e.g. the MINARO order folder.
//
//   pnpm tsx scripts/seed-brand-conversion.ts <folder> --org "<organization name>" [--env .env.local] [--dry-run]
//
// Every row found counts once towards its conversion; the file's modified date
// is recorded as when it was last seen. Re-running adds the counts again, so
// run it once per folder (or use the page's import for single new sheets).
import { config } from "dotenv";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const folder = args.find((a) => !a.startsWith("--") && a !== flag("--org") && a !== flag("--env"));
const orgName = flag("--org");
const dry = args.includes("--dry-run");
if (!folder || !orgName) { console.error('Usage: seed-brand-conversion.ts <folder> --org "<organization name>" [--env .env.local] [--dry-run]'); process.exit(1); }
config({ path: flag("--env") ?? ".env.local", override: true, quiet: true });

const MAX_BYTES = 30 * 1024 * 1024; // the huge picture-embedded copies hold the same rows as the small ones

(async () => {
  const { findHeaderRow, cleanText } = await import("@/lib/brand-conversion");
  const { upsertConversions } = await import("@/server/brand-conversion-core");
  type Row = import("@/server/brand-conversion-core").ConversionInput;

  const bySource = new Map<string, Row[]>();
  const skipped: string[] = [];
  for (const f of readdirSync(folder).sort()) {
    if (f.startsWith(".") || !/\.(xlsx|ods)$/i.test(f)) continue;
    const path = join(folder, f);
    const st = statSync(path);
    if (st.size > MAX_BYTES) { skipped.push(`${f} (${Math.round(st.size / 1e6)} MB)`); continue; }
    const lastSeen = st.mtime.toISOString().slice(0, 10);
    let wb: XLSX.WorkBook;
    try { wb = XLSX.readFile(path, { cellStyles: false, cellHTML: false }); } catch (e) { skipped.push(`${f} (unreadable)`); continue; }
    const rows: Row[] = [];
    for (const name of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" });
      const h = findHeaderRow(aoa);
      if (!h || h.columns.bm === undefined) continue;
      const c = h.columns;
      for (const r of aoa.slice(h.index + 1)) {
        const code = cleanText(r[c.code!]);
        const bm = cleanText(r[c.bm!]);
        if (!code || !bm) continue;
        rows.push({
          brandName: c.brand !== undefined ? cleanText(r[c.brand]) : "", brandCode: code, bestMedicalCode: bm,
          description: c.description !== undefined ? cleanText(r[c.description]) : "", uom: c.uom !== undefined ? cleanText(r[c.uom]) : "", lastSeen,
        });
      }
    }
    if (rows.length) bySource.set(f, rows);
  }

  const all = [...bySource.values()].flat();
  console.log(`${bySource.size} files, ${all.length} rows. Skipped: ${skipped.length ? skipped.join("; ") : "none"}`);
  const oddBm = [...new Set(all.map((r) => r.bestMedicalCode))].filter((v) => /\s|^n\/?a$|^-+$|^\?+$/i.test(v));
  if (oddBm.length) console.log("Unusual Best Medical values (kept — check them):", oddBm.slice(0, 20));
  if (dry) { console.log("Dry run — nothing written."); return; }

  const { db } = await import("@/db");
  const { organization } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [org] = await db.select({ id: organization.id }).from(organization).where(eq(organization.name, orgName));
  if (!org) throw new Error(`No organization named "${orgName}"`);
  console.log("Host:", new URL(process.env.DATABASE_URL!).host.split(".")[0]);
  let saved = 0, skippedRows = 0;
  for (const [f, rows] of bySource) {
    const r = await upsertConversions(org.id, rows, f);
    saved += r.saved; skippedRows += r.skipped;
  }
  console.log(`Done: ${saved} conversion rows written (before merging with existing), ${skippedRows} rows skipped.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
