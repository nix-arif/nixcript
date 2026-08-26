export type DocType = "qt" | "so" | "po" | "pr" | "gr" | "pl" | "do" | "inv" | "co";

export const DOC_TYPE_DEFAULTS: Record<DocType, { docCode: string; label: string }> = {
  qt:  { docCode: "QT",  label: "Quotation" },
  so:  { docCode: "SO",  label: "Sales Order" },
  pr:  { docCode: "PR",  label: "Purchase Requisition" },
  po:  { docCode: "PO",  label: "Purchase Order" },
  gr:  { docCode: "GR",  label: "Goods Receipt" },
  pl:  { docCode: "PL",  label: "Packing List" },
  do:  { docCode: "DO",  label: "Delivery Order" },
  inv: { docCode: "INV", label: "Invoice" },
  co:  { docCode: "CO",  label: "Consignment" },
};

export type NumberFormat = "standard" | "compact";

export interface NumberingConfig {
  prefix: string;
  docCode: string;
  separator: string;
  includeYear: number;
  paddingLength: number;
  numberFormat?: string;
}

/**
 * standard  →  INV-SI-2026-0001   (doc code · company code · year · counter, same separator)
 * compact   →  INVSI/26-0001      (doc code + company code concatenated, slash, 2-digit year, dash)
 */
export function buildDocumentNo(
  cfg: NumberingConfig,
  year: number,
  nextNo: number,
): string {
  const counter = String(nextNo).padStart(cfg.paddingLength, "0");

  if (cfg.numberFormat === "compact") {
    // INVSI/26-0001
    const code = cfg.docCode + (cfg.prefix ?? "");
    const yy = String(year).slice(-2);
    return cfg.includeYear
      ? `${code}/${yy}-${counter}`
      : `${code}-${counter}`;
  }

  // standard: INV-SI-2026-0001
  const sep = cfg.separator || "-";
  const parts: string[] = [];
  parts.push(cfg.docCode);
  if (cfg.prefix) parts.push(cfg.prefix);
  if (cfg.includeYear) parts.push(String(year));
  parts.push(counter);
  return parts.join(sep);
}
