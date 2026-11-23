// A performance review as a PDF on the company's letterhead, laid out like the paper form (F-HR05): the details,
// Section A (goals of the last review, the written questions), the core competencies with the self and manager
// ratings, the comments, Section B (outcome, action plan) and the signatures.
//
// It is drawn from the ReviewView the person downloading it gets on screen, so it never shows more than they may see
// (an employee gets no manager ratings before the review is completed, a manager no self-assessment before it is sent).
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import type { ReviewView } from "@/lib/performance/service";
import {
  formatScore, managerSideVisible, OUTCOMES, PURPOSES, RATING_WORDS, ratingWord, selfSideVisible, STATUS_LABEL,
} from "@/lib/performance/core";
import { drawLetterhead, embedLogo, type Letterhead } from "@/lib/pdf/letterhead";
import { fitText, safeText, wrapText } from "@/lib/pdf/text";

// ── page ──────────────────────────────────────────────────────────────────────
const W = 595.28, H = 841.89; // A4
const M = 40;                 // margin
const CW = W - 2 * M;
const FOOTER_H = 26;

const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);
const FAINT = rgb(0.58, 0.58, 0.58);
const LINE = rgb(0.84, 0.84, 0.84);
const HEAD_BG = rgb(0.94, 0.95, 0.96);
const ZEBRA = rgb(0.982, 0.982, 0.982);
const BOX_BG = rgb(0.975, 0.98, 0.985);
const AMBER_BG = rgb(1, 0.97, 0.88), AMBER = rgb(0.55, 0.36, 0.02);
const RED_BG = rgb(0.99, 0.93, 0.93), RED = rgb(0.68, 0.12, 0.12);
const GREEN_BG = rgb(0.92, 0.97, 0.93), GREEN = rgb(0.08, 0.4, 0.2);

const KL = "Asia/Kuala_Lumpur";
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: KL }) : "";
const fmtDateTime = (d: Date) =>
  d.toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: KL });

type Ctx = {
  doc: PDFDocument; page: PDFPage; pages: PDFPage[]; y: number;
  fontR: PDFFont; fontB: PDFFont; logo: PDFImage | null;
  lh: Letterhead; brand: RGB; view: ReviewView;
};

// ── pages ─────────────────────────────────────────────────────────────────────
function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([W, H]);
  ctx.pages.push(ctx.page);
  if (ctx.pages.length === 1) {
    const v = ctx.view;
    ctx.y = drawLetterhead(ctx.page, {
      lh: ctx.lh, logo: ctx.logo, fontR: ctx.fontR, fontB: ctx.fontB, x: M, top: H - M, width: CW,
      title: "PERFORMANCE REVIEW",
      subtitle: [v.templateName, v.periodName].filter(Boolean),
    });
  } else {
    // a slim header on the pages after the first: whose review it is and for which company
    // the company's name and whose review it is both wrap (never cut), each in its own half
    const top = H - M, half = CW / 2 - 8;
    const left = wrapText(ctx.lh.companyName, ctx.fontB, 8.5, half);
    const right = wrapText(`Performance review · ${ctx.view.employeeName} · ${ctx.view.periodName}`, ctx.fontR, 8, half);
    left.forEach((t, i) => ctx.page.drawText(t, { x: M, y: top - 8.5 - i * 10.5, size: 8.5, font: ctx.fontB, color: INK }));
    right.forEach((t, i) => ctx.page.drawText(t, { x: W - M - ctx.fontR.widthOfTextAtSize(t, 8), y: top - 8.5 - i * 10.5, size: 8, font: ctx.fontR, color: MUTED }));
    const ruleY = top - 8.5 - (Math.max(left.length, right.length) - 1) * 10.5 - 7.5;
    ctx.page.drawRectangle({ x: M, y: ruleY, width: CW, height: 0.8, color: ctx.brand });
    ctx.y = ruleY - 14;
  }
}

