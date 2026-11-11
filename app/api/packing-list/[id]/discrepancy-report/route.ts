import { canInspectPackingList, getPackingListDetail, getPackingListDetailCentralized, type PackingListItemEnriched } from "@/server/packing-list";
import { getOrganizationBranding } from "@/server/organization-profile";
import { getProductImageUrl } from "@/helper/product-image";
import { db } from "@/db";
import { purchaseOrderItem } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts, PDFImage, PDFFont, PDFPage, PDFString } from "pdf-lib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { inspectionMediaFilename } from "@/lib/inspection-media";
import { inspectionMediaShareUrl, publicBaseUrl } from "@/lib/inspection-media-share";

export const maxDuration = 60;

interface Props {
  params: Promise<{ id: string }>;
}

// Same fallback the on-screen item thumbnail uses (ItemImageThumb in the
// packing-list clients) — a supplier's own uploaded return photo wins when
// there is one, but most items never get a photo attached during
// inspection, so without this fallback the report would show no image at
// all for the common case. Keyed by product code, same as the UI.

// ── A4 ─────────────────────────────────────────────────────────────────────
const W  = 595.28;
const H  = 841.89;
const ML = 32;
const MR = 32;
const MT = 30;
const MB = 30;
const CW = W - ML - MR;

const C_DARK   = rgb(0.10, 0.10, 0.10);
const C_MID    = rgb(0.40, 0.40, 0.40);
const C_LITE   = rgb(0.62, 0.62, 0.62);
const C_LINE   = rgb(0.88, 0.88, 0.88);
const C_ALT    = rgb(0.965, 0.966, 0.968);
const C_WHITE  = rgb(1, 1, 1);
const C_AMBER  = rgb(0.57, 0.25, 0.05);
const C_RED    = rgb(0.55, 0.13, 0.13);
const C_BRAND  = rgb(0.36, 0.27, 0.56);
const C_LINK   = rgb(0.10, 0.30, 0.75);
const C_GREEN  = rgb(0.09, 0.40, 0.20);
const C_AMBER_BG = rgb(1, 0.97, 0.88);



function sanitize(t: string): string {
  return String(t ?? "").replace(/[\x00-\x1F\x7F]/g, " ");
}

