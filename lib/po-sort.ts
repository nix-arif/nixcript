// Natural order for PO numbers, so "PO/049-26" < "PO/050-26" < "PO/100-26" (a plain
// string compare would put 100 before 50). Used to arrange packing-list lines by PO.
export const comparePoNo = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
