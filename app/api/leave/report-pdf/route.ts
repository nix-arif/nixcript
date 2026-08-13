import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { organization } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getLeaveReport } from "@/server/leave";

export const maxDuration = 60;

// ── A4 landscape — a wide employee x leave-type grid reads better landscape ─
const W  = 841.89;
const H  = 595.28;
const ML = 30;
const MR = 30;
const MT = 30;
const MB = 30;
const CW = W - ML - MR;

const C_BLACK = rgb(0, 0, 0);
const C_MID   = rgb(0.40, 0.40, 0.40);
const C_LINE  = rgb(0.82, 0.82, 0.82);
const C_ALT   = rgb(0.965, 0.966, 0.968);
const C_HDR   = rgb(0.13, 0.15, 0.20);
const C_WHITE = rgb(1, 1, 1);

const ROW_H     = 18;
const HEADER_H  = 46;
const COLHDR_H  = 22;
const NAME_COL_W = 160;

function sanitize(t: string): string {
  return String(t ?? "").replace(/[\x00-\x1F\x7F]/g, " ");
}

function trunc(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxW: number): string {
  const t = sanitize(text).trim();
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let s = t;
  while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return new Response("Unauthorized", { status: 401 });

    const orgId = session.session.activeOrganizationId;
    if (!orgId) return new Response("No active organization", { status: 400 });

    const perms = await getUserPermissions(session.user.id, orgId);
    if (!hasAccess(perms, "leave:read:all")) return new Response("Forbidden", { status: 403 });

    const yearParam = req.nextUrl.searchParams.get("year");
    const yearArg = yearParam ? parseInt(yearParam, 10) : undefined;
    if (yearParam && !Number.isFinite(yearArg)) return new Response("Invalid year", { status: 400 });

    // Delegates to the same function the on-screen report and Excel export
    // use, so the PDF always matches — same columns (including subset
    // labels like Emergency Leave placed right after their parent type),
    // same totals, no separately-maintained query logic to drift out of sync.
    const [{ name: orgName }] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)).limit(1);
    const { year: y, columns, rows: reportRows } = await getLeaveReport(yearArg);
    const rows = reportRows.map((r) => ({ name: r.memberName, totals: r.totals, grandTotal: r.grandTotal }));

    // ── Layout ────────────────────────────────────────────────────────────
    const numColW = Math.min(70, (CW - NAME_COL_W - 60) / (columns.length + 1));

    const pdfDoc = await PDFDocument.create();
    const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const rowsPerPage = Math.floor((H - MT - MB - HEADER_H - COLHDR_H - 20) / ROW_H);
    const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));

    for (let p = 0; p < pageCount; p++) {
      const page = pdfDoc.addPage([W, H]);
      const pageRows = rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage);

      // Header band
      page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: C_HDR });
      page.drawText(`Leave Report — ${y}`, { x: ML, y: H - 24, size: 14, font: fontB, color: C_WHITE });
      if (orgName) {
        page.drawText(sanitize(orgName), { x: ML, y: H - 38, size: 9, font: fontR, color: rgb(0.8, 0.8, 0.85) });
      }
      const genLabel = `Generated ${new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}`;
      page.drawText(genLabel, { x: W - MR - fontR.widthOfTextAtSize(genLabel, 8), y: H - 24, size: 8, font: fontR, color: rgb(0.75, 0.75, 0.8) });
      const pgLabel = `Page ${p + 1} of ${pageCount}`;
      page.drawText(pgLabel, { x: W - MR - fontR.widthOfTextAtSize(pgLabel, 8), y: H - 36, size: 8, font: fontR, color: rgb(0.75, 0.75, 0.8) });

      // Column headers
      const colHdrY = H - HEADER_H - COLHDR_H;
      page.drawRectangle({ x: ML, y: colHdrY, width: CW, height: COLHDR_H, color: C_ALT });
      let colX = ML;
      page.drawText("EMPLOYEE", { x: colX + 4, y: colHdrY + 7, size: 7.5, font: fontB, color: C_BLACK });
      colX += NAME_COL_W;
      for (const col of columns) {
        const labelText = col.parentCode ? `> ${col.name}` : col.name;
        const label = trunc(labelText.toUpperCase(), fontB, 6.5, numColW - 4);
        page.drawText(label, { x: colX + 4, y: colHdrY + 7, size: 6.5, font: fontB, color: col.parentCode ? C_MID : C_BLACK });
        colX += numColW;
      }
      page.drawText("TOTAL", { x: colX + 4, y: colHdrY + 7, size: 7, font: fontB, color: C_BLACK });
      page.drawLine({ start: { x: ML, y: colHdrY }, end: { x: ML + CW, y: colHdrY }, thickness: 0.8, color: C_BLACK });

      // Rows
      let rowY = colHdrY;
      pageRows.forEach((row, ri) => {
        rowY -= ROW_H;
        if (ri % 2 === 1) page.drawRectangle({ x: ML, y: rowY, width: CW, height: ROW_H, color: C_ALT });
        let cx = ML;
        page.drawText(trunc(row.name, fontR, 8, NAME_COL_W - 8), { x: cx + 4, y: rowY + 5, size: 8, font: fontR, color: C_BLACK });
        cx += NAME_COL_W;
        for (const col of columns) {
          const v = row.totals[col.code];
          const text = v ? parseFloat(v).toFixed(v.endsWith(".00") ? 0 : 1) : "—";
          page.drawText(text, { x: cx + 4, y: rowY + 5, size: 8, font: fontR, color: v ? C_BLACK : C_MID });
          cx += numColW;
        }
        page.drawText(parseFloat(row.grandTotal).toFixed(row.grandTotal.endsWith(".00") ? 0 : 1), { x: cx + 4, y: rowY + 5, size: 8, font: fontB, color: C_BLACK });
        page.drawLine({ start: { x: ML, y: rowY }, end: { x: ML + CW, y: rowY }, thickness: 0.3, color: C_LINE });
      });

      page.drawRectangle({ x: ML, y: rowY, width: CW, height: colHdrY - rowY, borderColor: C_BLACK, borderWidth: 0.8 });
    }

    const bytes = await pdfDoc.save();
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="leave-report-${y}.pdf"`,
      },
    });
  } catch (err: unknown) {
    console.error("[leave/report-pdf]", err);
    return new Response(err instanceof Error ? err.message : "Unknown error", { status: 500 });
  }
}