// room for h more points on this page, else a new page
function ensure(ctx: Ctx, h: number): boolean {
  if (ctx.y - h >= M + FOOTER_H) return false;
  newPage(ctx);
  return true;
}

function stampFooters(ctx: Ctx, generatedAt: Date) {
  const left = safeText(`Confidential · Computer-generated on ${fmtDateTime(generatedAt)}`);
  ctx.pages.forEach((page, i) => {
    const y = M - 4;
    page.drawLine({ start: { x: M, y: y + 12 }, end: { x: W - M, y: y + 12 }, thickness: 0.4, color: LINE });
    page.drawText(left, { x: M, y, size: 7, font: ctx.fontR, color: FAINT });
    const pg = `Page ${i + 1} of ${ctx.pages.length}`;
    page.drawText(pg, { x: W - M - ctx.fontR.widthOfTextAtSize(pg, 7), y, size: 7, font: ctx.fontR, color: FAINT });
  });
}

// ── building blocks ───────────────────────────────────────────────────────────
function heading(ctx: Ctx, text: string, hint?: string) {
  ensure(ctx, hint ? 46 : 34);
  ctx.y -= 6;
  ctx.page.drawRectangle({ x: M, y: ctx.y - 11, width: 3, height: 13, color: ctx.brand });
  ctx.page.drawText(fitText(text, ctx.fontB, 10.5, CW - 10), { x: M + 9, y: ctx.y - 9.5, size: 10.5, font: ctx.fontB, color: INK });
  ctx.y -= 17;
  if (hint) {
    for (const l of wrapText(hint, ctx.fontR, 7.5, CW - 9, 3)) {
      ctx.page.drawText(l, { x: M + 9, y: ctx.y - 7, size: 7.5, font: ctx.fontR, color: MUTED });
      ctx.y -= 9.5;
    }
  }
  ctx.y -= 5;
}

function subheading(ctx: Ctx, text: string) {
  ensure(ctx, 40);
  ctx.page.drawText(fitText(text, ctx.fontB, 9, CW), { x: M, y: ctx.y - 9, size: 9, font: ctx.fontB, color: INK });
  ctx.y -= 15;
}

// a paragraph that may run over several pages, one line at a time
function paragraph(ctx: Ctx, text: string, o: { size?: number; font?: PDFFont; color?: RGB; x?: number; width?: number } = {}) {
  const size = o.size ?? 8.5, font = o.font ?? ctx.fontR, x = o.x ?? M, width = o.width ?? CW;
  const lineH = size * 1.35;
  for (const l of wrapText(text, font, size, width)) {
    ensure(ctx, lineH);
    if (l) ctx.page.drawText(l, { x, y: ctx.y - size, size, font, color: o.color ?? INK });
    ctx.y -= lineH;
  }
}

// a written answer in a light box; long answers continue on the next page
function answerBox(ctx: Ctx, text: string | null | undefined, empty = "No answer") {
  const size = 8.5, lineH = size * 1.4, pad = 6;
  const lines = text?.trim() ? wrapText(text, ctx.fontR, size, CW - 2 * pad) : [empty];
  const muted = !text?.trim();
  let i = 0;
  while (i < lines.length) {
    ensure(ctx, lineH + 2 * pad);
    const room = Math.max(1, Math.floor((ctx.y - (M + FOOTER_H) - 2 * pad) / lineH));
    const chunk = lines.slice(i, i + room);
    const h = chunk.length * lineH + 2 * pad;
    ctx.page.drawRectangle({ x: M, y: ctx.y - h, width: CW, height: h, color: BOX_BG, borderColor: LINE, borderWidth: 0.5 });
    chunk.forEach((l, j) => l && ctx.page.drawText(l, { x: M + pad, y: ctx.y - pad - size - j * lineH + 1, size, font: muted ? ctx.fontR : ctx.fontR, color: muted ? FAINT : INK }));
    ctx.y -= h;
    i += chunk.length;
  }
  ctx.y -= 8;
}