// Wraps to fit maxW — never drops content. A single word wider than maxW on
// its own gets hard-broken character by character rather than overflowing,
// so long unbroken strings (e.g. a code with no spaces) still show in full.
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  if (!text) return [];
  const words = sanitize(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxW) {
      cur = test;
      continue;
    }
    if (cur) lines.push(cur);
    if (font.widthOfTextAtSize(word, size) <= maxW) {
      cur = word;
    } else {
      let piece = "";
      for (const ch of word) {
        const next = piece + ch;
        if (font.widthOfTextAtSize(next, size) > maxW && piece) {
          lines.push(piece);
          piece = ch;
        } else {
          piece = next;
        }
      }
      cur = piece;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Only ever used on the fixed decorative footer line below, never on report
// data — every field pulled from the packing list itself is wrapped in
// full via wrap() above, not truncated.
function trunc(text: string, font: PDFFont, size: number, maxW: number): string {
  if (!text) return "";
  const t = sanitize(text).trim();
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let s = t;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

// Full date + time (not just the day) — who inspected/approved a line and
// exactly when matters for a supplier-facing discrepancy claim.
//
// Always Malaysia time: this runs on the server (UTC on Vercel), so without
// an explicit zone every time printed was 8 hours behind what the web page
// (rendered in the viewer's browser) shows for the same inspection.
const REPORT_TZ = "Asia/Kuala_Lumpur";

function fmtDateTime(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toLocaleString("en-MY", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: REPORT_TZ,
  });
}

// ── Report kinds ─────────────────────────────────────────────────────────
// Two reports share this exact rendering pipeline: the supplier-facing
// discrepancy report (short-received / returned-to-supplier lines) and the
// in-house repair report (lines sent for internal repair instead). Same
// layout, different data slice, labels, and photo category.
type ReportKind = "return" | "repair";

interface ReportConfig {
  kind: ReportKind;
  title: string;
  filenameSuffix: string;
  sheetName: string;
  flagColumnLabel: string;
  notesColumnLabel: string;
  recipientLabel: string;
  countNoun: string;
  flagLineText: (qty: number, uom: string, notes: string) => string;
  legendText: (prefix: string) => string;
}

const REPORT_CONFIGS: Record<ReportKind, ReportConfig> = {
  return: {
    kind: "return",
    title: "SUPPLIER DISCREPANCY REPORT",
    filenameSuffix: "discrepancy_report",
    sheetName: "Discrepancies",
    flagColumnLabel: "Returned",
    notesColumnLabel: "Return Notes",
    recipientLabel: "To",
    countNoun: "with issues",
    flagLineText: (qty, uom, notes) => `Returned: ${qty} ${uom} to supplier${notes ? ` — ${notes}` : ""}`,
    legendText: (prefix) =>
      `Full-resolution photos are bundled with this download in an images/ folder — ${prefix}-item-<No.>-photo.jpg and ${prefix}-item-<No.>-evidence-<n>.jpg (n = the numbered badge on each thumbnail below); some PDF viewers let you click a thumbnail to open its file directly.`,
  },
  repair: {
    kind: "repair",
    title: "IN-HOUSE REPAIR REPORT",
    filenameSuffix: "repair_report",
    sheetName: "Repairs",
    flagColumnLabel: "Repair Qty",
    notesColumnLabel: "Repair Notes",
    recipientLabel: "Supplier",
    countNoun: "sent for repair",
    flagLineText: (qty, uom, notes) => `Sent for in-house repair: ${qty} ${uom}${notes ? ` — ${notes}` : ""}`,
    legendText: (prefix) =>
      `Full-resolution photos are bundled with this download in an images/ folder — ${prefix}-item-<No.>-photo.jpg and ${prefix}-item-<No.>-evidence-<n>.jpg (n = the numbered badge on each thumbnail below); some PDF viewers let you click a thumbnail to open its file directly.`,
  },
};

type IssueItem = {
  // Sequential position of this row within the report (1, 2, 3…) — distinct
  // from poLineNo below, since a packing list can span multiple POs and a
  // reader needs both "which row in this document" and "which line on the
  // supplier's own PO" to actually locate the item.
  no: number;
  poLabel: string;
  // The line/row number on the ORIGINAL Supplier PO this item came from —
  // null only if the item somehow has no linked PO item (shouldn't happen
  // in practice, every packing list item is created from one).
  poLineNo: number | null;
  productCode: string;
  designBrandName: string | null;
  designBrandCode: string | null;
  description: string;
  uom: string;
  expected: number;
  received: number;
  shortfall: number;
  // Quantity flagged for THIS report's kind — returned-to-supplier qty on
  // the return report, repair qty on the repair report.
  returned: number;
  returnNotes: string;
  // Product identification photo — the item's own uploaded image, falling
  // back to the catalogue reference photo. Kept separate from evidence
  // photos below: this one shows WHAT the product is, not what's wrong
  // with this particular shipment.
  identityImageUrl: string | null;
  // Every photo actually attached during inspection for this line, under
  // this report's own photo category ("return" or "repair") — previously
  // only the first one was ever shown and the rest silently dropped; all of
  // them are report-worthy evidence of the finding.
  evidenceImageUrls: string[];
  // Videos can't be embedded in a PDF or spreadsheet, so each one is listed
  // with a public signed link that opens a page playing it in the browser — no
  // login needed, since the report is shared with the supplier.
  videos: { url: string; filename: string }[];
  // Inspection/approval happen per line (different reviewers can handle
  // different rows of the same packing list) — so these are per-item, not a
  // single document-level signature.
  inspectedByName: string | null;
  inspectedAt: Date | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  progress: LineProgress;
  itemId: string;
  // Interim report only — rows for lines that are NOT issues, listed so
  // every line keeps its own place in PO / line order. doneListing: an
  // approved line, shown in full with its product photo (not bundled in
  // the zip, it isn't evidence of anything). compact: a line still in
  // progress — a short text row, no photo, until it's approved.
  doneListing?: boolean;
  compact?: boolean;
  // The line's figures for THIS report were changed by an approved request
  // after inspection was completed — a problem found on a later check.
  afterInspection: { text: string; requestedAt: Date } | null;
};

type CachedImage = { buffer: Buffer; extension: "jpeg" | "png" | "gif" };

// ── Line progress ────────────────────────────────────────────────────────
// The report can be downloaded while inspection is still open (an "interim"
// report). Its figures are then the inspectors' drafts, so every line says
// where it stands: only an approved line's numbers are settled — anything
// else may still change before the packing list is completed. On a
// completed packing list every line is simply "final".
type LineProgress = "final" | "approved" | "awaiting-approval" | "rejected" | "not-inspected";

function lineProgress(item: PackingListItemEnriched, completed: boolean): LineProgress {
  if (completed) return "final";
  if (item.draftApprovalStatus === "approved") return "approved";
  if (item.draftApprovalStatus === "rejected") return "rejected";
  if (item.draftApprovalStatus === "pending" || item.draftInspectedAt) return "awaiting-approval";
  return "not-inspected";
}

const isDone = (p: LineProgress) => p === "final" || p === "approved";

const PROGRESS_LABEL: Record<LineProgress, string> = {
  "final": "FINAL",
  "approved": "DONE - approved",
  "awaiting-approval": "IN PROGRESS - inspected, awaiting approval",
  "rejected": "IN PROGRESS - rejected by approver, being re-inspected",
  "not-inspected": "IN PROGRESS - not inspected yet",
};

const PROGRESS_SHORT: Record<LineProgress, string> = {
  "final": "Final",
  "approved": "Done",
  "awaiting-approval": "Awaiting approval",
  "rejected": "Re-inspecting",
  "not-inspected": "Not inspected",
};

// One row per current (not removed) line of the packing list, issue or not,
// for the interim report's "Inspection progress" section.
type ProgressLine = {
  poLabel: string;
  poLineNo: number | null;
  productCode: string;
  description: string;
  uom: string;
  expected: number;
  // Draft figure, null while nobody has entered one yet.
  received: number | null;
  progress: LineProgress;
  inspectedByName: string | null;
};

type InterimInfo = {
  total: number;
  done: number;
  awaiting: number;
  rejected: number;
  notInspected: number;
  lines: ProgressLine[];
};

// Interim report: every current line in PO / line order, each in its own
// place and numbered 1..N straight through. Issue lines are exactly as on
// the final report; approved lines with no issue get the same picture
// layout; lines still in progress with no issue are a compact text row.
function buildInterimRows(
  items: PackingListItemEnriched[],
  poLabelById: Map<string, string>,
  poLineNoById: Map<string, number | null>,
  kind: ReportKind,
  ctx: { baseUrl: string; packingListNo: string; completed: boolean; supplementary?: boolean },
  issues: IssueItem[],
): IssueItem[] {
  const issueIds = new Set(issues.map((i) => i.itemId));
  return buildIssueItems(items, poLabelById, poLineNoById, kind, ctx, true).map((row) => {
    if (issueIds.has(row.itemId)) return row;
    const done = isDone(row.progress);
    return { ...row, evidenceImageUrls: [], videos: [], doneListing: true, compact: !done };
  });
}

function interimSummaryText(info: InterimInfo): string {
  const bits = [`${info.done} of ${info.total} line${info.total !== 1 ? "s" : ""} done (approved)`];
  if (info.awaiting) bits.push(`${info.awaiting} awaiting approval`);
  if (info.rejected) bits.push(`${info.rejected} being re-inspected`);
  if (info.notInspected) bits.push(`${info.notInspected} not inspected yet`);
  return `INTERIM - INSPECTION STILL IN PROGRESS: ${bits.join(", ")}. Figures on lines not marked DONE may still change.`;
}

function byPoThenLine(a: { poLabel: string; poLineNo: number | null }, b: { poLabel: string; poLineNo: number | null }): number {
  return a.poLabel.localeCompare(b.poLabel, undefined, { numeric: true, sensitivity: "base" })
    || (a.poLineNo ?? Number.MAX_SAFE_INTEGER) - (b.poLineNo ?? Number.MAX_SAFE_INTEGER);
}

function buildInterimInfo(
  items: PackingListItemEnriched[],
  poLabelById: Map<string, string>,
  poLineNoById: Map<string, number | null>,
): InterimInfo {
  const lines: ProgressLine[] = items.map((item) => ({
    poLabel: poLabelById.get(item.purchaseOrderId) ?? item.purchaseOrderId,
    poLineNo: item.purchaseOrderItemId ? (poLineNoById.get(item.purchaseOrderItemId) ?? null) : null,
    productCode: item.productCode ?? "",
    description: item.description ?? item.productCode ?? "",
    uom: item.uom ?? "",
    expected: parseFloat(item.qtyExpected) || 0,
    received: item.draftQtyReceived != null ? (parseFloat(item.draftQtyReceived) || 0) : null,
    progress: lineProgress(item, false),
    inspectedByName: item.draftInspectedByName,
  })).sort(byPoThenLine);
  return {
    total: lines.length,
    done: lines.filter((l) => isDone(l.progress)).length,
    awaiting: lines.filter((l) => l.progress === "awaiting-approval").length,
    rejected: lines.filter((l) => l.progress === "rejected").length,
    notInspected: lines.filter((l) => l.progress === "not-inspected").length,
    lines,
  };
}

// Fetched once, shared between both report kinds and both the PDF and Excel
// builders — best-effort per image, a failed fetch just means that one row
// renders without a picture rather than failing the whole report.
async function fetchImages(urls: (string | null)[]): Promise<Map<string, CachedImage>> {
  const cache = new Map<string, CachedImage>();
  const unique = [...new Set(urls.filter((u): u is string => !!u))];
  await Promise.all(unique.map(async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const contentType = res.headers.get("content-type") ?? "";
      const buffer = Buffer.from(await res.arrayBuffer());
      let extension: CachedImage["extension"] = "jpeg";
      if (contentType.includes("png") || /\.png(\?|$)/i.test(url)) extension = "png";
      else if (contentType.includes("gif") || /\.gif(\?|$)/i.test(url)) extension = "gif";
      cache.set(url, { buffer, extension });
    } catch { /* best-effort — skip this image */ }
  }));
  return cache;
}

// ── Line items ───────────────────────────────────────────────────────────

// Approved "correct the figures" requests that touched what this report is
// about — received/returned for the discrepancy report, repair for the repair
// report — summarised as one line: first figures before, latest after.
function afterInspectionChange(item: PackingListItemEnriched, kind: ReportKind): IssueItem["afterInspection"] {
  const relevant = (item.amendments ?? []).filter((a) => a.status === "approved" && a.kind === "amend" && (kind === "return"
    ? a.oldQtyReceived !== a.newQtyReceived || a.oldQtyReturn !== a.newQtyReturn
    : a.oldQtyRepair !== a.newQtyRepair));
  if (relevant.length === 0) return null;
  const first = relevant[0];
  const last = relevant[relevant.length - 1];
  const uom = item.uom ? ` ${item.uom}` : "";
  const figures = kind === "return"
    ? [
        first.oldQtyReceived !== last.newQtyReceived ? `Received ${first.oldQtyReceived} -> ${last.newQtyReceived}${uom}` : null,
        first.oldQtyReturn !== last.newQtyReturn ? `Returned ${first.oldQtyReturn} -> ${last.newQtyReturn}${uom}` : null,
      ].filter(Boolean).join(", ")
    : `Repair ${first.oldQtyRepair} -> ${last.newQtyRepair}${uom}`;
  const who = `reported ${fmtDateTime(last.requestedAt)} by ${last.requestedByName ?? "someone"}`
    + (last.decidedAt ? `, approved by ${last.decidedByName ?? "someone"} on ${fmtDateTime(last.decidedAt)}` : "");
  const times = relevant.length > 1 ? ` (${relevant.length} changes)` : "";
  return {
    // The request's "why" is an internal note to the approver — not printed
    // on a supplier-facing report; the return / repair notes say what's wrong.
    text: `FOUND AFTER INSPECTION${times}: ${figures || "notes changed"} - ${who}`,
    requestedAt: last.requestedAt,
  };
}

