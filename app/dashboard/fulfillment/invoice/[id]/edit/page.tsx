import { requirePermission } from "@/lib/auth/require-permission";
import { getInvoiceDetail, getOrgMembersForInvoice } from "@/server/invoice";
import { getSuppliers } from "@/server/supplier";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { getDocumentCategories } from "@/server/document-category";
import { getCustomer } from "@/server/customer";
import { notFound, redirect } from "next/navigation";
import { EditInvoiceClient, type Customer } from "./edit-invoice-client";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("invoice:update");
  const { id } = await params;

  const invoice = await getInvoiceDetail(id);
  if (!invoice) notFound();
  if (invoice.status !== "draft") redirect(`/dashboard/fulfillment/invoice/${id}`);

  const [suppliers, customerPos, categories, members] = await Promise.all([
    getSuppliers(),
    getCustomerPos(),
    getDocumentCategories().catch(() => []),
    getOrgMembersForInvoice().catch(() => []),
  ]);

  const initialCustomer = invoice.customerId
    ? (await getCustomer(invoice.customerId).catch(() => null)) as Customer | null
    : null;

  return (
    <EditInvoiceClient
      invoice={invoice}
      suppliers={suppliers}
      allCustomerPos={customerPos}
      categories={categories}
      members={members}
      initialCustomer={initialCustomer}
    />
  );
}