// label above value, in two columns
function details(ctx: Ctx, pairs: [string, string | null | undefined][]) {
  const colW = (CW - 16) / 2;
  for (let i = 0; i < pairs.length; i += 2) {
    const row = pairs.slice(i, i + 2).map(([label, value]) => ({ label, lines: wrapText(value || "—", ctx.fontR, 9, colW, 3), empty: !value }));
    const h = 10 + Math.max(...row.map((c) => c.lines.length)) * 11.5 + 6;
    ensure(ctx, h);
    row.forEach((c, j) => {
      const x = M + j * (colW + 16);
      ctx.page.drawText(safeText(c.label.toUpperCase()), { x, y: ctx.y - 7, size: 6.5, font: ctx.fontB, color: MUTED });
      c.lines.forEach((l, k) => ctx.page.drawText(l, { x, y: ctx.y - 18.5 - k * 11.5, size: 9, font: ctx.fontR, color: c.empty ? FAINT : INK }));
    });
    ctx.y -= h;
  }
  ctx.y -= 4;
}

// a coloured note across the page (status of a review that is not final, a cancelled review ...)
function banner(ctx: Ctx, text: string, bg: RGB, fg: RGB) {
  const lines = wrapText(text, ctx.fontB, 8.5, CW - 20, 4);
  const h = lines.length * 11.5 + 12;
  ensure(ctx, h);
  ctx.page.drawRectangle({ x: M, y: ctx.y - h, width: CW, height: h, color: bg });
  ctx.page.drawRectangle({ x: M, y: ctx.y - h, width: 3, height: h, color: fg });
  lines.forEach((l, i) => ctx.page.drawText(l, { x: M + 12, y: ctx.y - 6 - 8.5 - i * 11.5 + 1, size: 8.5, font: ctx.fontB, color: fg }));
  ctx.y -= h + 10;
}

// ── tables ────────────────────────────────────────────────────────────────────
type Run = { text: string; bold?: boolean; muted?: boolean; size?: number };
type Cell = string | Run[];
type Col = { label: string; width: number; align?: "left" | "center" };

const CELL_PAD = 5;
function cellLines(ctx: Ctx, cell: Cell, width: number) {
  const runs: Run[] = typeof cell === "string" ? [{ text: cell }] : cell;
  const out: { text: string; font: PDFFont; size: number; color: RGB; gap: number }[] = [];
  runs.forEach((r, ri) => {
    const font = r.bold ? ctx.fontB : ctx.fontR, size = r.size ?? 8;
    wrapText(r.text, font, size, width - 2 * CELL_PAD).forEach((t, i) =>
      out.push({ text: t, font, size, color: r.muted ? MUTED : INK, gap: i === 0 && ri > 0 ? 2.5 : 0 }));
  });
  return out;
}