function buildIssueItems(
  items: PackingListItemEnriched[],
  poLabelById: Map<string, string>,
  poLineNoById: Map<string, number | null>,
  kind: ReportKind,
  ctx: { baseUrl: string; packingListNo: string; completed: boolean; supplementary?: boolean },
  includeAll = false,
): IssueItem[] {
  return items
    .map((item): Omit<IssueItem, "no"> | null => {
      const expected = parseFloat(item.qtyExpected) || 0;
      const received = parseFloat(item.draftQtyReceived ?? item.qtyExpected) || 0;
      const shortfall = Math.max(0, expected - received);
      const returnQty = parseFloat(item.draftQtyReturn ?? "0") || 0;
      const repairQty = parseFloat(item.draftQtyRepair ?? "0") || 0;
      const flagQty = kind === "return" ? returnQty : repairQty;
      const flagNotes = kind === "return" ? (item.draftReturnNotes ?? "") : (item.draftRepairNotes ?? "");
      // The return report also surfaces a plain shortfall (received < expected)
      // even with nothing formally returned; the repair report only ever
      // includes a line when something was actually sent for repair.
      const include = kind === "return" ? (shortfall > 0 || returnQty > 0) : repairQty > 0;
      if (!include && !includeAll) return null;

      // Only photos are embedded; videos are listed with download links. A
      // supplementary report carries only the evidence added with the
      // after-inspection change — the original evidence went out already.
      const lineMedia = item.photos.filter((p) => p.category === kind && (!ctx.supplementary || !!p.amendmentId));
      const evidencePhotos = lineMedia.filter((p) => p.kind !== "video");
      const videos = lineMedia
        .filter((p) => p.kind === "video")
        .map((p, idx) => ({
          // public signed link — the report goes to the supplier, who has no login
          url: inspectionMediaShareUrl(ctx.baseUrl, p.id),
          filename: inspectionMediaFilename(ctx.packingListNo, item.rowNo, kind, idx + 1, p.imageKey),
        }));
      const catalogImageUrl = item.productCode ? getProductImageUrl(item.productCode) || null : null;
      return {
        poLabel: poLabelById.get(item.purchaseOrderId) ?? item.purchaseOrderId,
        poLineNo: item.purchaseOrderItemId ? (poLineNoById.get(item.purchaseOrderItemId) ?? null) : null,
        productCode: item.productCode ?? "",
        designBrandName: item.designBrandName?.trim() ? item.designBrandName : null,
        designBrandCode: item.designBrandCode?.trim() ? item.designBrandCode : null,
        description: item.description ?? item.productCode ?? "",
        uom: item.uom ?? "",
        expected,
        received,
        shortfall,
        returned: flagQty,
        returnNotes: flagNotes,
        identityImageUrl: item.imageUrl ?? catalogImageUrl,
        evidenceImageUrls: evidencePhotos.map((p) => p.url),
        videos,
        inspectedByName: item.draftInspectedByName,
        inspectedAt: item.draftInspectedAt,
        approvedByName: item.draftApprovedByName,
        approvedAt: item.draftApprovedAt,
        progress: lineProgress(item, ctx.completed),
        itemId: item.id,
        afterInspection: afterInspectionChange(item, kind),
      };
    })
    .filter((i): i is Omit<IssueItem, "no"> => i !== null)
    // Lowest PO no. first, then the lowest PO line no. within it (natural
    // order, so PO-2 comes before PO-10); a line with no PO line goes last.
    // Array.sort is stable, so ties keep the packing list's own order.
    .sort(byPoThenLine)
    // Numbered only after sorting and filtering, so the sequence is 1..N in
    // the order the report shows, not the packing list's full item list.
    .map((issue, idx) => ({ ...issue, no: idx + 1 }));
}

// ── Full-res image bundling ─────────────────────────────────────────────
// The PDF only ever shows small thumbnails (limited page space), so the
// same images fetched for those thumbnails are also handed out as
// full-resolution files alongside the PDF, named to match the caption
// printed under/on each thumbnail — a reader can go straight from a photo
// in the report to its full-size file without guessing which is which.
// Prefixed by report kind ("return"/"repair") since both reports' images
// can end up bundled together in the same zip's images/ folder.
function extOf(cached: CachedImage): string {
  return cached.extension === "jpeg" ? "jpg" : cached.extension;
}

function identityFilename(issue: IssueItem, images: Map<string, CachedImage>, prefix: string): string | null {
  if (!issue.identityImageUrl || issue.doneListing) return null;
  const cached = images.get(issue.identityImageUrl);
  if (!cached) return null;
  return `${prefix}-item-${issue.no}-photo.${extOf(cached)}`;
}

function evidenceFilename(issue: IssueItem, idx: number, images: Map<string, CachedImage>, prefix: string): string | null {
  const cached = images.get(issue.evidenceImageUrls[idx]);
  if (!cached) return null;
  return `${prefix}-item-${issue.no}-evidence-${idx + 1}.${extOf(cached)}`;
}

function buildImageZipEntries(issues: IssueItem[], images: Map<string, CachedImage>, prefix: string): { name: string; buffer: Buffer }[] {
  const entries: { name: string; buffer: Buffer }[] = [];
  for (const issue of issues) {
    const idFn = identityFilename(issue, images, prefix);
    if (idFn) entries.push({ name: `images/${idFn}`, buffer: images.get(issue.identityImageUrl!)!.buffer });
    issue.evidenceImageUrls.forEach((url, idx) => {
      const fn = evidenceFilename(issue, idx, images, prefix);
      if (fn) entries.push({ name: `images/${fn}`, buffer: images.get(url)!.buffer });
    });
  }
  return entries;
}

// ── Excel ────────────────────────────────────────────────────────────────

