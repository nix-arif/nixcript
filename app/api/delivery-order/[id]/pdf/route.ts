import { getDoForPdf } from "@/server/delivery-order";
import { generateDeliveryOrderPdf, type DoPdfOptions } from "@/app/dashboard/fulfillment/delivery/[id]/print/generate-do-pdf";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

interface Props {
  params: Promise<{ id: string }>;
}

export const maxDuration = 60;

export async function GET(req: Request, { params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const withPrice = url.searchParams.get("withPrice") === "1";
  const copyParam = url.searchParams.get("copy");
  const copy = copyParam === "customer" || copyParam === "internal" ? copyParam : undefined;

  let data;
  try {
    data = await getDoForPdf(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (!data) return new Response("Not Found", { status: 404 });

  // A Case DO's internal copy (and its plain full-item PDF) lists every item
  // actually deducted, items without MDA and what the customer copy shows
  // instead — only for users given "Download Case DO Internal Copy"
  if (data.order.isCaseDo && copy !== "customer" && data.order.actualStatus === "pending") {
    return new Response("The actual items of this Case DO aren't recorded yet — record them after the case, then download the internal copy", { status: 409 });
  }
  if (data.order.isCaseDo && copy !== "customer") {
    const orgId = session.session.activeOrganizationId;
    const perms = orgId ? await getUserPermissions(session.user.id, orgId) : [];
    if (!hasAccess(perms, "delivery-order:internal-copy")) {
      return new Response("You don't have permission to download the internal copy of a Case DO", { status: 403 });
    }
  }

  const options: DoPdfOptions = { withPrice, copy };

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
      "Content-Disposition": `attachment; filename="${data.order.doNo}${copy === "internal" ? "-internal" : ""}.pdf"`,
    },
  });
}
