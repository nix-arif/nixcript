import { getQuotationDetail } from "@/server/quotation";
import { generateQuotationAffirma } from "@/app/dashboard/sales/quotation/[id]/print/affirma";
import { generateQuotationNexus } from "@/app/dashboard/sales/quotation/[id]/print/nexus";
import { generateQuotationSlate } from "@/app/dashboard/sales/quotation/[id]/print/slate";
import { generateQuotationAura } from "@/app/dashboard/sales/quotation/[id]/print/aura";
import { generateQuotationZinc } from "@/app/dashboard/sales/quotation/[id]/print/zinc";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

interface Props {
  params: Promise<{ id: string }>;
}

const generators: Record<string, (data: any) => Promise<Uint8Array>> = {
  affirma:     generateQuotationAffirma,
  nexus:       generateQuotationNexus,
  "nexus-ocean": generateQuotationNexus,
  "nexus-wine":  generateQuotationNexus,
  slate:       generateQuotationSlate,
  aura:        generateQuotationAura,
  zinc:        generateQuotationZinc,
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

  const generate = generators[data.orgPdfTemplate ?? "affirma"] ?? generateQuotationAffirma;
  let bytes: Uint8Array;
  try {
    bytes = await generate(data);
  } catch (err) {
    console.error("[pdf/route] PDF generation failed:", err);
    return new Response("PDF generation failed", { status: 500 });
  }
  const filename = `${data.quotation.quotationNo}.pdf`;

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