async function buildXlsxBuffer(
  config: ReportConfig,
  packingListNo: string,
  supplierRefNo: string | null,
  supplierName: string,
  companyName: string,
  brandColorHex: string,
  issues: IssueItem[],
  images: Map<string, CachedImage>,
  interim: InterimInfo | null,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(config.sheetName);
  const accentArgb = `FF${brandColorHex.replace("#", "").toUpperCase()}`;
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFD1D5DB" } },
    left: { style: "thin", color: { argb: "FFD1D5DB" } },
    bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
    right: { style: "thin", color: { argb: "FFD1D5DB" } },
  };

  const maxEvidence = issues.reduce((max, i) => Math.max(max, i.evidenceImageUrls.length), 0);
  const baseHeaders = ["No.", "Status", "Image", "PO", "PO Line", "Product Code", "Design Brand", "Design Code", "Description", "UOM", "Expected", "Received", "Short", config.flagColumnLabel, config.notesColumnLabel, "Inspected By", "Inspected At", "Approved By", "Approved At", "Found After Inspection"];
  const evidenceHeaders = Array.from({ length: maxEvidence }, (_, i) => `Evidence Photo ${i + 1}`);
  const maxVideos = issues.reduce((max, i) => Math.max(max, i.videos.length), 0);
  const videoHeaders = Array.from({ length: maxVideos }, (_, i) => `Video ${i + 1} (click to play)`);
  const headers = [...baseHeaders, ...evidenceHeaders, ...videoHeaders];
  const totalCols = headers.length;

  sheet.mergeCells(1, 1, 1, totalCols);
  sheet.getCell(1, 1).value = interim ? `${config.title} - INTERIM` : config.title;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };

  sheet.mergeCells(2, 1, 2, totalCols);
  sheet.getCell(2, 1).value = `Packing List ${packingListNo}${supplierRefNo ? `  ·  Supplier ref ${supplierRefNo}` : ""}`;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: "FF666666" } };

  sheet.mergeCells(3, 1, 3, totalCols);
  const dateStr = new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: REPORT_TZ });
  sheet.getCell(3, 1).value = `${config.recipientLabel}: ${supplierName}  ·  From: ${companyName}  ·  ${dateStr}`;
  sheet.getCell(3, 1).font = { size: 9, color: { argb: "FF888888" } };

  // Row 4: blank on a completed report, the in-progress warning otherwise —
  // either way exactly one row, so the image anchor maths below holds.
  sheet.addRow([]);
  if (interim) {
    sheet.mergeCells(4, 1, 4, totalCols);
    const cell = sheet.getCell(4, 1);
    cell.value = `${interimSummaryText(interim)} See the "Inspection Progress" sheet for every line.`;
    cell.font = { bold: true, size: 10, color: { argb: "FF92400E" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(4).height = 30;
  }

  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accentArgb } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = thinBorder;
  });

  const IMG_PX = 80;
  const ROW_HEIGHT_PT = 62; // ~80px tall image plus a little breathing room
  const IMAGE_COL = baseHeaders.indexOf("Image");
  const DESC_COL = baseHeaders.indexOf("Description");
  const NOTES_COL = baseHeaders.indexOf(config.notesColumnLabel);
  const AFTER_COL = baseHeaders.indexOf("Found After Inspection");
  const EVIDENCE_START_COL = baseHeaders.length;

  function embedImage(url: string | null | undefined, colIndex0: number, rowIndex0: number) {
    const cached = url ? images.get(url) : undefined;
    if (!cached) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs's Buffer type doesn't line up with Node's here; same cast used in app/api/products/picture-ref/route.ts
    const imageId = workbook.addImage({ buffer: cached.buffer as any, extension: cached.extension === "gif" ? "png" : cached.extension });
    sheet.addImage(imageId, {
      tl: { col: colIndex0 + 0.1, row: rowIndex0 + 0.1 },
      ext: { width: IMG_PX, height: IMG_PX },
    });
  }

  const FLAG_COL = baseHeaders.indexOf(config.flagColumnLabel);

  issues.forEach((issue, i) => {
    const row = sheet.addRow([
      issue.no,
      PROGRESS_SHORT[issue.progress],
      "",
      issue.poLabel,
      issue.poLineNo ?? "",
      issue.productCode,
      issue.designBrandName ?? "",
      issue.designBrandCode ?? "",
      issue.description,
      issue.uom,
      issue.expected,
      issue.received,
      issue.shortfall || null,
      issue.returned || null,
      issue.returnNotes,
      issue.inspectedByName ?? "",
      fmtDateTime(issue.inspectedAt),
      issue.approvedByName ?? "",
      fmtDateTime(issue.approvedAt),
      issue.afterInspection?.text ?? "",
      ...issue.evidenceImageUrls.map(() => ""),
      ...Array.from({ length: maxEvidence - issue.evidenceImageUrls.length }, () => ""),
      ...issue.videos.map((v) => ({ text: v.filename, hyperlink: v.url })),
    ]);
    row.height = ROW_HEIGHT_PT;
    row.eachCell((cell, colNum) => {
      cell.border = thinBorder;
      const colIndex0 = colNum - 1;
      const isTextCol = colIndex0 === DESC_COL || colIndex0 === NOTES_COL || colIndex0 === AFTER_COL;
      cell.alignment = { vertical: "middle", wrapText: isTextCol, horizontal: isTextCol ? "left" : "center" };
    });
    issue.videos.forEach((_, vi) => {
      const cell = row.getCell(baseHeaders.length + maxEvidence + vi + 1);
      cell.font = { color: { argb: "FF1A4DBF" }, underline: true, size: 8 };
      cell.alignment = { vertical: "middle", wrapText: true, horizontal: "left" };
    });
    row.getCell(baseHeaders.indexOf("No.") + 1).font = { bold: true };
    row.getCell(baseHeaders.indexOf("Status") + 1).font = isDone(issue.progress)
      ? { bold: true, color: { argb: "FF166534" } }
      : { bold: true, color: { argb: "FF92400E" } };
    if (issue.shortfall > 0) row.getCell(baseHeaders.indexOf("Short") + 1).font = { bold: true, color: { argb: "FF92400E" } };
    if (issue.returned > 0) row.getCell(FLAG_COL + 1).font = { bold: true, color: { argb: "FFB91C1C" } };

    // header(row1) + pl-no(row2) + to/from(row3) + blank/interim(row4) + col-header(row5) + this row (1-indexed) -> 0-indexed anchor row
    const rowIndex0 = 5 + i;
    embedImage(issue.identityImageUrl, IMAGE_COL, rowIndex0);
    issue.evidenceImageUrls.forEach((url, ei) => embedImage(url, EVIDENCE_START_COL + ei, rowIndex0));
  });

  sheet.columns = [
    { width: 6 },   // No.
    { width: 16 },  // Status
    { width: 12 },  // Image
    { width: 12 },  // PO
    { width: 9 },   // PO Line
    { width: 14 },  // Product Code
    { width: 16 },  // Design Brand
    { width: 14 },  // Design Code
    { width: 40 },  // Description
    { width: 7 },   // UOM
    { width: 9 },   // Expected
    { width: 9 },   // Received
    { width: 7 },   // Short
    { width: 9 },   // flag qty
    { width: 32 },  // flag notes
    { width: 16 },  // Inspected By
    { width: 16 },  // Inspected At
    { width: 16 },  // Approved By
    { width: 16 },  // Approved At
    { width: 48 },  // Found After Inspection
    ...evidenceHeaders.map(() => ({ width: 12 })),
    ...videoHeaders.map(() => ({ width: 30 })),
  ];

  if (interim) addProgressSheet(workbook, interim, accentArgb, thinBorder);

  const buf = await workbook.xlsx.writeBuffer();
  return buf as unknown as Buffer;
}

// Every current line with where its inspection stands — done lines and the
// ones still in progress, so the reader knows which part of the report is
// settled.
function addProgressSheet(workbook: ExcelJS.Workbook, interim: InterimInfo, accentArgb: string, thinBorder: Partial<ExcelJS.Borders>) {
  const sheet = workbook.addWorksheet("Inspection Progress");
  const headers = ["PO", "PO Line", "Product Code", "Description", "UOM", "Expected", "Received (draft)", "Status", "Inspected By"];
  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell(1, 1).value = "INSPECTION PROGRESS";
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  sheet.mergeCells(2, 1, 2, headers.length);
  sheet.getCell(2, 1).value = interimSummaryText(interim);
  sheet.getCell(2, 1).font = { bold: true, size: 10, color: { argb: "FF92400E" } };
  sheet.getCell(2, 1).alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(2).height = 30;
  sheet.addRow([]);
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accentArgb } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = thinBorder;
  });
  for (const line of interim.lines) {
    const row = sheet.addRow([
      line.poLabel, line.poLineNo ?? "", line.productCode, line.description, line.uom,
      line.expected, line.received ?? "", PROGRESS_LABEL[line.progress], line.inspectedByName ?? "",
    ]);
    row.eachCell((cell, colNum) => {
      cell.border = thinBorder;
      cell.alignment = { vertical: "middle", wrapText: colNum === 4 || colNum === 8, horizontal: colNum === 4 || colNum === 8 ? "left" : "center" };
    });
    const done = isDone(line.progress);
    row.getCell(8).font = { bold: true, color: { argb: done ? "FF166534" : "FF92400E" } };
    if (!done) {
      row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } }; });
    }
  }
  sheet.columns = [
    { width: 12 }, { width: 9 }, { width: 14 }, { width: 40 }, { width: 7 },
    { width: 10 }, { width: 14 }, { width: 34 }, { width: 18 },
  ];
}

// ── PDF ──────────────────────────────────────────────────────────────────

type Measured = {
  issue: IssueItem;
  headerLines: string[];
  statusLines: string[];
  brandLine: string[];
  descLines: string[];
  returnLines: string[];
  afterLines: string[];
  evidenceRows: number;
  evidenceThumbsPerRow: number;
  reviewLines: string[];
  height: number;
};

