import { getQuotationDetail } from "@/server/quotation";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

interface Props {
  params: Promise<{ id: string }>;
}

type MdaItem = {
  no: number | null;
  mdaPdfFile: string;
  mdaPdfUrl: string;
  mdaRegNo: string | null;
  mdaPageNo: string | null;
  mdaMatchX: string | null;
  mdaMatchY: string | null;
  mdaRowHeight: string | null;
  mdaPageWidth: string | null;
  mdaPageHeight: string | null;
};

function isMdapc(items: MdaItem[]): boolean {
  return items.some((i) => i.mdaRegNo?.toUpperCase().startsWith("MDAPC"));
}

function drawBadge(
  page: ReturnType<PDFDocument["getPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  label: string,
  x: number,
  y: number,
  h: number,
) {
  const fontSize = Math.max(7, Math.min(10, h * 0.75));
  const w = font.widthOfTextAtSize(label, fontSize) + 6;
  page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.09, 0.29, 0.65), opacity: 0.9 });
  page.drawText(label, { x: x + 3, y: y + (h - fontSize) / 2 + 1, size: fontSize, font, color: rgb(1, 1, 1) });
  return w;
}

export async function GET(_req: Request, { params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  let data;
  try {
    data = await getQuotationDetail(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  if (!data) return new Response("Not Found", { status: 404 });

  const { quotation: q, items } = data;

  console.log(`[mda-certs] quotation=${q.quotationNo} items=${items.length}`);
  for (const item of items) {
    const it = item as any;
    console.log(`[mda-certs] item=${it.productCode ?? it.id} hasCert=${it.hasCert} mdaPdfFile=${it.mdaPdfFile ?? "null"} mdaPdfUrl=${it.mdaPdfUrl ? "set" : "null"}`);
  }

  // Group certified items by unique MDA PDF file key
  const mdaGroups = new Map<string, { url: string; items: MdaItem[] }>();
  for (const item of items) {
    const it = item as any;
    if (!Number(it.hasCert) || !it.mdaPdfFile || !it.mdaPdfUrl) continue;
    const g = mdaGroups.get(it.mdaPdfFile) ?? { url: it.mdaPdfUrl as string, items: [] as MdaItem[] };
    g.items.push({
      ...(it as MdaItem),
      no: it.rowNo ?? null,
      mdaRegNo: it.mdaRegNo ?? null,
    });
    mdaGroups.set(it.mdaPdfFile, g);
  }

  if (mdaGroups.size === 0) {
    const certCount = items.filter((i) => Number((i as any).hasCert)).length;
    const withPdf = items.filter((i) => Number((i as any).hasCert) && (i as any).mdaPdfFile).length;
    const msg = `No MDA certificates available. Certified items: ${certCount}, with PDF file in product table: ${withPdf}`;
    console.log(`[mda-certs] ${msg}`);
    return new Response(msg, { status: 404 });
  }

  const mergedPdf = await PDFDocument.create();
  const font = await mergedPdf.embedFont(StandardFonts.HelveticaBold);

  for (const [, g] of mdaGroups) {
    try {
      const res = await fetch(g.url);
      if (!res.ok) continue;
      const buf    = await res.arrayBuffer();
      const srcPdf = await PDFDocument.load(buf);
      const total  = srcPdf.getPageCount();

      const allNos = [...new Set(
        g.items.map((i) => i.no).filter((n): n is number => n != null),
      )].sort((a, b) => a - b);
      const nosLabel = allNos.join(", ");

      if (isMdapc(g.items)) {
        // MDAPC: full certificate, no highlights, nos badge on first page only
        const allIdx = Array.from({ length: total }, (_, i) => i);
        const copied = await mergedPdf.copyPages(srcPdf, allIdx);
        copied.forEach((page, i) => {
          if (i === 0 && nosLabel) {
            const badgeH = 16;
            const badgeX = page.getWidth() - font.widthOfTextAtSize(nosLabel, 10) - 6 - 10;
            const badgeY = page.getHeight() - badgeH - 10;
            drawBadge(page, font, nosLabel, badgeX, badgeY, badgeH);
          }
          mergedPdf.addPage(page);
        });
      } else {
        // Standard: pages 1 & 2 + item-specific pages with row highlights
        const pageSet = new Set<number>([0, 1].filter((i) => i < total));
        // Key: "pageIdx:y" — merges same-product duplicate rows into one highlight
        const hlMap = new Map<string, { x: number; y: number; w: number; h: number; nos: number[] }>();

        for (const item of g.items) {
          if (!item.mdaPageNo) continue;
          const idx = parseInt(item.mdaPageNo) - 1;
          if (isNaN(idx) || idx < 0 || idx >= total) continue;
          pageSet.add(idx);
          if (item.mdaMatchX && item.mdaMatchY && item.mdaRowHeight && item.mdaPageWidth && item.mdaPageHeight) {
            const srcPage = srcPdf.getPage(idx);
            const scaleY  = srcPage.getHeight() / parseFloat(item.mdaPageHeight);
            const y = parseFloat(item.mdaMatchY) * scaleY - 2;
            const key = `${idx}:${y.toFixed(1)}`;
            const existing = hlMap.get(key);
            if (existing) {
              if (item.no != null) existing.nos.push(item.no);
            } else {
              hlMap.set(key, {
                x: 0,
                y,
                w: srcPage.getWidth(),
                h: parseFloat(item.mdaRowHeight) * scaleY + 4,
                nos: item.no != null ? [item.no] : [],
              });
            }
          }
        }

        // Re-bucket by page index for rendering
        const highlights = new Map<number, Array<{ x: number; y: number; w: number; h: number; nos: number[] }>>();
        for (const [key, hl] of hlMap) {
          const idx = parseInt(key.split(":")[0]);
          const arr = highlights.get(idx) ?? [];
          arr.push(hl);
          highlights.set(idx, arr);
        }

        const sortedIdx = [...pageSet].sort((a, b) => a - b);
        const copied = await mergedPdf.copyPages(srcPdf, sortedIdx);
        sortedIdx.forEach((srcIdx, i) => {
          const page = copied[i];
          for (const hl of (highlights.get(srcIdx) ?? [])) {
            page.drawRectangle({ x: hl.x, y: hl.y, width: hl.w, height: hl.h, color: rgb(1, 1, 0), opacity: 0.3 });
            if (hl.nos.length > 0) {
              const label = hl.nos.slice().sort((a, b) => a - b).join(", ");
              const badgeH = hl.h;
              const badgeX = hl.w - font.widthOfTextAtSize(label, Math.max(7, Math.min(10, badgeH * 0.75))) - 6 - 2;
              drawBadge(page, font, label, badgeX, hl.y, badgeH);
            }
          }
          mergedPdf.addPage(page);
        });
      }
    } catch { /* skip unavailable cert */ }
  }

  if (mergedPdf.getPageCount() === 0) {
    return new Response("No MDA certificate pages could be retrieved", { status: 404 });
  }

  const bytes = await mergedPdf.save();
  const filename = `${q.quotationNo}-mda-certs.pdf`;

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
