import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

function readEnvUrl(file: string): string {
  const content = readFileSync(file, "utf-8");
  const match = content.match(/^DATABASE_URL=(.+)$/m);
  if (!match) throw new Error(`DATABASE_URL not found in ${file}`);
  return match[1].trim().replace(/^["']|["']$/g, "");
}

async function getSchema(url: string) {
  const sql = neon(url);
  const cols = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;
  const map: Record<string, Record<string, string>> = {};
  for (const c of cols) {
    if (!map[c.table_name]) map[c.table_name] = {};
    map[c.table_name][c.column_name] = c.data_type;
  }
  return map;
}

async function run() {
  const devUrl = readEnvUrl(".env.local");
  const prodUrl = readEnvUrl(".env");

  console.log("Dev: ", devUrl.slice(0, 50));
  console.log("Prod:", prodUrl.slice(0, 50));
  console.log("");

  const [dev, prod] = await Promise.all([getSchema(devUrl), getSchema(prodUrl)]);

  const allTables = new Set([...Object.keys(dev), ...Object.keys(prod)]);
  let diffs = 0;

  for (const table of [...allTables].sort()) {
    const devCols = dev[table] ?? {};
    const prodCols = prod[table] ?? {};

    if (!dev[table]) { console.log(`TABLE ${table}: MISSING IN DEV`); diffs++; continue; }
    if (!prod[table]) { console.log(`TABLE ${table}: MISSING IN PROD`); diffs++; continue; }

    const allCols = new Set([...Object.keys(devCols), ...Object.keys(prodCols)]);
    const tableDiffs: string[] = [];

    for (const col of [...allCols].sort()) {
      const dt = devCols[col];
      const pt = prodCols[col];
      if (!dt) tableDiffs.push(`  [+prod only] ${col}: ${pt}`);
      else if (!pt) tableDiffs.push(`  [-prod miss] ${col}: ${dt}`);
      else if (dt !== pt) tableDiffs.push(`  [~type diff] ${col}: dev=${dt} | prod=${pt}`);
    }

    if (tableDiffs.length > 0) {
      console.log(`TABLE ${table}:`);
      tableDiffs.forEach(d => console.log(d));
      diffs += tableDiffs.length;
    }
  }

  console.log("");
  if (diffs === 0) console.log("No differences found — dev and prod schemas match.");
  else console.log(`Total differences: ${diffs}`);
}

run().catch(console.error);
