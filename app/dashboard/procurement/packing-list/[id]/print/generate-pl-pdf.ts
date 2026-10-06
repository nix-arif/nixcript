import { PDFDocument, PDFFont, PDFImage, PDFPage, degrees, rgb } from "pdf-lib";
import { StandardFonts } from "pdf-lib";
import {
  drawCompanyHeader, estimateHeaderH,
  wrap, trunc, fmtD, hLine, sanitizeText,
  C_DARK, C_MID, C_LITE, C_LINE, C_WHITE,
} from "@/app/dashboard/sales/quotation/[id]/print/_pdf-header";
import type { PackingListItemEnriched, PackingListWithItems } from "@/server/packing-list";

// Packing list PDF — what the supplier is sending, item by item with its
// picture, so whoever unpacks the goods can recognise each item and tick it
// off. A logistics document: no prices. Once inspected it also shows what
// was received / returned / sent for repair instead of the tick box.

export interface PlPdfOrg {
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  companyName: string | null;
  companyAddress: string | null;
  taxNo: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  oldSsmNo: string | null;
  newSsmNo: string | null;
  mdaEstablishmentNo: string | null;
  headerLayout: string | null;
  orgNameSize: string | null;
}

export type PlPdfImage = { bytes: Uint8Array; format: "jpg" | "png" };

// ── A4 ─────────────────────────────────────────────────────────────────────
const W = 595.28;
const H = 841.89;
const ML = 36;
const MR = 36;
const MB = 30;
const CW = W - ML - MR;
const ACCENT_BAR_H = 5;
const LOGO_H_MAX = 50;
const LOGO_W_MAX = 110;
const PAD = 5;
const IMG_SZ = 76;
const FOOTER_TOP = MB + 22;

function hexToRgb(hex: string | null | undefined, fallback: ReturnType<typeof rgb>) {
  const h = (hex ?? "").replace("#", "");
  if (h.length !== 6) return fallback;
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

const num = (v: string | null | undefined) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};
const qtyStr = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));