const NO_COL_W = 24;
const IMG_COL_W = 92;
const IMG_SZ = 72;
const IMG_CAPTION_GAP = 3;
const IMG_CAPTION_SIZE = 5.5;
// Image + its filename caption, stacked as one centered block within the row.
const IMG_BLOCK_H = IMG_SZ + IMG_CAPTION_GAP + IMG_CAPTION_SIZE;
const HEADER_LINE_H = 12;
const TEXT_LINE_H = 10.5;
const RETURN_LINE_H = 9.5;
const ROW_V_PAD = 14;
const ROW_MIN_H = IMG_BLOCK_H + ROW_V_PAD;
const EVID_THUMB = 34;
const EVID_GAP = 5;
const EVID_LABEL_H = 11;
const VIDEO_LINE_H = 10;

function measure(issue: IssueItem, fontR: PDFFont, fontB: PDFFont, detMaxW: number, config: ReportConfig, interim: boolean): Measured {
  const poLineText = issue.poLineNo !== null ? `  ·  PO Line ${issue.poLineNo}` : "";
  const headerLines = wrap(`[${issue.poLabel}]  ${issue.productCode}${poLineText}`, fontB, 8.5, detMaxW);

  const brandBits: string[] = [];
  if (issue.designBrandName) brandBits.push(`Design Brand: ${issue.designBrandName}`);
  if (issue.designBrandCode) brandBits.push(`Code: ${issue.designBrandCode}`);
  const brandLine = brandBits.length > 0 ? wrap(brandBits.join("  ·  "), fontR, 8, detMaxW) : [];

  const descLines = wrap(issue.description, fontR, 8, detMaxW);
  const returnLine = issue.returned > 0 ? config.flagLineText(issue.returned, issue.uom, issue.returnNotes) : "";
  const returnLines = returnLine ? wrap(returnLine, fontR, 7.5, detMaxW) : [];
  const afterLines = issue.afterInspection ? wrap(issue.afterInspection.text, fontB, 7, detMaxW) : [];

  const evidenceThumbsPerRow = Math.max(1, Math.floor(detMaxW / (EVID_THUMB + EVID_GAP)));
  const evidenceRows = issue.evidenceImageUrls.length > 0
    ? Math.ceil(issue.evidenceImageUrls.length / evidenceThumbsPerRow)
    : 0;

  const reviewBits: string[] = [];
  if (issue.inspectedByName) reviewBits.push(`Inspected by ${issue.inspectedByName} on ${fmtDateTime(issue.inspectedAt)}`);
  if (issue.approvedByName) reviewBits.push(`Approved by ${issue.approvedByName} on ${fmtDateTime(issue.approvedAt)}`);
  const reviewLines = reviewBits.length > 0 ? wrap(reviewBits.join("  ·  "), fontR, 7, detMaxW) : [];

  const statusLines = interim ? wrap(`Status: ${PROGRESS_LABEL[issue.progress]}`, fontB, 7.5, detMaxW) : [];

  const textH = headerLines.length * HEADER_LINE_H
    + statusLines.length * TEXT_LINE_H
    + brandLine.length * TEXT_LINE_H
    + descLines.length * TEXT_LINE_H
    + TEXT_LINE_H // expected/received line, always present
    + (issue.shortfall > 0 ? TEXT_LINE_H : 0)
    + returnLines.length * RETURN_LINE_H
    + afterLines.length * RETURN_LINE_H
    + (evidenceRows > 0 ? EVID_LABEL_H + evidenceRows * (EVID_THUMB + EVID_GAP) : 0)
    + (issue.videos.length > 0 ? EVID_LABEL_H + issue.videos.length * VIDEO_LINE_H + 2 : 0)
    + reviewLines.length * RETURN_LINE_H
    + ROW_V_PAD;

  return { issue, headerLines, statusLines, brandLine, descLines, returnLines, afterLines, evidenceRows, evidenceThumbsPerRow, reviewLines, height: issue.compact ? textH : Math.max(textH, ROW_MIN_H) };
}

// Invisible link over a thumbnail that opens the matching full-res file from
// the bundled zip's images/ folder. Best-effort by nature: most browser PDF
// viewers (Chrome/Edge's built-in viewer, Firefox's pdf.js) don't implement
// Launch actions at all and will just do nothing on click, and desktop
// Acrobat/Reader shows its own "allow this document to open a file?" prompt
// first — the filename caption/badge stays the reliable fallback either way.
function addOpenFileLink(
  pdfDoc: PDFDocument,
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  relativePath: string,
): void {
  const { context } = pdfDoc;
  const annot = context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "Launch",
      F: PDFString.of(relativePath),
      NewWindow: true,
    },
  });
  page.node.addAnnot(context.register(annot));
}

// A normal clickable web link — works in every PDF viewer, unlike the Launch
// action above. Used for the video download links.
function addUriLink(
  pdfDoc: PDFDocument,
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  uri: string,
): void {
  const { context } = pdfDoc;
  const annot = context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(uri) },
  });
  page.node.addAnnot(context.register(annot));
}

