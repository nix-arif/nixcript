// Reads the "Case Detail" tab of the case sheet (Google service account, as scripts/sync-case-sheet.ts).
// Headers are trimmed (" Sales Person"), and a repeated header gets _1 (the 2nd PAYMENT DATE, the
// surgeon's) as the sync scripts expect. Needs GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY.

import { createSign } from "crypto";

const SHEET_ID = "1q4-AlIajvMSloO_4dsnerTaKU-Yy1GrgeXqlLsq_AIA";
const TAB_NAME = "Case Detail";

// ── sheet (service account, as sync-case-sheet.ts) ──────────────────────────
const cleanKey = (raw: string) => raw.trim().replace(/^"/, "").replace(/",?$/, "").replace(/\\n/g, "\n");
async function accessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, key = cleanKey(process.env.GOOGLE_PRIVATE_KEY ?? "");
  if (!email || !key) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY missing");
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now })).toString("base64url");
  const s = createSign("RSA-SHA256"); s.update(`${h}.${p}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${p}.${s.sign(key, "base64url")}` }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error(`Google auth failed: ${d.error_description ?? JSON.stringify(d)}`);
  return d.access_token;
}
export async function sheetRows(): Promise<Record<string, string>[]> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'${TAB_NAME}'!A1:BA3000`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets API error: ${JSON.stringify(data)}`);
  const rows: string[][] = data.values ?? [];
  // headers trimmed (" Sales Person"); a repeated header (the 2nd PAYMENT DATE) gets _1, as the sync expects
  const seen = new Map<string, number>();
  const headers = (rows[0] ?? []).map((raw) => {
    const h = raw.trim(); if (!h) return "";
    const n = seen.get(h) ?? 0; seen.set(h, n + 1);
    return n === 0 ? h : `${h}_${n}`;
  });
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) o[h] = r[i] ?? ""; });
    if (!o["Sales Person"] && r[7]) o["Sales Person"] = r[7];
    return o;
  });
}