export async function generatePackingListPdf(
  pl: PackingListWithItems,
  org: PlPdfOrg,
  itemImages: Map<string, PlPdfImage>, // keyed by packing list item id
): Promise<Uint8Array> {
  const accent = hexToRgb(org.brandColor, rgb(0.05, 0.14, 0.30));
  const tint = rgb(0.965, 0.968, 0.975);
  const inspected = pl.status === "completed";
  const supplier = (pl.supplierSnapshot ?? {}) as NonNullable<PackingListWithItems["supplierSnapshot"]>;
  const poLabel = new Map(pl.purchaseOrders.map((p) => [p.id, p.poNo ?? p.prNo ?? "PO"]));

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Packing List ${pl.packingListNo}`);
  const fontR = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logoImg: PDFImage | null = null;
  if (org.logoUrl) {
    try {
      const res = await fetch(org.logoUrl, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        logoImg = buf[0] === 0x89 ? await pdf.embedPng(buf) : await pdf.embedJpg(buf);
      }
    } catch { /* no logo */ }
  }

  const images = new Map<string, PDFImage>();
  for (const [id, img] of itemImages) {
    try { images.set(id, img.format === "png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes)); }
    catch { /* unreadable image — placeholder instead */ }
  }

  // ── Columns ───────────────────────────────────────────────────────────────
  type Col = { key: string; label: string; w: number; x: number };
  const fixed: [string, string, number][] = [
    ["no", "No", 22],
    ["img", "Picture", IMG_SZ + 10],
    ["item", "Item", 118],
    ["desc", "Description", 0],
    ["qty", "Qty", 38],
    ["uom", "UOM", 34],
    ...(inspected
      ? ([["rcv", "Received", 46], ["ret", "Return / Repair", 50]] as [string, string, number][])
      : ([["chk", "Check", 34]] as [string, string, number][])),
  ];
  const descW = CW - fixed.reduce((s, c) => s + c[2], 0);
  const cols: Col[] = [];
  let cx = ML;
  for (const [key, label, w] of fixed) {
    const width = key === "desc" ? descW : w;
    cols.push({ key, label, w: width, x: cx });
    cx += width;
  }
  const col = (k: string) => cols.find((c) => c.key === k)!;

  // ── Row content ───────────────────────────────────────────────────────────
  const FS = 8.5;
  const FS_S = 7.5;
  const LH = 11;
  const LH_S = 9.5;
  type Line = { text: string; font: PDFFont; size: number; color: ReturnType<typeof rgb> };
  type Row = { item: PackingListItemEnriched; no: number; itemLines: Line[]; descLines: Line[]; h: number };

  const linesFor = (text: string, font: PDFFont, size: number, color: ReturnType<typeof rgb>, w: number): Line[] =>
    wrap(text, font, size, w).filter(Boolean).map((t) => ({ text: t, font, size, color }));

  const groups: { poId: string; rows: Row[] }[] = [];
  for (const item of pl.items) {
    let g = groups.find((x) => x.poId === item.purchaseOrderId);
    if (!g) { g = { poId: item.purchaseOrderId, rows: [] }; groups.push(g); }
    const iw = col("item").w - PAD * 2;
    const itemLines: Line[] = [
      ...linesFor(item.productCode?.trim() || "—", fontB, FS, accent, iw),
      ...(item.designBrandName?.trim() ? linesFor(`Brand: ${item.designBrandName}`, fontR, FS_S, C_MID, iw) : []),
      ...(item.designBrandCode?.trim() ? linesFor(`Design code: ${item.designBrandCode}`, fontR, FS_S, C_MID, iw) : []),
      ...(item.privateLabelCode?.trim() ? linesFor(`Emboss: ${item.privateLabelCode}`, fontR, FS_S, C_MID, iw) : []),
      ...(item.sourcingType ? linesFor(item.sourcingType === "oem" ? "OEM" : "Trading", fontB, 6.5, C_LITE, iw) : []),
    ];
    const dw = col("desc").w - PAD * 2;
    const forWhom = [item.customerName, item.customerOrganization].filter((v) => v?.trim()).join(" · ");
    const descLines: Line[] = [
      ...linesFor(item.description?.trim() || item.productCode || "—", fontR, FS, C_DARK, dw),
      ...(item.setGroupLabel?.trim() ? linesFor(`Set: ${item.setGroupLabel}`, fontR, FS_S, C_MID, dw) : []),
      ...(forWhom ? linesFor(`For: ${forWhom}${item.customerPoNo ? ` (PO ${item.customerPoNo})` : ""}`, fontR, FS_S, C_MID, dw) : []),
      ...(item.isAdditional ? linesFor("Additional item", fontB, FS_S, C_MID, dw) : []),
    ];
    const textH = (ls: Line[]) => ls.reduce((s, l) => s + (l.size >= FS ? LH : LH_S), 0) + 12;
    const h = Math.max(IMG_SZ + 12, textH(itemLines), textH(descLines));
    g.rows.push({ item, no: g.rows.length + 1, itemLines, descLines, h });
  }

  // ── Page furniture ────────────────────────────────────────────────────────
  const TABLE_HDR_H = 22;
  const GROUP_H = 18;
  const pages: PDFPage[] = [];

  const newPage = (): { page: PDFPage; y: number } => {
    const page = pdf.addPage([W, H]);
    pages.push(page);
    if (pages.length === 1) return { page, y: H };
    page.drawRectangle({ x: 0, y: H - ACCENT_BAR_H, width: W, height: ACCENT_BAR_H, color: accent });
    page.drawText(sanitizeText(`${pl.packingListNo}  ·  continued`), { x: ML, y: H - ACCENT_BAR_H - 18, size: 8, font: fontR, color: C_MID });
    return { page, y: H - ACCENT_BAR_H - 30 };
  };

  const drawTableHeader = (page: PDFPage, y: number) => {
    const top = y;
    page.drawRectangle({ x: ML, y: top - TABLE_HDR_H, width: CW, height: TABLE_HDR_H, color: accent });
    for (const c of cols) {
      const label = c.label.toUpperCase();
      const lines = wrap(label, fontB, 6.8, c.w - 4);
      let ly = top - (lines.length > 1 ? 9 : 14);
      for (const l of lines) {
        page.drawText(l, { x: c.x + (c.w - fontB.widthOfTextAtSize(l, 6.8)) / 2, y: ly, size: 6.8, font: fontB, color: C_WHITE });
        ly -= 8;
      }
    }
    return top - TABLE_HDR_H;
  };

  const drawGroupHeader = (page: PDFPage, y: number, poId: string, count: number, cont: boolean) => {
    page.drawRectangle({ x: ML, y: y - GROUP_H, width: CW, height: GROUP_H, color: tint });
    page.drawRectangle({ x: ML, y: y - GROUP_H, width: 3, height: GROUP_H, color: accent });
    const label = sanitizeText(`${poLabel.get(poId) ?? "PO"}${cont ? "  (continued)" : `  ·  ${count} item${count === 1 ? "" : "s"}`}`);
    page.drawText(label, { x: ML + 10, y: y - 12.5, size: 8.5, font: fontB, color: accent });
    return y - GROUP_H;
  };

  // ── First page header + info boxes ────────────────────────────────────────
  let { page, y } = newPage();
  const nameSize = ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string, number>)[org.orgNameSize ?? "medium"] ?? 13;
  const headerOpts = {
    companyAddress: org.companyAddress, phone: org.phone, email: org.email, website: org.website,
    oldSsmNo: org.oldSsmNo, newSsmNo: org.newSsmNo, mdaEstablishmentNo: org.mdaEstablishmentNo, taxNo: org.taxNo,
  };
  const HEADER_BLOCK = estimateHeaderH({
    ...headerOpts, nameSize, logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX, headerLayout: org.headerLayout ?? "standard",
    logoImg, fontR, skipDocLabel: true, inlineSsmMdaTax: true,
  }) + 6 + 30;
  drawCompanyHeader({
    page, startY: H - 15, accent, fontR, fontB, logoImg,
    companyName: org.companyName ?? org.name, ...headerOpts,
    nameSize, nameBold: true, nameUppercase: false,
    headerLayout: org.headerLayout ?? "standard", docLabel: "",
    docLabelSize: 7, docLabelBold: true,
    logoHMax: LOGO_H_MAX, logoWMax: LOGO_W_MAX, inlineSsmMdaTax: true,
  });
  y = H - 5 - HEADER_BLOCK;
  page.drawText("PACKING LIST", { x: ML, y: y + 8, size: 16, font: fontB, color: accent });
  const noW = fontB.widthOfTextAtSize(sanitizeText(pl.packingListNo), 11);
  page.drawText(sanitizeText(pl.packingListNo), { x: W - MR - noW, y: y + 8, size: 11, font: fontB, color: accent });
  hLine(page, y, ML, W - MR, accent, 1.2);
  y -= 16;

  {
    const FS_I = 9;
    const LH_I = 12;
    const leftW = CW * 0.55 - 3;
    const rightX = ML + CW * 0.55 + 3;
    const rightW = CW * 0.45 - 3;
    const left: Line[] = [
      { text: "SUPPLIER", font: fontB, size: FS_I, color: accent },
      ...(supplier.name ? linesFor(supplier.name, fontB, FS_I, C_DARK, leftW - 20) : [{ text: "—", font: fontR, size: FS_I, color: C_LITE }]),
      ...(supplier.contactPerson ? linesFor(supplier.contactPerson, fontR, FS_I, C_MID, leftW - 20) : []),
      ...(supplier.address ? linesFor(supplier.address, fontR, FS_I, C_LITE, leftW - 20).slice(0, 3) : []),
      ...([supplier.email, supplier.contactNo].some(Boolean) ? linesFor([supplier.email, supplier.contactNo].filter(Boolean).join("  ·  "), fontR, FS_I, C_LITE, leftW - 20) : []),
    ];
    const statusLabel = pl.status === "completed" ? "Inspected" : pl.status === "cancelled" ? "Cancelled" : "Awaiting inspection";
    const details: [string, string][] = [
      ["Packing list no", pl.packingListNo],
      ["Date", fmtD(pl.createdAt)],
      ...(pl.supplierRefNo ? [["Supplier's ref", pl.supplierRefNo]] as [string, string][] : []),
      ...(pl.expectedDate ? [["Expected", fmtD(pl.expectedDate)]] as [string, string][] : []),
      ["Purchase orders", pl.purchaseOrders.map((p) => p.poNo ?? p.prNo).filter(Boolean).join(", ") || "—"],
      ["Items", String(pl.items.length)],
      ["Status", statusLabel],
    ];
    // Values wrap (a packing list no. or a list of POs can be long) in a
    // column beside the labels
    const LBL_W = 82;
    const valW = rightW - 20 - LBL_W;
    const detailLines = details.map(([k, v]) => ({ k, lines: wrap(v, fontB, FS_I, valW).filter(Boolean) }));
    const rightLines = 1 + detailLines.reduce((s, d) => s + Math.max(1, d.lines.length), 0);
    const boxH = Math.max(left.length, rightLines) * LH_I + 16;
    page.drawRectangle({ x: ML, y: y - boxH, width: leftW, height: boxH, borderColor: accent, borderWidth: 0.6 });
    page.drawRectangle({ x: rightX, y: y - boxH, width: rightW, height: boxH, borderColor: accent, borderWidth: 0.6 });
    let ly = y - 8 - FS_I;
    for (const l of left) { page.drawText(l.text, { x: ML + 10, y: ly, size: l.size, font: l.font, color: l.color }); ly -= LH_I; }
    let ry = y - 8 - FS_I;
    page.drawText("PACKING LIST DETAILS", { x: rightX + 10, y: ry, size: FS_I, font: fontB, color: accent });
    ry -= LH_I;
    for (const d of detailLines) {
      page.drawText(`${d.k}:`, { x: rightX + 10, y: ry, size: FS_I, font: fontR, color: C_MID });
      for (const line of d.lines.length ? d.lines : ["—"]) {
        page.drawText(line, { x: rightX + 10 + LBL_W, y: ry, size: FS_I, font: fontB, color: C_DARK });
        ry -= LH_I;
      }
    }
    y -= boxH + 14;
  }

  if (pl.status === "cancelled") {
    page.drawText("CANCELLED", { x: W / 2 - 150, y: H / 2 - 40, size: 72, font: fontB, color: rgb(0.86, 0.15, 0.15), opacity: 0.18, rotate: degrees(30) });
  }

  // ── Items ────────────────────────────────────────────────────────────────
  y = drawTableHeader(page, y);
  const fits = (h: number) => y - h >= FOOTER_TOP + 4;
  const breakPage = () => { ({ page, y } = newPage()); y = drawTableHeader(page, y); };

  let stripe = 0;
  for (const g of groups) {
    if (!fits(GROUP_H + g.rows[0].h)) breakPage();
    y = drawGroupHeader(page, y, g.poId, g.rows.length, false);
    for (const r of g.rows) {
      if (!fits(r.h)) { breakPage(); y = drawGroupHeader(page, y, g.poId, g.rows.length, true); }
      const top = y;
      const bottom = y - r.h;
      if (stripe++ % 2 === 1) page.drawRectangle({ x: ML, y: bottom, width: CW, height: r.h, color: rgb(0.982, 0.983, 0.987) });
      const base = top - 13;

      // No
      const c0 = col("no");
      const ns = String(r.no);
      page.drawText(ns, { x: c0.x + (c0.w - fontB.widthOfTextAtSize(ns, 8)) / 2, y: base, size: 8, font: fontB, color: C_MID });

      // Picture
      const ci = col("img");
      const img = images.get(r.item.id);
      if (img) {
        const s = Math.min(IMG_SZ / img.width, IMG_SZ / img.height);
        const iw = img.width * s, ih = img.height * s;
        page.drawImage(img, { x: ci.x + (ci.w - iw) / 2, y: top - 6 - ih, width: iw, height: ih });
      } else {
        const bx = ci.x + (ci.w - IMG_SZ) / 2;
        page.drawRectangle({ x: bx, y: top - 6 - IMG_SZ, width: IMG_SZ, height: IMG_SZ, color: rgb(0.955, 0.955, 0.955), borderColor: C_LINE, borderWidth: 0.5 });
        const t = "No picture";
        page.drawText(t, { x: bx + (IMG_SZ - fontR.widthOfTextAtSize(t, 7)) / 2, y: top - 6 - IMG_SZ / 2 - 2, size: 7, font: fontR, color: C_LITE });
      }

      // Item + description
      for (const [k, lines] of [["item", r.itemLines], ["desc", r.descLines]] as const) {
        const c = col(k);
        let ly = base;
        for (const l of lines) {
          page.drawText(l.text, { x: c.x + PAD, y: ly, size: l.size, font: l.font, color: l.color });
          ly -= l.size >= FS ? LH : LH_S;
        }
      }

      // Qty / UOM
      const centre = (k: string, text: string, font: PDFFont, size: number, color = C_DARK) => {
        const c = col(k);
        const t = trunc(sanitizeText(text), font, size, c.w - 4);
        page.drawText(t, { x: c.x + (c.w - font.widthOfTextAtSize(t, size)) / 2, y: base, size, font, color });
      };
      centre("qty", qtyStr(num(r.item.qtyExpected)), fontB, 10);
      centre("uom", r.item.uom || "—", fontR, FS, C_MID);

      if (inspected) {
        const rcv = num(r.item.draftQtyReceived ?? r.item.qtyExpected);
        const ret = num(r.item.draftQtyReturn);
        const rep = num(r.item.draftQtyRepair);
        centre("rcv", qtyStr(rcv), fontB, 10, rcv < num(r.item.qtyExpected) ? rgb(0.7, 0.2, 0.1) : C_DARK);
        centre("ret", ret || rep ? [ret ? `${qtyStr(ret)} ret` : "", rep ? `${qtyStr(rep)} rep` : ""].filter(Boolean).join(" · ") : "—", fontR, FS, ret || rep ? rgb(0.7, 0.2, 0.1) : C_LITE);
      } else {
        const cc = col("chk");
        page.drawRectangle({ x: cc.x + (cc.w - 14) / 2, y: base - 4, width: 14, height: 14, borderColor: C_MID, borderWidth: 0.8 });
      }

      page.drawLine({ start: { x: ML, y: bottom }, end: { x: W - MR, y: bottom }, thickness: 0.4, color: C_LINE });
      y = bottom;
    }
  }

  // ── Notes, totals, sign-off ──────────────────────────────────────────────
  const totalQty = pl.items.reduce((s, i) => s + num(i.qtyExpected), 0);
  const noteLines = pl.notes ? wrap(pl.notes, fontR, 9, CW - 24).filter(Boolean) : [];
  const notesH = noteLines.length ? noteLines.length * 12 + 26 : 0;
  const signH = 70;
  if (!fits(24 + notesH + signH + 20)) ({ page, y } = newPage());

  y -= 16;
  const totalStr = `${pl.items.length} line${pl.items.length === 1 ? "" : "s"}  ·  total quantity ${qtyStr(totalQty)}`;
  page.drawText(totalStr, { x: W - MR - fontB.widthOfTextAtSize(totalStr, 9), y, size: 9, font: fontB, color: accent });
  y -= 14;

  if (noteLines.length) {
    page.drawRectangle({ x: ML, y: y - notesH, width: CW, height: notesH, color: rgb(0.955, 0.957, 0.963), borderColor: C_LINE, borderWidth: 0.4 });
    page.drawRectangle({ x: ML, y: y - notesH, width: 3, height: notesH, color: accent });
    page.drawText("NOTES", { x: ML + 10, y: y - 12, size: 7, font: fontB, color: accent });
    let ny = y - 26;
    for (const l of noteLines) { page.drawText(l, { x: ML + 10, y: ny, size: 9, font: fontR, color: C_DARK }); ny -= 12; }
    y -= notesH + 12;
  }

  // Sign-off boxes for whoever checks the goods
  const boxW = (CW - 16) / 2;
  for (const [i, label] of ["Checked by", "Received by"].entries()) {
    const bx = ML + i * (boxW + 16);
    page.drawText(label.toUpperCase(), { x: bx, y: y - 10, size: 7, font: fontB, color: accent });
    page.drawLine({ start: { x: bx, y: y - 44 }, end: { x: bx + boxW, y: y - 44 }, thickness: 0.6, color: C_MID });
    page.drawText("Name, signature & date", { x: bx, y: y - 54, size: 7, font: fontR, color: C_LITE });
  }
  if (pl.createdByName) {
    page.drawText(sanitizeText(`Prepared by: ${pl.createdByName}`), { x: ML, y: y - signH, size: 7.5, font: fontR, color: C_LITE });
  }

  // ── Footer on every page ─────────────────────────────────────────────────
  pages.forEach((p, i) => {
    p.drawRectangle({ x: 0, y: MB + 14, width: W, height: 2, color: accent });
    p.drawText(sanitizeText(pl.packingListNo), { x: ML, y: MB + 4, size: 7, font: fontR, color: C_LITE });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: (W - fontR.widthOfTextAtSize(pg, 7)) / 2, y: MB + 4, size: 7, font: fontR, color: C_LITE });
    const gen = `Printed ${fmtD(new Date())}`;
    p.drawText(gen, { x: W - MR - fontR.widthOfTextAtSize(gen, 7), y: MB + 4, size: 7, font: fontR, color: C_LITE });
  });

  return pdf.save();
}