function table(ctx: Ctx, cols: Col[], rows: Cell[][]) {
  const drawHeader = () => {
    const h = 16;
    ctx.page.drawRectangle({ x: M, y: ctx.y - h, width: CW, height: h, color: HEAD_BG });
    let x = M;
    for (const c of cols) {
      const t = fitText(c.label.toUpperCase(), ctx.fontB, 6.5, c.width - 2 * CELL_PAD);
      const tx = c.align === "center" ? x + (c.width - ctx.fontB.widthOfTextAtSize(t, 6.5)) / 2 : x + CELL_PAD;
      ctx.page.drawText(t, { x: tx, y: ctx.y - 10.5, size: 6.5, font: ctx.fontB, color: MUTED });
      x += c.width;
    }
    ctx.y -= h;
  };
  ensure(ctx, 16 + 24);
  drawHeader();
  rows.forEach((row, ri) => {
    const laid = row.map((cell, ci) => cellLines(ctx, cell, cols[ci].width));
    const heightOf = (ls: typeof laid[number]) => ls.reduce((s, l) => s + l.size * 1.3 + l.gap, 0);
    const h = Math.max(14, ...laid.map(heightOf)) + 2 * CELL_PAD - 2;
    if (ensure(ctx, h)) drawHeader();
    if (ri % 2 === 1) ctx.page.drawRectangle({ x: M, y: ctx.y - h, width: CW, height: h, color: ZEBRA });
    let x = M;
    laid.forEach((ls, ci) => {
      const col = cols[ci];
      let y = ctx.y - CELL_PAD + 1;
      for (const l of ls) {
        y -= l.gap + l.size;
        const tx = col.align === "center" ? x + (col.width - l.font.widthOfTextAtSize(l.text, l.size)) / 2 : x + CELL_PAD;
        if (l.text) ctx.page.drawText(l.text, { x: tx, y, size: l.size, font: l.font, color: l.color });
        y -= l.size * 0.3;
      }
      x += col.width;
    });
    ctx.page.drawLine({ start: { x: M, y: ctx.y - h }, end: { x: M + CW, y: ctx.y - h }, thickness: 0.4, color: LINE });
    ctx.y -= h;
  });
  ctx.y -= 10;
}

// ── the review ────────────────────────────────────────────────────────────────
const rating = (n: number | null, na: boolean, scaleMax: number): Run[] =>
  na ? [{ text: "N/A", bold: true }] : n == null ? [{ text: "—", muted: true }] : [{ text: String(n), bold: true, size: 9 }, { text: ratingWord(n, scaleMax), muted: true, size: 6.5 }];

function scoreCard(ctx: Ctx) {
  const v = ctx.view;
  const h = 52;
  ensure(ctx, h + 10);
  const top = ctx.y;
  ctx.page.drawRectangle({ x: M, y: top - h, width: CW, height: h, color: GREEN_BG });
  ctx.page.drawRectangle({ x: M, y: top - h, width: 3, height: h, color: GREEN });
  ctx.page.drawText("FINAL SCORE", { x: M + 14, y: top - 15, size: 6.5, font: ctx.fontB, color: GREEN });
  ctx.page.drawText(safeText(formatScore(v.finalScore, v.scaleMax)), { x: M + 14, y: top - 37, size: 17, font: ctx.fontB, color: INK });
  const x2 = M + 170, w2 = CW - 184;
  const facts = [
    v.outcome ? `Outcome: ${OUTCOMES[v.outcome]}` : null,
    v.signedOffAt ? `Signed off${v.signedOffByName ? ` by ${v.signedOffByName}` : ""} on ${fmtDate(v.signedOffAt)}` : null,
    v.nextReviewDate ? `Next review: ${fmtDate(v.nextReviewDate)}` : null,
    v.scoreParts ? `Reviewers ${formatScore(v.scoreParts.reviewers, v.scaleMax)} x ${100 - v.selfShare}% + self-assessment ${formatScore(v.scoreParts.self, v.scaleMax)} x ${v.selfShare}%` : null,
  ].filter((s): s is string => !!s);
  facts.forEach((f, i) => ctx.page.drawText(fitText(f, i === 0 ? ctx.fontB : ctx.fontR, 8.5, w2), { x: x2, y: top - 16 - i * 12, size: 8.5, font: i === 0 ? ctx.fontB : ctx.fontR, color: INK }));
  ctx.y -= h + 12;
}

