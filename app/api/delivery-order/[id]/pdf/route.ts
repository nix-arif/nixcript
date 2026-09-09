import { getDoForPdf } from "@/server/delivery-order";
import { generateDeliveryOrderPdf, type DoPdfOptions } from "@/app/dashboard/fulfillment/delivery/[id]/print/generate-do-pdf";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const withPrice = url.searchParams.get("withPrice") === "1";

  let data;
  try {
    data = await getDoForPdf(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (!data) return new Response("Not Found", { status: 404 });

  const options: DoPdfOptions = { withPrice };

  let bytes: Uint8Array;
  try {
    bytes = await generateDeliveryOrderPdf(data, options);
  } catch (err) {
    console.error("[delivery-order/pdf/route] PDF generation failed:", err);
    return new Response("PDF generation failed", { status: 500 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.order.doNo}.pdf"`,
    },
  });
}
