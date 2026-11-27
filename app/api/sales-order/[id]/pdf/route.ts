import { getSalesOrderForPrint } from "@/server/sales-order";
import { currentRevision, versionSnapshot, reviveDates } from "@/lib/amendment/customer-po";
import { generateSalesOrderPdf } from "@/app/dashboard/sales/order/[id]/print/generate-so-pdf";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth/require-permission";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  let data;
  try {
    data = await getSalesOrderForPrint(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (!data) return new Response("Not Found", { status: 404 });

  // ?rev=N: an earlier version (Rev N), as it was kept by the amendment after it
  const current = await currentRevision("so", id);
  const revParam = new URL(req.url).searchParams.get("rev");
  const rev = revParam !== null && /^\d+$/.test(revParam) ? parseInt(revParam, 10) : current;
  if (rev < current) {
    const snap = await versionSnapshot("so", id, rev);
    if (!snap) return new Response(`Rev ${rev} of this sales order wasn't kept`, { status: 404 });
    data = { ...data, order: { ...data.order, ...reviveDates(snap.doc) }, items: snap.items.map((i) => reviveDates(i)) as typeof data.items };
  }

  const allowedStatuses = ["confirmed", "fulfilled"];
  // Approvers may download a preview PDF while the SO is awaiting approval
  if (data.order.status === "submitted") {
    try {
      await requirePermission("sales-order:approve");
      allowedStatuses.push("submitted");
    } catch {
      // not an approver — fall through to the status check below
    }
  }
  if (!allowedStatuses.includes(data.order.status))
    return new Response("PDF is only available for confirmed sales orders", { status: 403 });

  let bytes: Uint8Array;
  try {
    bytes = await generateSalesOrderPdf(data);
  } catch (err) {
    console.error("[sales-order/pdf/route] PDF generation failed:", err);
    return new Response("PDF generation failed", { status: 500 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.order.soNo}${rev > 0 ? ` Rev ${rev}` : ""}.pdf"`,
    },
  });
}
