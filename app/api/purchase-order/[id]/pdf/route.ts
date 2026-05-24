import { getPoForPrint } from "@/server/purchase-order";
import { generatePurchaseOrderPdf } from "@/app/dashboard/procurement/purchase-order/[id]/print/generate-po-pdf";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  let data;
  try {
    data = await getPoForPrint(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (!data) return new Response("Not Found", { status: 404 });

  let bytes: Uint8Array;
  try {
    bytes = await generatePurchaseOrderPdf(data);
  } catch (err) {
    console.error("[purchase-order/pdf/route] PDF generation failed:", err);
    return new Response("PDF generation failed", { status: 500 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.order.poNo}.pdf"`,
    },
  });
}
