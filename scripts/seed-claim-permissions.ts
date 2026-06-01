import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";

const CLAIM_PERMISSIONS = [
  { key: "claim:read:own", label: "View Own Claims" },
  { key: "claim:apply",    label: "Submit Claim Application" },
  { key: "claim:approve",  label: "Approve / Reject Claims" },
  { key: "claim:manage",   label: "Manage Claim Types" },
];

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  for (const p of CLAIM_PERMISSIONS) {
    await sql`
      INSERT INTO permission (id, key, label)
      VALUES (${nanoid()}, ${p.key}, ${p.label})
      ON CONFLICT (key) DO NOTHING
    `;
    console.log(`Seeded: ${p.key}`);
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