// Builds one full report PDF (either kind) as raw bytes — each report gets
// its own PDFDocument since pdf-lib's embedded PDFImage objects can't be
// shared across separate documents, so images are re-embedded per report
// (only the ones that report's own issues actually reference).
async function buildReportPdfBytes(
  config: ReportConfig,
  packingListNo: string,
  supplierRefNo: string | null,
  supplierName: string,
  companyName: string,
  issues: IssueItem[],
  images: Map<string, CachedImage>,
  accent: ReturnType<typeof rgb>,
  accentDark: ReturnType<typeof rgb>,
  hasBundledImages: boolean,
  prefix: string,
  interim: InterimInfo | null,
  supplementary = false,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const neededUrls = new Set(issues.flatMap((i) => [i.identityImageUrl, ...i.evidenceImageUrls]).filter((u): u is string => !!u));
  const pdfImageCache = new Map<string, PDFImage>();
  for (const url of neededUrls) {
    const cached = images.get(url);
    if (!cached) continue;
    try {
      const img = cached.extension === "png" ? await pdfDoc.embedPng(cached.buffer) : await pdfDoc.embedJpg(cached.buffer);
      pdfImageCache.set(url, img);
    } catch { /* unsupported format — skip */ }
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  // One extra line of header room to explain the images/ folder naming
  // convention, only when there's actually a zip with photos in it.
  const HDR_H = hasBundledImages ? 90 : 78;
  const COLHDR_H = 18;
  const FOOTER_H = 20;
  // Amber "inspection still in progress" strip under the header band on
  // every page of an interim report.
  const bannerText = interim
    ? interimSummaryText(interim)
    : supplementary
      ? "SUPPLEMENTARY - these issues were found after the inspection of this packing list was completed (on a later check). Each line shows the figures before and after, when it was found, and the new evidence."
      : null;
  const BANNER_H = bannerText ? 26 : 0;
  const availH = H - MT - HDR_H - BANNER_H - COLHDR_H - MB - FOOTER_H;
  const COL_DET = CW - NO_COL_W - IMG_COL_W;
  const detMaxW = COL_DET - 16;

  const measured = issues.map((issue) => measure(issue, fontR, fontB, detMaxW, config, !!interim));
  const title = interim ? `${config.title} - INTERIM` : config.title;
  const bannerLines = bannerText ? wrap(bannerText, fontB, 7.5, CW - 16).slice(0, 2) : [];

  // Paginate by accumulated row height rather than a fixed row count, so
  // no row's text, images, or evidence photos are ever cut off to fit a
  // preset grid.
  const paginate = (rows: Measured[]): Measured[][] => {
    const out: Measured[][] = [];
    let current: Measured[] = [];
    let currentH = 0;
    for (const m of rows) {
      if (current.length > 0 && currentH + m.height > availH) {
        out.push(current);
        current = [];
        currentH = 0;
      }
      current.push(m);
      currentH += m.height;
    }
    if (current.length > 0) out.push(current);
    return out;
  };
  const pages = paginate(measured);
  // Real issue lines only — an interim report also carries every other line.
  const issueCount = issues.filter((i) => !i.doneListing).length;

  const totalPgs = pages.length;
  const dateStr = new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: REPORT_TZ });

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pdfDoc.addPage([W, H]);
    const pageRows = pages[pi];
    const pageH = pageRows.reduce((sum, m) => sum + m.height, 0);

    // Header band
    page.drawRectangle({ x: 0, y: H - HDR_H, width: W, height: HDR_H, color: accentDark });
    page.drawRectangle({ x: 0, y: H - HDR_H, width: W, height: 3, color: accent });
    page.drawText(title, { x: ML, y: H - 24, size: 13, font: fontB, color: C_WHITE });
    page.drawText(`Packing List ${packingListNo}${supplierRefNo ? `  ·  Supplier ref ${supplierRefNo}` : ""}`, {
      x: ML, y: H - 40, size: 8.5, font: fontR, color: rgb(0.88, 0.88, 0.9),
    });
    page.drawText(`${config.recipientLabel}: ${sanitize(supplierName)}`, { x: ML, y: H - 54, size: 9, font: fontB, color: C_WHITE });
    page.drawText(companyName, { x: ML, y: H - 66, size: 7.5, font: fontR, color: rgb(0.7, 0.7, 0.75) });
    if (hasBundledImages) {
      const legend = config.legendText(prefix);
      page.drawText(trunc(legend, fontR, 6.5, CW), { x: ML, y: H - 78, size: 6.5, font: fontR, color: rgb(0.75, 0.75, 0.8) });
    }

    const pgLabel = `Page ${pi + 1} / ${totalPgs}`;
    page.drawText(pgLabel, { x: W - MR - fontB.widthOfTextAtSize(pgLabel, 9), y: H - 24, size: 9, font: fontB, color: rgb(0.85, 0.85, 0.9) });
    page.drawText(dateStr, { x: W - MR - fontR.widthOfTextAtSize(dateStr, 7.5), y: H - 38, size: 7.5, font: fontR, color: rgb(0.7, 0.7, 0.75) });
    const countLabel = `${issueCount} line${issueCount !== 1 ? "s" : ""} ${config.countNoun}`;
    page.drawText(countLabel, { x: W - MR - fontR.widthOfTextAtSize(countLabel, 7), y: H - 50, size: 7, font: fontR, color: rgb(0.65, 0.65, 0.7) });

    drawBanner(page);

    // Column header
    const tableTopY = H - HDR_H - BANNER_H - COLHDR_H;
    const tableBottomY = tableTopY - pageH;
    page.drawRectangle({ x: ML, y: tableTopY, width: CW, height: COLHDR_H, color: accent });
    page.drawText("NO.", { x: ML + (NO_COL_W - fontB.widthOfTextAtSize("NO.", 6.5)) / 2, y: tableTopY + 5, size: 6.5, font: fontB, color: C_WHITE });
    page.drawText("IMAGE", { x: ML + NO_COL_W + (IMG_COL_W - fontB.widthOfTextAtSize("IMAGE", 6.5)) / 2, y: tableTopY + 5, size: 6.5, font: fontB, color: C_WHITE });
    page.drawText(interim ? "ITEM / ISSUE  (amber rows: still in progress, no photo until approved)" : "ITEM / ISSUE", { x: ML + NO_COL_W + IMG_COL_W + 8, y: tableTopY + 5, size: 6.5, font: fontB, color: C_WHITE });

    page.drawLine({ start: { x: ML + NO_COL_W, y: tableBottomY }, end: { x: ML + NO_COL_W, y: tableTopY }, thickness: 0.3, color: C_LINE });
    page.drawLine({ start: { x: ML + NO_COL_W + IMG_COL_W, y: tableBottomY }, end: { x: ML + NO_COL_W + IMG_COL_W, y: tableTopY }, thickness: 0.3, color: C_LINE });

    let rowTopY = tableTopY;
    for (let ri = 0; ri < pageRows.length; ri++) {
      const m = pageRows[ri];
      const issue = m.issue;
      const rowH = m.height;
      const rowY = rowTopY - rowH;

      if (issue.compact) page.drawRectangle({ x: ML, y: rowY, width: CW, height: rowH, color: C_AMBER_BG });
      else if (ri % 2 === 1) page.drawRectangle({ x: ML, y: rowY, width: CW, height: rowH, color: C_ALT });
      page.drawLine({ start: { x: ML, y: rowY }, end: { x: ML + CW, y: rowY }, thickness: 0.3, color: C_LINE });

      const noStr = String(issue.no);
      page.drawText(noStr, { x: ML + (NO_COL_W - fontB.widthOfTextAtSize(noStr, 9)) / 2, y: rowY + rowH / 2 - 3, size: 9, font: fontB, color: C_MID });

      // Image + its filename caption sit together as one centered block —
      // the caption only appears when that file actually made it into the
      // bundled zip (a fetch failure just means no thumbnail, no caption).
      const img = issue.identityImageUrl && !issue.compact ? pdfImageCache.get(issue.identityImageUrl) : undefined;
      const idFn = identityFilename(issue, images, prefix);
      const blockY = rowY + (rowH - IMG_BLOCK_H) / 2;
      const imgAreaY = idFn ? blockY + IMG_CAPTION_GAP + IMG_CAPTION_SIZE : blockY;
      const imgAreaH = idFn ? IMG_SZ : IMG_BLOCK_H;
      if (img) {
        const scale = Math.min(IMG_SZ / img.height, IMG_SZ / img.width, 1);
        const imgW = img.width * scale;
        const imgH = img.height * scale;
        page.drawImage(img, {
          x: ML + NO_COL_W + (IMG_COL_W - imgW) / 2,
          y: imgAreaY + (imgAreaH - imgH) / 2,
          width: imgW,
          height: imgH,
        });
      } else if (!issue.compact) {
        const ph = Math.min(IMG_SZ * 0.7, imgAreaH);
        page.drawRectangle({ x: ML + NO_COL_W + (IMG_COL_W - ph) / 2, y: imgAreaY + (imgAreaH - ph) / 2, width: ph, height: ph, color: C_LINE });
      }
      if (idFn) {
        const capText = trunc(idFn, fontR, IMG_CAPTION_SIZE, IMG_COL_W - 8);
        page.drawText(capText, {
          x: ML + NO_COL_W + (IMG_COL_W - fontR.widthOfTextAtSize(capText, IMG_CAPTION_SIZE)) / 2,
          y: blockY,
          size: IMG_CAPTION_SIZE,
          font: fontR,
          color: C_LITE,
        });
        addOpenFileLink(
          pdfDoc,
          page,
          { x: ML + NO_COL_W, y: rowY, width: IMG_COL_W, height: rowH },
          `images/${idFn}`,
        );
      }

      const detX = ML + NO_COL_W + IMG_COL_W + 8;
      let detY = rowY + rowH - 12;

      for (const line of m.headerLines) {
        page.drawText(line, { x: detX, y: detY, size: 8.5, font: fontB, color: accent });
        detY -= HEADER_LINE_H;
      }

      for (const line of m.statusLines) {
        page.drawText(line, { x: detX, y: detY, size: 7.5, font: fontB, color: isDone(issue.progress) ? C_GREEN : C_AMBER });
        detY -= TEXT_LINE_H;
      }

      for (const line of m.brandLine) {
        page.drawText(line, { x: detX, y: detY, size: 8, font: fontR, color: C_BRAND });
        detY -= TEXT_LINE_H;
      }

      for (const line of m.descLines) {
        page.drawText(line, { x: detX, y: detY, size: 8, font: fontR, color: C_DARK });
        detY -= TEXT_LINE_H;
      }

      // A line nobody has counted yet has no received figure — the draft
      // would otherwise fall back to the expected qty and look complete.
      const receivedStr = issue.progress === "not-inspected" ? "- (not counted yet)" : `${issue.received}${issue.uom}`;
      const qtyStr = `Expected ${issue.expected}${issue.uom}  ·  Received ${receivedStr}`;
      page.drawText(qtyStr, { x: detX, y: detY, size: 7.5, font: fontR, color: C_MID });
      detY -= TEXT_LINE_H;

      if (issue.shortfall > 0) {
        page.drawText(`Short by ${issue.shortfall} ${issue.uom}`, { x: detX, y: detY, size: 8, font: fontB, color: C_AMBER });
        detY -= TEXT_LINE_H;
      }

      for (const line of m.returnLines) {
        page.drawText(line, { x: detX, y: detY, size: 7.5, font: fontB, color: C_RED });
        detY -= RETURN_LINE_H;
      }

      for (const line of m.afterLines) {
        page.drawText(line, { x: detX, y: detY, size: 7, font: fontB, color: C_BRAND });
        detY -= RETURN_LINE_H;
      }

      if (issue.evidenceImageUrls.length > 0) {
        page.drawText(`Photos attached (${issue.evidenceImageUrls.length}):`, { x: detX, y: detY, size: 7, font: fontB, color: C_MID });
        detY -= EVID_LABEL_H;

        issue.evidenceImageUrls.forEach((url, ei) => {
          const col = ei % m.evidenceThumbsPerRow;
          const rowInGroup = Math.floor(ei / m.evidenceThumbsPerRow);
          const thumbX = detX + col * (EVID_THUMB + EVID_GAP);
          const thumbTopY = detY - rowInGroup * (EVID_THUMB + EVID_GAP);
          const thumbY = thumbTopY - EVID_THUMB;

          const evImg = pdfImageCache.get(url);
          if (evImg) {
            const scale = Math.min(EVID_THUMB / evImg.height, EVID_THUMB / evImg.width, 1);
            page.drawImage(evImg, {
              x: thumbX + (EVID_THUMB - evImg.width * scale) / 2,
              y: thumbY + (EVID_THUMB - evImg.height * scale) / 2,
              width: evImg.width * scale,
              height: evImg.height * scale,
            });
            page.drawRectangle({ x: thumbX, y: thumbY, width: EVID_THUMB, height: EVID_THUMB, borderColor: C_LINE, borderWidth: 0.4 });
          } else {
            page.drawRectangle({ x: thumbX, y: thumbY, width: EVID_THUMB, height: EVID_THUMB, color: C_LINE });
          }

          // Numbered badge matching the file's "-evidence-<n>" suffix in
          // the bundled zip, so a thumbnail here maps straight to its file.
          const evFn = evidenceFilename(issue, ei, images, prefix);
          if (evFn) {
            const label = String(ei + 1);
            const lblW = fontB.widthOfTextAtSize(label, 5.5) + 3;
            page.drawRectangle({ x: thumbX, y: thumbY, width: lblW, height: 7.5, color: C_WHITE, opacity: 0.85 });
            page.drawText(label, { x: thumbX + 1.5, y: thumbY + 1.8, size: 5.5, font: fontB, color: C_DARK });
            addOpenFileLink(pdfDoc, page, { x: thumbX, y: thumbY, width: EVID_THUMB, height: EVID_THUMB }, `images/${evFn}`);
          }
        });
        detY -= m.evidenceRows * (EVID_THUMB + EVID_GAP);
      }

      if (issue.videos.length > 0) {
        page.drawText(`Videos attached (${issue.videos.length}) — click a line to play:`, { x: detX, y: detY, size: 7, font: fontB, color: C_MID });
        detY -= EVID_LABEL_H;
        issue.videos.forEach((v, vi) => {
          const text = trunc(`Video ${vi + 1}  -  ${v.filename}`, fontR, 7, detMaxW);
          const tw = fontR.widthOfTextAtSize(text, 7);
          page.drawText(text, { x: detX, y: detY, size: 7, font: fontR, color: C_LINK });
          page.drawLine({ start: { x: detX, y: detY - 1 }, end: { x: detX + tw, y: detY - 1 }, thickness: 0.4, color: C_LINK });
          addUriLink(pdfDoc, page, { x: detX, y: detY - 2, width: tw, height: VIDEO_LINE_H }, v.url);
          detY -= VIDEO_LINE_H;
        });
        detY -= 2;
      }

      for (const line of m.reviewLines) {
        page.drawText(line, { x: detX, y: detY, size: 7, font: fontR, color: C_LITE });
        detY -= RETURN_LINE_H;
      }

      rowTopY = rowY;
    }

    page.drawRectangle({ x: ML, y: tableBottomY, width: CW, height: tableTopY - tableBottomY, borderColor: C_LINE, borderWidth: 0.4 });

    page.drawLine({ start: { x: ML, y: MB + 18 }, end: { x: W - MR, y: MB + 18 }, thickness: 0.6, color: accent });
    drawFooter(page, pi);
  }

  return pdfDoc.save();

  function drawBanner(page: PDFPage) {
    if (!bannerText) return;
    const y0 = H - HDR_H - BANNER_H;
    page.drawRectangle({ x: 0, y: y0, width: W, height: BANNER_H, color: C_AMBER_BG });
    page.drawRectangle({ x: 0, y: y0, width: W, height: 1, color: C_AMBER });
    bannerLines.forEach((line, i) => {
      page.drawText(line, { x: ML + 8, y: H - HDR_H - 10 - i * 9, size: 7.5, font: fontB, color: C_AMBER });
    });
  }

  function drawFooter(page: PDFPage, pi: number) {
    page.drawLine({ start: { x: ML, y: MB + 18 }, end: { x: W - MR, y: MB + 18 }, thickness: 0.6, color: accent });
    const footLeft = `${companyName.toUpperCase()}  ·  ${title}${interim ? "  ·  NOT FINAL" : ""}  ·  COMPUTER GENERATED DOCUMENT`;
    page.drawText(trunc(footLeft, fontR, 7, CW * 0.75), { x: ML, y: MB + 8, size: 7, font: fontR, color: interim ? C_AMBER : C_LITE });
    const footRight = `${pi + 1} / ${totalPgs}`;
    page.drawText(footRight, { x: W - MR - fontR.widthOfTextAtSize(footRight, 7), y: MB + 8, size: 7, font: fontR, color: C_LITE });
  }
}

