import { getInvoiceForPdf } from "@/server/invoice";
import { generateInvoicePdf } from "@/lib/ledger-export/invoice-pdf";
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
    data = await getInvoiceForPdf(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (!data) return new Response("Not Found", { status: 404 });

  const { invoice: inv, items, expenses, org } = data;

  let bytes: Uint8Array;
  try {
    bytes = await generateInvoicePdf(
      {
        invoiceNo: inv.invoiceNo,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        status: inv.status,
        notes: inv.notes,
        subtotal: inv.subtotal,
        overallDiscountAmt: inv.overallDiscountAmt,
        sstPct: inv.sstPct,
        sst: inv.sst,
        grandTotal: inv.grandTotal,
        customerSnapshot: inv.customerSnapshot as InvoiceForPdfCustomerSnapshot,
        items,
        expenses,
      },
      org,
    );
  } catch (err) {
    console.error("[invoice/pdf/route] PDF generation failed:", err);
    return new Response("PDF generation failed", { status: 500 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${inv.invoiceNo}.pdf"`,
    },
  });
}

type InvoiceForPdfCustomerSnapshot = {
  title?: string;
  name?: string;
  organizationName?: string;
  organizationAddress?: string;
  email?: string;
  contactNo?: string;
} | null;
