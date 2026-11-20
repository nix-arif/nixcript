import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getOrganizationBranding } from "@/server/organization-profile";
import { getClaim } from "@/lib/post-delivery/service";
import { BASES, CLAIM_OUTCOMES, situationLabel, todayKL } from "@/lib/post-delivery/core";
import { getObjectBytes } from "@/lib/r2/post-delivery";

export const maxDuration = 60;

// The claim as a document for the supplier: what happened, the dates that matter under their own terms, the items with their
// lot and order references, what we ask for, and the evidence. Customer details are left out on purpose.
const W = 595, H = 842, M = 40, CW = W - 2 * M;
const INK = rgb(0.1, 0.1, 0.12), MID = rgb(0.38, 0.38, 0.42), LINE = rgb(0.85, 0.85, 0.88), SOFT = rgb(0.96, 0.96, 0.97);

// the standard PDF fonts cannot print every character: replace what they cannot
const safe = (t: unknown) => String(t ?? "").replace(/[\r\t]+/g, " ").replace(/[^\x20-\x7E -ÿ–—‘’“”•]/g, "?");
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(text ?? "").split("\n").map(safe)) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxW) { line = next; continue; }
      if (line) out.push(line);
      // a single word longer than the line is cut
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxW && w.length > 1) { let n = w.length; while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxW) n--; out.push(w.slice(0, n)); w = w.slice(n); }
      line = w;
    }
    out.push(line);
  }
  return out;
}
const fmtDay = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "-");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getCachedSession();
    if (!session) return new Response("Unauthorized", { status: 401 });
    const orgId = session.session.activeOrganizationId;
    if (!orgId) return new Response("No active organization", { status: 400 });
    const perms = await getUserPermissions(session.user.id, orgId);
    const claim = await getClaim({ orgId, userId: session.user.id, perms }, id);
    if (!claim) return new Response("Not Found", { status: 404 });

    const brand = await getOrganizationBranding(orgId);
    const hex = (brand.brandColor ?? "#1e4d8c").replace("#", "");
    const accent = rgb(parseInt(hex.slice(0, 2), 16) / 255 || 0.1, parseInt(hex.slice(2, 4), 16) / 255 || 0.3, parseInt(hex.slice(4, 6), 16) / 255 || 0.55);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pages: PDFPage[] = [];
    let page!: PDFPage;
    let y = 0;
    const company = safe(brand.companyName || claim.companyName);

    function newPage() {
      page = pdf.addPage([W, H]);
      pages.push(page);
      y = H - M;
      if (pages.length === 1) {
        page.drawRectangle({ x: 0, y: H - 78, width: W, height: 78, color: accent });
        page.drawText(company.toUpperCase(), { x: M, y: H - 28, size: 9, font: bold, color: rgb(1, 1, 1) });
        page.drawText("SUPPLIER CLAIM", { x: M, y: H - 54, size: 20, font: bold, color: rgb(1, 1, 1) });
        const no = safe(claim!.claimNo);
        page.drawText(no, { x: W - M - bold.widthOfTextAtSize(no, 13), y: H - 38, size: 13, font: bold, color: rgb(1, 1, 1) });
        const dt = fmtDay(claim!.sentAt ? todayKL(claim!.sentAt) : todayKL());
        page.drawText(dt, { x: W - M - font.widthOfTextAtSize(dt, 9), y: H - 56, size: 9, font, color: rgb(1, 1, 1) });
        y = H - 78 - 22;
      }
    }
    const need = (h: number) => { if (y - h < M + 24) newPage(); };
    function heading(t: string) { need(30); page.drawText(safe(t).toUpperCase(), { x: M, y, size: 8.5, font: bold, color: accent }); y -= 5; page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.7, color: accent }); y -= 14; }
    function paragraph(t: string, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
      const size = opts.size ?? 9.5, f = opts.f ?? font;
      for (const line of wrap(t, f, size, CW)) { need(size + 4); page.drawText(line, { x: M, y, size, font: f, color: opts.color ?? INK }); y -= size + 3.5; }
      y -= opts.gap ?? 4;
    }
    function keyValues(rows: [string, string][]) {
      const colW = CW / 2;
      for (let i = 0; i < rows.length; i += 2) {
        const pair = rows.slice(i, i + 2);
        const lines = pair.map(([, v]) => wrap(v || "-", font, 9, colW - 104));
        const h = Math.max(...lines.map((l) => l.length)) * 12 + 4;
        need(h);
        pair.forEach(([k], c) => {
          const x = M + c * colW;
          page.drawText(safe(k), { x, y, size: 8, font: bold, color: MID });
          lines[c].forEach((l, n) => page.drawText(l, { x: x + 100, y: y - n * 12, size: 9, font, color: INK }));
        });
        y -= h;
      }
      y -= 6;
    }

    newPage();
    const s = claim.supplier;
    heading("To");
    paragraph([s?.name ?? claim.supplierName, s?.contactPerson && `Attn: ${s.contactPerson}`, s?.email, s?.contactNo].filter(Boolean).join("\n"), { gap: 8 });

    const first = claim.items.map((i) => i.receivedAt).filter((d): d is string => !!d).sort()[0] ?? null;
    keyValues([
      ["Claim no.", claim.claimNo], ["Our reference", claim.issue.issueNo],
      ["Your reference", claim.supplierRef ?? ""], ["Kind of problem", situationLabel(claim.situation)],
      ["We ask for", claim.requestedOutcome ? (CLAIM_OUTCOMES[claim.requestedOutcome as keyof typeof CLAIM_OUTCOMES] ?? claim.requestedOutcome) : "Replacement"],
      ["Safety related", claim.issue.safetyRelated ? "YES - please treat as urgent" : "No"],
    ]);

    heading("Dates");
    const term = claim.term;
    keyValues([
      ["Received from you", fmtDay(first)], ["Delivered to the end user", fmtDay(claim.issue.deliveredAt)],
      ["Problem reported", fmtDay(claim.issue.reportedAt)], ["Claim sent", claim.sentAt ? fmtDay(todayKL(claim.sentAt)) : "Not sent yet"],
      ["Your claim terms", term ? `${term.windowDays} days from the ${BASES[term.basis].toLowerCase()}${term.notes ? ` (${term.notes})` : ""}` : "Not recorded"],
      ["Claim period ends", claim.deadlineDate ? `${fmtDay(claim.deadlineDate)}${claim.sentAt && todayKL(claim.sentAt) <= claim.deadlineDate ? " - this claim is within it" : ""}` : "-"],
    ]);

    heading("What happened");
    paragraph(claim.issue.summary, { f: bold, size: 10 });
    if (claim.issue.description) paragraph(claim.issue.description);

    heading("Items");
    // table
    const cols = [{ t: "#", w: 22 }, { t: "Product", w: 170 }, { t: "Qty", w: 44 }, { t: "Lot / serial", w: 100 }, { t: "Our PO / GR", w: 100 }, { t: "Your ref / received", w: CW - 22 - 170 - 44 - 100 - 100 }];
    need(22);
    page.drawRectangle({ x: M, y: y - 5, width: CW, height: 17, color: SOFT });
    let cx = M + 4;
    for (const c of cols) { page.drawText(c.t, { x: cx, y: y, size: 7.5, font: bold, color: MID }); cx += c.w; }
    y -= 17;
    claim.items.forEach((it, n) => {
      const cells = [
        String(n + 1),
        [it.productCode, it.description].filter(Boolean).join("\n"),
        `${it.qtyClaimed}${it.uom ? ` ${it.uom}` : ""}`,
        [it.lotNo && `Lot ${it.lotNo}`, it.serialNo && `S/N ${it.serialNo}`].filter(Boolean).join("\n") || "-",
        [it.poNo, it.grNo].filter(Boolean).join("\n") || "-",
        [it.supplierDocRef, it.receivedAt && fmtDay(it.receivedAt)].filter(Boolean).join("\n") || "-",
      ];
      const wrapped = cells.map((c, i) => wrap(c, i === 1 ? bold : font, 8.5, cols[i].w - 8));
      const h = Math.max(...wrapped.map((w) => w.length)) * 11 + 8;
      need(h);
      let x = M + 4;
      wrapped.forEach((lines, i) => { lines.forEach((l, k) => page.drawText(l, { x, y: y - 9 - k * 11, size: 8.5, font: i === 1 && k === 0 ? bold : font, color: INK })); x += cols[i].w; });
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.3, color: LINE });
    });
    y -= 10;

    // evidence
    const photos = claim.media.filter((m) => m.kind !== "video");
    const videos = claim.media.filter((m) => m.kind === "video");
    if (photos.length > 0 || videos.length > 0) {
      heading("Evidence");
      const tw = (CW - 2 * 10) / 3, th = tw * 0.75;
      let col = 0;
      const shown = photos.slice(0, 15);
      for (const m of shown) {
        if (col === 0) need(th + 24);
        const obj = await getObjectBytes(m.imageKey);
        let img: PDFImage | null = null;
        if (obj) {
          try { const ext = m.filename.toLowerCase().split(".").pop(); img = ext === "png" || obj.contentType.includes("png") ? await pdf.embedPng(obj.bytes) : await pdf.embedJpg(obj.bytes); } catch { img = null; }
        }
        const x = M + col * (tw + 10);
        page.drawRectangle({ x, y: y - th, width: tw, height: th, color: SOFT, borderColor: LINE, borderWidth: 0.5 });
        if (img) {
          const k = Math.min(tw / img.width, th / img.height);
          page.drawImage(img, { x: x + (tw - img.width * k) / 2, y: y - th + (th - img.height * k) / 2, width: img.width * k, height: img.height * k });
        } else page.drawText("(not available)", { x: x + 8, y: y - th / 2, size: 8, font, color: MID });
        const cap = wrap(m.caption || m.filename, font, 7, tw)[0] ?? "";
        page.drawText(cap, { x, y: y - th - 10, size: 7, font, color: MID });
        col++;
        if (col === 3) { col = 0; y -= th + 22; }
      }
      if (col !== 0) y -= th + 22;
      if (photos.length > shown.length) paragraph(`${photos.length - shown.length} more photo${photos.length - shown.length === 1 ? "" : "s"} are sent with this claim.`, { color: MID, size: 8.5 });
      if (videos.length > 0) paragraph(`Videos sent with this claim: ${videos.map((v) => v.filename).join(", ")}`, { color: MID, size: 8.5 });
    }

    // footer on every page
    pages.forEach((p, i) => {
      p.drawLine({ start: { x: M, y: M + 12 }, end: { x: M + CW, y: M + 12 }, thickness: 0.5, color: accent });
      p.drawText(`${company}  -  ${safe(claim.claimNo)}  -  COMPUTER GENERATED DOCUMENT`, { x: M, y: M, size: 7, font, color: MID });
      const pn = `${i + 1} / ${pages.length}`;
      p.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 7), y: M, size: 7, font, color: MID });
    });
    const bytes = await pdf.save();
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${claim.claimNo.replace(/[^a-z0-9]/gi, "_")}_claim.pdf"` } });
  } catch (e) {
    console.error("[supplier-claims report] error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