export async function GET(req: Request, { params }: Props) {
  try {
    const { id } = await params;
    const search = new URL(req.url).searchParams;
    const format = search.get("format") === "xlsx" ? "xlsx" : "pdf";
    // scope=after: a supplementary report with only what was found after
    // inspection was completed (approved change requests on its lines).
    const supplementary = search.get("scope") === "after";

    // Own-org first, falling back to the cross-org (centralized) read —
    // without this fallback, anyone viewing this packing list through the
    // centralized page (its own org differs from the viewer's currently
    // active org) always got a 404 here, no matter their permissions,
    // because getPackingListDetail only ever matches organizationId against
    // the caller's active org.
    //
    // The two calls are tried in SEPARATE try/catches on purpose: a caller
    // who holds packing-list:read:centralized but not the plain
    // purchase-order:read (a real, valid combination — see
    // packing-list:read:centralized vs. purchase-order:read:centralized,
    // two different keys) makes getPackingListDetail throw immediately.
    // Catching both calls in one try means that throw skips the centralized
    // fallback entirely and wrongly reports 403 — only report Forbidden once
    // BOTH paths have actually failed.
    let pl = null;
    try {
      pl = await getPackingListDetail(id);
    } catch { /* no purchase-order:read in the active org — try centralized below */ }
    if (!pl) {
      try {
        pl = await getPackingListDetailCentralized(id);
      } catch {
        return new Response("Forbidden", { status: 403 });
      }
    }
    if (!pl) return new Response("Not Found", { status: 404 });
    // While inspection is still open the report is an INTERIM one built from
    // the inspectors' draft figures — same rule as the detail page, which
    // only shows those drafts to someone who could be inspecting this list.
    const isInterim = pl.status === "pending";
    if (supplementary && isInterim) {
      return new Response("Inspection isn't completed yet — there's nothing found after inspection to report", { status: 400 });
    }
    if (isInterim && !(await canInspectPackingList(pl.organizationId))) {
      return new Response("Inspection is still in progress — only inspectors can download an interim report", { status: 403 });
    }

    const poLabelById = new Map(pl.purchaseOrders.map((p) => [p.id, p.poNo ?? p.prNo ?? p.id]));

    // The packing list item's own rowNo is just its position within THIS
    // packing list — to say which line of the supplier's actual PO an item
    // came from, we need the linked purchase_order_item's own rowNo instead.
    const poItemIds = [...new Set(pl.items.map((i) => i.purchaseOrderItemId).filter((v): v is string => !!v))];
    const poItemRows = poItemIds.length > 0
      ? await db.select({ id: purchaseOrderItem.id, rowNo: purchaseOrderItem.rowNo }).from(purchaseOrderItem).where(inArray(purchaseOrderItem.id, poItemIds))
      : [];
    const poLineNoById = new Map(poItemRows.map((r) => [r.id, r.rowNo]));

    // Absolute links printed in the report (video playback) — the public
    // address (APP_DOMAIN in production), never the internal one the proxy
    // forwards the request to.
    const baseUrl = publicBaseUrl(req);
    const ctx = { baseUrl, packingListNo: pl.packingListNo, completed: !isInterim, supplementary };
    const currentItems = pl.items.filter((i) => !i.removedAt);
    // Supplementary: only lines changed after inspection, numbered 1..N.
    const afterOnly = (list: IssueItem[]) => supplementary
      ? list.filter((i) => i.afterInspection).map((i, idx) => ({ ...i, no: idx + 1 }))
      : list;
    const returnIssues = afterOnly(buildIssueItems(currentItems, poLabelById, poLineNoById, "return", ctx));
    const repairIssues = afterOnly(buildIssueItems(currentItems, poLabelById, poLineNoById, "repair", ctx));
    const interim = isInterim ? buildInterimInfo(currentItems, poLabelById, poLineNoById) : null;
    // Interim: the PDF lists every line in its own place, so issue numbers
    // follow that full list — renumber the issue rows (spreadsheet too) to
    // match, so No. 7 means the same line in every file of the download.
    const returnRows = interim ? buildInterimRows(currentItems, poLabelById, poLineNoById, "return", ctx, returnIssues) : returnIssues;
    const repairRows = interim ? buildInterimRows(currentItems, poLabelById, poLineNoById, "repair", ctx, repairIssues) : repairIssues;
    if (interim) {
      const renumber = (list: IssueItem[], rows: IssueItem[]) => {
        const noById = new Map(rows.map((r) => [r.itemId, r.no]));
        for (const i of list) i.no = noById.get(i.itemId) ?? i.no;
      };
      renumber(returnIssues, returnRows);
      renumber(repairIssues, repairRows);
    }
    const hasReturn = returnIssues.length > 0;
    const hasRepair = repairIssues.length > 0;

    if (!hasReturn && !hasRepair) {
      if (supplementary) {
        return new Response("Nothing found after inspection to report — no approved change on this packing list affects what was received, returned or repaired", { status: 400 });
      }
      if (interim) {
        const open = interim.total - interim.done;
        return new Response(`No issues recorded so far — ${interim.done} of ${interim.total} lines done, ${open} still in progress`, { status: 400 });
      }
      return new Response("Nothing to report — every item was received in full and nothing was sent for repair", { status: 400 });
    }

    // Branding must reflect the org that issued the Supplier PO (the packing
    // list's own org), not whichever org the downloader currently has active
    // — relevant when this is fetched via the centralized/cross-org fallback.
    const orgProfile = await getOrganizationBranding(pl.organizationId);
    const allImageUrls = [...returnRows, ...repairRows].flatMap((i) => [i.identityImageUrl, ...i.evidenceImageUrls]);
    const images = await fetchImages(allImageUrls);
    const supplierName = (pl.supplierSnapshot as { name?: string } | null)?.name ?? "Supplier";
    // "_interim" in every file name so a draft copy is never mistaken for the final one.
    const safeNo = pl.packingListNo.replace(/[^a-z0-9]/gi, "_");
    const sfx = interim ? "_interim" : supplementary ? "_supplementary" : "";
    const cfgReturn = supplementary ? { ...REPORT_CONFIGS.return, title: "SUPPLEMENTARY DISCREPANCY REPORT" } : REPORT_CONFIGS.return;
    const cfgRepair = supplementary ? { ...REPORT_CONFIGS.repair, title: "SUPPLEMENTARY REPAIR REPORT" } : REPORT_CONFIGS.repair;

    if (format === "xlsx") {
      const parts: { name: string; buf: Buffer }[] = [];
      if (hasReturn) {
        const buf = await buildXlsxBuffer(cfgReturn, pl.packingListNo, pl.supplierRefNo, supplierName, orgProfile.companyName, orgProfile.brandColor, returnIssues, images, interim);
        parts.push({ name: `${safeNo}_discrepancy_report${sfx}.xlsx`, buf });
      }
      if (hasRepair) {
        const buf = await buildXlsxBuffer(cfgRepair, pl.packingListNo, pl.supplierRefNo, supplierName, orgProfile.companyName, orgProfile.brandColor, repairIssues, images, interim);
        parts.push({ name: `${safeNo}_repair_report${sfx}.xlsx`, buf });
      }

      if (parts.length === 1) {
        return new Response(parts[0].buf as unknown as ArrayBuffer, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${parts[0].name}"`,
          },
        });
      }

      const zip = new JSZip();
      for (const p of parts) zip.file(p.name, p.buf);
      const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const zipName = hasReturn ? `${safeNo}_discrepancy_report${sfx}.zip` : `${safeNo}_repair_report${sfx}.zip`;
      return new Response(zipBuf as unknown as ArrayBuffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipName}"`,
        },
      });
    }

    // The PDF can only ever show small thumbnails, so when there's at least
    // one photo, ship a zip with the PDF plus every photo at full size —
    // named to match the caption/number printed on its thumbnail.
    const returnImageEntries = hasReturn ? buildImageZipEntries(returnRows, images, "return") : [];
    const repairImageEntries = hasRepair ? buildImageZipEntries(repairRows, images, "repair") : [];
    const allImageEntries = [...returnImageEntries, ...repairImageEntries];

    const accent = (() => {
      const hex = orgProfile.brandColor.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return rgb(r, g, b);
    })();
    const accentDark = (() => {
      const hex = orgProfile.brandColor.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return rgb(Math.max(0, r * 0.55), Math.max(0, g * 0.55), Math.max(0, b * 0.55));
    })();

    const pdfParts: { name: string; bytes: Uint8Array }[] = [];
    if (hasReturn) {
      const bytes = await buildReportPdfBytes(
        cfgReturn, pl.packingListNo, pl.supplierRefNo, supplierName, orgProfile.companyName,
        returnRows, images, accent, accentDark, returnImageEntries.length > 0, "return", interim, supplementary,
      );
      pdfParts.push({ name: `${safeNo}_discrepancy_report${sfx}.pdf`, bytes });
    }
    if (hasRepair) {
      const bytes = await buildReportPdfBytes(
        cfgRepair, pl.packingListNo, pl.supplierRefNo, supplierName, orgProfile.companyName,
        repairRows, images, accent, accentDark, repairImageEntries.length > 0, "repair", interim, supplementary,
      );
      pdfParts.push({ name: `${safeNo}_repair_report${sfx}.pdf`, bytes });
    }

    if (pdfParts.length === 1 && allImageEntries.length === 0) {
      const only = pdfParts[0];
      return new Response(Buffer.from(only.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${only.name}"`,
        },
      });
    }

    const zip = new JSZip();
    for (const p of pdfParts) zip.file(p.name, Buffer.from(p.bytes));
    for (const entry of allImageEntries) zip.file(entry.name, entry.buffer);
    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const zipName = hasReturn ? `${safeNo}_discrepancy_report${sfx}.zip` : `${safeNo}_repair_report${sfx}.zip`;

    return new Response(zipBuf as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      },
    });
  } catch (e) {
    console.error("[packing-list discrepancy-report] error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