function signatures(ctx: Ctx) {
  const v = ctx.view;
  const boxes: { title: string; name: string; sub: string | null; date: string | null; note: string }[] = [
    { title: "Employee", name: v.employeeName, sub: v.employeeDesignation, date: v.acknowledgedAt ? fmtDate(v.acknowledgedAt) : null, note: "Acknowledged on" },
    { title: "Reviewer", name: v.reviewerName ?? "", sub: v.reviewerDesignation, date: v.managerSubmittedAt ? fmtDate(v.managerSubmittedAt) : null, note: "Submitted on" },
    { title: "HR sign-off", name: v.signedOffByName ?? "", sub: null, date: v.signedOffAt ? fmtDate(v.signedOffAt) : null, note: "Signed off on" },
  ];
  const gap = 12, bw = (CW - 2 * gap) / 3, bh = 92;
  ensure(ctx, bh + 34);
  heading(ctx, "Signatures");
  const top = ctx.y;
  boxes.forEach((b, i) => {
    const x = M + i * (bw + gap);
    ctx.page.drawRectangle({ x, y: top - bh, width: bw, height: bh, borderColor: LINE, borderWidth: 0.6 });
    ctx.page.drawText(safeText(b.title.toUpperCase()), { x: x + 8, y: top - 13, size: 6.5, font: ctx.fontB, color: MUTED });
    // space for a signature, then the line it goes on
    const lineY = top - 52;
    ctx.page.drawLine({ start: { x: x + 8, y: lineY }, end: { x: x + bw - 8, y: lineY }, thickness: 0.6, color: MUTED });
    ctx.page.drawText(fitText(b.name || "Name:", ctx.fontB, 8.5, bw - 16), { x: x + 8, y: lineY - 12, size: 8.5, font: b.name ? ctx.fontB : ctx.fontR, color: b.name ? INK : FAINT });
    if (b.sub) ctx.page.drawText(fitText(b.sub, ctx.fontR, 7.5, bw - 16), { x: x + 8, y: lineY - 22.5, size: 7.5, font: ctx.fontR, color: MUTED });
    const dateText = b.date ? `${b.note} ${b.date}` : "Date: ____________________";
    ctx.page.drawText(fitText(dateText, ctx.fontR, 7.5, bw - 16), { x: x + 8, y: top - bh + 8, size: 7.5, font: ctx.fontR, color: b.date ? INK : FAINT });
  });
  ctx.y = top - bh - 10;
}

