// Spreadsheet round trip for the intercompany price list. Plain constants and a browser-side reader
// (the template itself is built on the server, see lib/intercompany/price-list-workbook.ts).
import type { PriceListEntry } from "@/server/intercompany-pricing";

export const PRICE_SHEET_HEADERS = { code: "Product code", description: "Description", price: "Unit price", currency: "Currency" } as const;

export async function downloadPriceListTemplate(sellerOrgId: string, fileName: string) {
  const { createIntercompanyPriceTemplate } = await import("@/server/intercompany-pricing");
  const b64 = await createIntercompanyPriceTemplate(sellerOrgId);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// Rows with a code and a price. Rows left without a price are not an error (the template lists every product), they are only counted.
export async function readPriceListSheet(file: File): Promise<{ entries: PriceListEntry[]; blank: number }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets["Price list"] ?? wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  if (raw.length === 0) throw new Error("The sheet has no rows");
  const norm = (h: string) => h.trim().toLowerCase();
  const col = (name: string) => Object.keys(raw[0]).find((h) => norm(h) === norm(name));
  const codeCol = col(PRICE_SHEET_HEADERS.code);
  const priceCol = col(PRICE_SHEET_HEADERS.price);
  const currencyCol = col(PRICE_SHEET_HEADERS.currency);
  if (!codeCol || !priceCol) throw new Error(`Could not find the "${PRICE_SHEET_HEADERS.code}" and "${PRICE_SHEET_HEADERS.price}" columns. Use the template downloaded from this page.`);
  const entries: PriceListEntry[] = [];
  let blank = 0;
  for (const r of raw) {
    const code = String(r[codeCol] ?? "").trim();
    const price = String(r[priceCol] ?? "").trim();
    if (!code && !price) continue;
    if (code && !price) { blank++; continue; }
    entries.push({ productCode: code, unitPrice: price, currency: currencyCol ? String(r[currencyCol] ?? "").trim() || undefined : undefined });
  }
  return { entries, blank };
}
