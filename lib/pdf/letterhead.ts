// The letterhead of one company (its organization profile), for PDFs that must carry the company the document
// belongs to rather than whichever company the person downloading it has open. A performance review, for one, is kept
// under the employee's own company, which may be a sister company of the one HR is working in.
//
// This is in lib/ on purpose, not in a "use server" file: those exports can be called from the browser, and this
// reads any company by id. Callers check that the person may see the document first.
import { eq } from "drizzle-orm";
import { rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { db } from "@/db";
import { organization, organizationProfile } from "@/db/schema";
import { hexToRgb01, wrapParts, wrapText } from "@/lib/pdf/text";

export type Letterhead = {
  companyName: string;
  address: string | null;
  registration: string | null; // "SSM: 202001012345 (1234567-X)  ·  Tax: C1234567890"
  contact: string | null;      // email · website · phone
  nameSize: number;
  nameBold: boolean;
  nameUppercase: boolean;
  brand: [number, number, number];
  logo: { bytes: Uint8Array; kind: "png" | "jpg" } | null;
};

const NAME_SIZES: Record<string, number> = { small: 10, medium: 13, large: 16, xlarge: 20 };

export async function loadLetterhead(orgId: string): Promise<Letterhead> {
  const [org] = await db.select({ name: organization.name, logo: organization.logo }).from(organization).where(eq(organization.id, orgId)).limit(1);
  const [p] = await db.select().from(organizationProfile).where(eq(organizationProfile.organizationId, orgId)).limit(1);

  const reg: string[] = [];
  if (p?.newSsmNo || p?.oldSsmNo) reg.push(p.newSsmNo && p.oldSsmNo ? `SSM: ${p.newSsmNo} (${p.oldSsmNo})` : `SSM: ${p.newSsmNo ?? p.oldSsmNo}`);
  if (p?.taxNo) reg.push(`Tax: ${p.taxNo}`);
  const contact = [p?.email, p?.website, p?.phone].filter(Boolean).join("  ·  ");

  return {
    companyName: p?.companyName || org?.name || "",
    address: p?.companyAddress || null,
    registration: reg.length ? reg.join("  ·  ") : null,
    contact: contact || null,
    nameSize: NAME_SIZES[p?.orgNameSize ?? "medium"] ?? 13,
    nameBold: (p?.orgNameBold ?? 1) === 1,
    nameUppercase: (p?.orgNameUppercase ?? 0) === 1,
    brand: hexToRgb01(p?.brandColor),
    logo: org?.logo ? await fetchLogo(org.logo) : null,
  };
}

// PNG or JPEG only (what pdf-lib can embed), told apart by the file's first bytes rather than its URL.
// No logo is better than no PDF: any failure, or a slow logo host, just leaves it out.
async function fetchLogo(url: string): Promise<Letterhead["logo"]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { bytes, kind: "png" };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, kind: "jpg" };
    return null; // SVG, WebP ...
  } catch {
    return null;
  }
}

export async function embedLogo(doc: PDFDocument, lh: Letterhead): Promise<PDFImage | null> {
  if (!lh.logo) return null;
  try {
    return lh.logo.kind === "png" ? await doc.embedPng(lh.logo.bytes) : await doc.embedJpg(lh.logo.bytes);
  } catch {
    return null;
  }
}

// Draws the letterhead at the top of a page: the logo and the company's details on the left, the document's title
// (and a line or two under it) on the right, then a rule in the brand colour. Returns the y below it.
// Nothing is cut: the name, the address and the registration / contact lines wrap onto as many lines as they need,
// and the title block on the right has a fixed maximum width so a long form name cannot squeeze the company's details.
export function drawLetterhead(
  page: PDFPage,
  o: { lh: Letterhead; logo: PDFImage | null; fontR: PDFFont; fontB: PDFFont; x: number; top: number; width: number; title: string; subtitle?: string[] },
): number {
  const { lh, logo, fontR, fontB, x, top, width } = o;
  const right = x + width;
  const ink = rgb(0.1, 0.1, 0.1), muted = rgb(0.4, 0.4, 0.4), faint = rgb(0.55, 0.55, 0.55);

  // right: the title and its subtitle lines, right-aligned, never wider than RIGHT_MAX
  const RIGHT_MAX = Math.min(170, width * 0.32);
  const titleSize = 12, subSize = 8;
  const titleLines = wrapText(o.title, fontB, titleSize, RIGHT_MAX);
  const subLines = (o.subtitle ?? []).flatMap((s) => wrapText(s, fontR, subSize, RIGHT_MAX));
  let ry = top;
  for (const t of titleLines) {
    ry -= titleSize;
    page.drawText(t, { x: right - fontB.widthOfTextAtSize(t, titleSize), y: ry, size: titleSize, font: fontB, color: rgb(...lh.brand) });
    ry -= 2;
  }
  ry -= 3;
  for (const t of subLines) {
    ry -= subSize;
    page.drawText(t, { x: right - fontR.widthOfTextAtSize(t, subSize), y: ry, size: subSize, font: fontR, color: muted });
    ry -= 2.5;
  }
  const rightW = Math.max(...titleLines.map((t) => fontB.widthOfTextAtSize(t, titleSize)), ...subLines.map((t) => fontR.widthOfTextAtSize(t, subSize)), 0);

  // left: the logo, then the name and details beside it
  let tx = x;
  let logoBottom = top;
  if (logo) {
    const scale = Math.min(46 / logo.height, 110 / logo.width);
    const lw = logo.width * scale, lhgt = logo.height * scale;
    page.drawImage(logo, { x, y: top - lhgt, width: lw, height: lhgt });
    tx = x + lw + 10;
    logoBottom = top - lhgt;
  }
  const zone = right - (rightW + 20) - tx; // the width the company's details may use
  const nameFont = lh.nameBold ? fontB : fontR;
  const name = lh.nameUppercase ? lh.companyName.toUpperCase() : lh.companyName;
  const detailSize = 7.5, detailLH = 9.5;
  let ly = top;
  for (const t of wrapText(name, nameFont, lh.nameSize, zone)) {
    ly -= lh.nameSize;
    page.drawText(t, { x: tx, y: ly, size: lh.nameSize, font: nameFont, color: ink });
    ly -= 2;
  }
  ly -= 2;
  const detail = (lines: string[], color: typeof ink) => {
    for (const t of lines) { ly -= detailLH; page.drawText(t, { x: tx, y: ly + 2, size: detailSize, font: fontR, color }); }
  };
  detail(wrapParts(lh.address, fontR, detailSize, zone, "address"), muted);
  detail(wrapParts(lh.registration, fontR, detailSize, zone, "list"), muted);
  detail(wrapParts(lh.contact, fontR, detailSize, zone, "list"), faint);

  const y = Math.min(ly, ry, logoBottom) - 8;
  page.drawRectangle({ x, y: y - 1.6, width, height: 1.6, color: rgb(...lh.brand) });
  return y - 16;
}
