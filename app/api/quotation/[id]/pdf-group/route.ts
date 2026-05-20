import { getQuotationGroupForPrint } from "@/server/quotation";
import { generateQuotationAffirma } from "@/app/dashboard/sales/quotation/[id]/print/affirma";
import { generateQuotationNexus } from "@/app/dashboard/sales/quotation/[id]/print/nexus";
import { generateQuotationSlate } from "@/app/dashboard/sales/quotation/[id]/print/slate";
import { generateQuotationAura } from "@/app/dashboard/sales/quotation/[id]/print/aura";
import { generateQuotationZinc } from "@/app/dashboard/sales/quotation/[id]/print/zinc";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { PDFDocument } from "pdf-lib";

interface Props {
  params: Promise<{ id: string }>;
}

const generators: Record<string, (data: any) => Promise<Uint8Array>> = {
  affirma: generateQuotationAffirma,
  nexus:   generateQuotationNexus,
  slate:   generateQuotationSlate,
  aura:    generateQuotationAura,
  zinc:    generateQuotationZinc,
};

export async function GET(_req: Request, { params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  let group;
  try {
    group = await getQuotationGroupForPrint(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (!group || group.length === 0) return new Response("Not Found", { status: 404 });

  const merged = await PDFDocument.create();

  for (const entry of group) {
    const generate = generators[entry.orgPdfTemplate ?? "affirma"] ?? generateQuotationAffirma;
    let bytes: Uint8Array;
    try {
      bytes = await generate({ ...entry, siblings: [] });
    } catch (err) {
      console.error(`[pdf-group/route] PDF generation failed for ${entry.quotation.quotationNo}:`, err);
      return new Response(`PDF generation failed for ${entry.quotation.quotationNo}`, { status: 500 });
    }
    const pdf      = await PDFDocument.load(bytes);
    const pages    = await merged.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }

  const mergedBytes = await merged.save();
  const filename = `${group[0].quotation.quotationNo}-comparison.pdf`;

  return new Response(Buffer.from(mergedBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
