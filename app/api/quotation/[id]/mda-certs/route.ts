import { getQuotationDetail } from "@/server/quotation";
import { PDFDocument, rgb } from "pdf-lib";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

interface Props {
  params: Promise<{ id: string }>;
}

type MdaItem = {
  mdaPdfFile: string;
  mdaPdfUrl: string;
  mdaPageNo: string | null;
  mdaMatchX: string | null;
  mdaMatchY: string | null;
  mdaRowHeight: string | null;
  mdaPageWidth: string | null;
  mdaPageHeight: string | null;
};

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

  // Group certified items by unique MDA PDF file key
  const mdaGroups = new Map<string, { url: string; items: MdaItem[] }>();
  for (const item of items) {
    const it = item as any;
    if (!Number(it.hasCert) || !it.mdaPdfFile || !it.mdaPdfUrl) continue;
    const g = mdaGroups.get(it.mdaPdfFile) ?? { url: it.mdaPdfUrl as string, items: [] as MdaItem[] };
    g.items.push(it as MdaItem);
    mdaGroups.set(it.mdaPdfFile, g);
  }

  if (mdaGroups.size === 0) {
    return new Response("No MDA certificates available for this quotation", { status: 404 });
  }

  const mergedPdf = await PDFDocument.create();

  for (const [, g] of mdaGroups) {
    try {
      const res = await fetch(g.url);
      if (!res.ok) continue;
      const buf    = await res.arrayBuffer();
      const srcPdf = await PDFDocument.load(buf);
      const total  = srcPdf.getPageCount();

      // Always include pages 1 & 2, plus each item's specific product page
      const pageSet = new Set<number>([0, 1].filter(i => i < total));
      const highlights = new Map<number, Array<{ x: number; y: number; w: number; h: number }>>();

      for (const item of g.items) {
        if (!item.mdaPageNo) continue;
        const idx = parseInt(item.mdaPageNo) - 1;
        if (isNaN(idx) || idx < 0 || idx >= total) continue;
        pageSet.add(idx);
        if (item.mdaMatchX && item.mdaMatchY && item.mdaRowHeight && item.mdaPageWidth && item.mdaPageHeight) {
          const srcPage = srcPdf.getPage(idx);
          const scaleY  = srcPage.getHeight() / parseFloat(item.mdaPageHeight);
          const hl = {
            x: 0,
            y: parseFloat(item.mdaMatchY) * scaleY - 2,
            w: srcPage.getWidth(),
            h: parseFloat(item.mdaRowHeight) * scaleY + 4,
          };
          const arr = highlights.get(idx) ?? [];
          arr.push(hl);
          highlights.set(idx, arr);
        }
      }

      const sortedIdx = [...pageSet].sort((a, b) => a - b);
      const copied = await mergedPdf.copyPages(srcPdf, sortedIdx);
      sortedIdx.forEach((srcIdx, i) => {
        const page = copied[i];
        for (const hl of (highlights.get(srcIdx) ?? [])) {
          page.drawRectangle({ x: hl.x, y: hl.y, width: hl.w, height: hl.h, color: rgb(1, 1, 0), opacity: 0.3 });
        }
        mergedPdf.addPage(page);
      });
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
