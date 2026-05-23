export type DocType = "qt" | "so" | "po" | "do" | "inv";

export const DOC_TYPE_DEFAULTS: Record<DocType, { docCode: string; label: string }> = {
  qt:  { docCode: "QT",  label: "Quotation" },
  so:  { docCode: "SO",  label: "Sales Order" },
  po:  { docCode: "PO",  label: "Purchase Order" },
  do:  { docCode: "DO",  label: "Delivery Order" },
  inv: { docCode: "INV", label: "Invoice" },
};

export function buildDocumentNo(
  cfg: { prefix: string; docCode: string; separator: string; includeYear: number; paddingLength: number },
  year: number,
  nextNo: number,
): string {
  const sep = cfg.separator || "-";
  const parts: string[] = [];
  if (cfg.prefix) parts.push(cfg.prefix);
  parts.push(cfg.docCode);
  if (cfg.includeYear) parts.push(String(year));
  parts.push(String(nextNo).padStart(cfg.paddingLength, "0"));
  return parts.join(sep);
}
