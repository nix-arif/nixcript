import { requirePermission } from "@/lib/auth/require-permission";
import { getInvoices } from "@/server/invoice";
import { InvoiceListClient } from "./invoice-list-client";

export default async function InvoicePage() {
  await requirePermission("invoice:read");
  const invoices = await getInvoices();
  return <InvoiceListClient initialInvoices={invoices} />;
}