export async function generateReviewPdf(view: ReviewView, lh: Letterhead, generatedAt = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safeText(`Performance review - ${view.employeeName} - ${view.periodName}`));
  doc.setAuthor(safeText(lh.companyName));
  doc.setSubject(safeText(view.templateName));
  doc.setCreator("nixcript");
  const ctx: Ctx = {
    doc, page: null as unknown as PDFPage, pages: [], y: 0,
    fontR: await doc.embedFont(StandardFonts.Helvetica), fontB: await doc.embedFont(StandardFonts.HelveticaBold),
    logo: await embedLogo(doc, lh), lh, brand: rgb(...lh.brand), view,
  };
  newPage(ctx);

  const v = view;
  const seeSelf = v.role === "employee" || selfSideVisible(v.role, v.status);
  const seeManager = managerSideVisible(v.role, v.status);

  // not final yet, or cancelled: said at the top so a printed copy is never taken for the signed-off one
  if (v.status === "cancelled") banner(ctx, "This review was cancelled. It is not a valid performance review.", RED_BG, RED);
  else if (v.status !== "completed") banner(ctx, `Not final: ${STATUS_LABEL[v.status]}. This copy shows the review as it stands on ${fmtDate(generatedAt)}; ratings and comments may still change.`, AMBER_BG, AMBER);
  if (v.status === "completed" && seeManager) scoreCard(ctx);

  heading(ctx, "Review details");
  const range = v.periodStart ? `${fmtDate(v.periodStart)} to ${fmtDate(v.periodEnd)}` : "";
  details(ctx, [
    ["Employee's full name", v.employeeName],
    ["Designation", v.employeeDesignation],
    ["Department", v.employeeDepartment],
    ["Purpose of review", v.purpose ? PURPOSES[v.purpose] : null],
    ["Reviewer", v.reviewerName],
    ["Reviewer's designation", v.reviewerDesignation],
    ["Review period", [v.periodName, range].filter(Boolean).join(" · ")],
    ["Form", v.templateName],
  ]);

  // ── Section A: completed by the employee ──
  if (seeSelf && (v.previousGoals.length > 0 || v.questions.length > 0)) {
    heading(ctx, "Section A: Employee's self-assessment", "Completed by the employee.");
    if (v.previousGoals.length > 0) {
      subheading(ctx, "Progress towards the goals identified in the last performance review");
      table(ctx, [
        { label: "Goal", width: CW * 0.3 }, { label: "Action taken", width: CW * 0.3 },
        { label: "Completed?", width: CW * 0.12, align: "center" }, { label: "Comments", width: CW * 0.28 },
      ], v.previousGoals.map((g) => [g.goal, g.action || "—", g.completed === "Y" ? "Yes" : g.completed === "N" ? "No" : "—", g.comments || "—"]));
    }
    for (const q of v.questions) {
      subheading(ctx, q.label);
      if (q.help) paragraph(ctx, q.help, { size: 7.5, color: MUTED });
      ctx.y -= 2;
      answerBox(ctx, v.questionAnswers[q.id]);
    }
  }

  // ── core competencies ──
  heading(ctx, "Core competencies", `Rating scale: ${(RATING_WORDS[v.scaleMax] ?? []).map((w, i) => `${i + 1} = ${w}`).join(" · ")} · N/A = Not applicable`);
  const showWeight = v.criteria.some((c) => c.weight !== 1);
  // several reviewers: a column each (when their marks may be shown) and the combined mark; else one Manager column
  const each = seeManager ? v.reviewers.filter((x) => x.isLead || x.submittedAt) : [];
  const showCombined = seeManager && v.multipleReviewers && !!v.combined;
  const markCols = (seeSelf ? 1 : 0) + (v.multipleReviewers ? each.length + (showCombined ? 1 : 0) : seeManager ? 1 : 0);
  const rw = markCols > 4 ? 46 : 62;
  const firstName = (n: string) => n.split(/\s+/)[0];
  const ratingCols: Col[] = [
    ...(seeSelf ? [{ label: "Self", width: rw, align: "center" as const }] : []),
    ...(seeManager && !v.multipleReviewers ? [{ label: "Manager", width: rw, align: "center" as const }] : []),
    ...each.map((x) => ({ label: `${firstName(x.name)} ${x.share}%`, width: rw, align: "center" as const })),
    ...(showCombined ? [{ label: "Combined", width: rw, align: "center" as const }] : []),
  ];
  const fixed = 22 + (showWeight ? 40 : 0) + ratingCols.reduce((s, c) => s + c.width, 0);
  const cols: Col[] = [
    { label: "#", width: 22, align: "center" },
    { label: "Criterion", width: CW - fixed },
    ...(showWeight ? [{ label: "Weight", width: 40, align: "center" as const }] : []),
    ...ratingCols,
  ];
  const sections = [...new Set(v.criteria.map((c) => c.section || "General"))];
  let n = 0;
  for (const sec of sections) {
    // a section named like the heading above it ("Core competencies") is not named twice
    if (sections.length > 1 && sec.trim().toLowerCase() !== "core competencies") subheading(ctx, sec);
    table(ctx, cols, v.criteria.filter((c) => (c.section || "General") === sec).map((c) => {
      n++;
      const a = v.answers[c.id];
      const points = (c.description ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      const crit: Run[] = [
        { text: c.name, bold: true, size: 8.5 },
        ...points.map((p) => ({ text: points.length > 1 ? `•  ${p}` : p, muted: true, size: 7 })),
        ...(seeSelf && a.selfComment ? [{ text: `Employee: ${a.selfComment}`, size: 7.5 }] : []),
        ...(seeManager && a.managerComment && !each.length ? [{ text: `${v.multipleReviewers ? "Lead reviewer" : "Manager"}: ${a.managerComment}`, size: 7.5 }] : []),
        ...each.filter((x) => x.answers[c.id]?.comment).map((x) => ({ text: `${x.name}: ${x.answers[c.id]!.comment}`, size: 7.5 })),
      ];
      return [
        String(n), crit,
        ...(showWeight ? [String(c.weight)] : []),
        ...(seeSelf ? [rating(a.selfRating, a.selfNa, v.scaleMax)] : []),
        ...(seeManager && !v.multipleReviewers ? [rating(a.managerRating, a.managerNa, v.scaleMax)] : []),
        ...each.map((x) => rating(x.answers[c.id]?.rating ?? null, !!x.answers[c.id]?.na, v.scaleMax)),
        ...(showCombined ? [v.combined![c.id] == null ? [{ text: "—", muted: true }] : [{ text: v.combined![c.id]!.toFixed(2), bold: true, size: 9 }]] as Run[][] : []),
      ];
    }));
  }

  // ── comments ──
  if (seeSelf) { heading(ctx, "Employee's other comments"); answerBox(ctx, v.selfSummary, "None"); }
  if (seeManager && !each.length) { heading(ctx, v.multipleReviewers ? "Lead reviewer's comments" : "Reviewer's comments"); answerBox(ctx, v.managerSummary, "None"); }
  for (const x of each) { heading(ctx, `${x.name}'s comments${x.isLead ? " (lead reviewer)" : ""}`, `Share of the score: ${x.share}% · own score ${formatScore(x.score, v.scaleMax)}`); answerBox(ctx, x.summary, "None"); }

  // ── Section B: completed by the reviewer ──
  if (seeManager) {
    heading(ctx, "Section B: Overall review outcome", "Completed by the reviewer.");
    details(ctx, [
      ["Outcome", v.outcome ? OUTCOMES[v.outcome] : null],
      ["Next review date", v.nextReviewDate ? fmtDate(v.nextReviewDate) : null],
    ]);
    subheading(ctx, "Action plan (goals for the next review period)");
    if (v.actionPlan.length === 0) paragraph(ctx, "No goals set.", { color: FAINT });
    else table(ctx, [{ label: "Goal", width: CW * 0.38 }, { label: "Action required", width: CW * 0.44 }, { label: "Target date", width: CW * 0.18 }],
      v.actionPlan.map((g) => [g.goal, g.action || "—", g.targetDate ? fmtDate(g.targetDate) : "—"]));
    if (v.signoffComment) { heading(ctx, "HR sign-off comment"); answerBox(ctx, v.signoffComment); }
  }

  // the employee's answer with the acknowledgment, how HR settled a disagreement, and earlier rounds
  if (v.employeeResponse) {
    heading(ctx, "Employee's response");
    paragraph(ctx, v.employeeResponse === "agree" ? "The employee agrees with this review." : "The employee disagrees with this review.");
    if (v.employeeComment) answerBox(ctx, v.employeeComment);
    if (v.disputeResolvedAt) {
      subheading(ctx, `HR kept the marks${v.disputeResolvedByName ? ` (${v.disputeResolvedByName})` : ""}, ${fmtDate(v.disputeResolvedAt)}`);
      if (v.disputeResolution) answerBox(ctx, v.disputeResolution);
    }
  }
  if (v.rounds.length > 0) {
    heading(ctx, "Earlier rounds");
    for (const h of v.rounds) {
      paragraph(ctx, `Round ${h.round}: score ${formatScore(h.finalScore, v.scaleMax)}, signed off ${h.signedOffAt ? fmtDate(h.signedOffAt) : "—"}. Reopened ${fmtDate(h.reopenedAt)}${h.reopenedByName ? ` by ${h.reopenedByName}` : ""} after the employee disagreed.`);
      if (h.employeeComment) answerBox(ctx, `Employee: ${h.employeeComment}`);
      answerBox(ctx, `HR: ${h.reopenNote}`);
    }
  }

  signatures(ctx);
  stampFooters(ctx, generatedAt);
  return doc.save();
}
