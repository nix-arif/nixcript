// Lot numbers for goods we receive and label ourselves (OEM):
//   01-260005-052-24        the lot of one PO line on one packing list (digits and hyphens only, no prefix)
//   01-260005-052-24-001    one piece of it (printed on the sticker, 001 up to the accepted quantity)
// 01 = company code, 26 = year and 0005 = the packing list's number, 052 = the PO's number, 24 = the PO line.
// Built only from numbers that never change, so it is the same whenever it is made, and adding or removing other
// lines on the list does not move it. Plain functions, safe for client code.

export type LotParts = { companyCode: string; packingListNo: string; poNo: string; poLine: number };

// The two number styles: "…-2026-0005" (year, then a padded sequence) and the compact "PL/005-26" (sequence, then a
// 2-digit year). A trailing group of exactly two digits is the compact style.
const compact = (s: string) => /(\d+)-(\d{2})$/.exec(s); // [1] sequence, [2] year
const standard = (s: string) => /(\d{4})-(\d{3,})$/.exec(s); // [1] year, [2] sequence

// "PL-AFFIRMA-SDN-BHD-2026-0005" -> "260005"; "PL/005-26" -> "260005"
export function packingListRef(no: string | null | undefined): string | null {
  const s = (no ?? "").trim();
  const c = compact(s);
  if (c) return `${c[2]}${c[1].padStart(4, "0")}`;
  const l = standard(s);
  return l ? `${l[1].slice(2)}${l[2].padStart(4, "0")}` : null;
}

// "PO/052-26" -> "052"; "PO/1234-26" -> "1234"; "BIO-PO-2026-0001" -> "0001" (at least 3 digits, never cut)
export function poSequence(no: string | null | undefined): string | null {
  const s = (no ?? "").trim();
  const c = compact(s);
  if (c) return c[1].padStart(3, "0");
  const l = standard(s);
  if (l) return l[2].padStart(3, "0");
  const any = /(\d+)\D*$/.exec(s);
  return any ? any[1].padStart(3, "0") : null;
}

export const isCompanyCode = (c: string | null | undefined): c is string => /^\d{2}$/.test((c ?? "").trim());

// null when a part cannot be read (the reason is in lotProblem)
export function buildLotNo(p: LotParts): string | null {
  if (!isCompanyCode(p.companyCode)) return null;
  const pl = packingListRef(p.packingListNo);
  const po = poSequence(p.poNo);
  if (!pl || !po || !Number.isInteger(p.poLine) || p.poLine < 1) return null;
  return `${p.companyCode.trim()}-${pl}-${po}-${String(p.poLine).padStart(2, "0")}`;
}

export function lotProblem(p: Partial<LotParts>): string | null {
  if (!isCompanyCode(p.companyCode)) return "the company code is not set (Organization profile)";
  if (!packingListRef(p.packingListNo)) return `the packing list number "${p.packingListNo}" cannot be read`;
  if (!poSequence(p.poNo)) return `the PO number "${p.poNo}" cannot be read`;
  if (!p.poLine || p.poLine < 1) return "the PO line number is missing";
  return null;
}

// the number on one piece's sticker
export const pieceNo = (n: number) => String(n).padStart(3, "0");
export const lotWithPiece = (lot: string, n: number) => `${lot}-${pieceNo(n)}`;
