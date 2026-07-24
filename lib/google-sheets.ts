import { createSign } from "crypto";

async function getAccessToken(email: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  ).toString("base64url");

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKey, "base64url");

  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Auth failed: ${data.error_description ?? JSON.stringify(data)}`);
  return data.access_token;
}

export function extractSheetId(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match?.[1] ?? null;
  } catch { return null; }
}

export async function writeToSheet(sheetId: string, values: string[][]): Promise<void> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account credentials are not configured in .env");

  const token = await getAccessToken(email, key);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;

  // Clear existing content
  await fetch(`${base}/values/A:ZZ:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  // Write new data
  const res = await fetch(`${base}/values/A1?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message ?? "Failed to write to Google Sheet");
  }
}
