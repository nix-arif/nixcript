import { requirePermission } from "@/lib/auth/require-permission";
import { getInvoices, getOrgMembersForInvoice } from "@/server/invoice";
import { getDocumentCategories } from "@/server/document-category";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { getSuppliers } from "@/server/supplier";
import { AdminInvoiceClient } from "./admin-invoice-client";

export default async function AdminInvoicePage() {
  await requirePermission("organization-profile:update");
  const [result, categories, customerPos, suppliers, members] = await Promise.all([
    getInvoices(),
    getDocumentCategories().catch(() => []),
    getCustomerPos(),
    getSuppliers(),
    getOrgMembersForInvoice().catch(() => []),
  ]);
  return (
    <AdminInvoiceClient
      invoices={result.rows}
      categories={categories}
      customerPos={customerPos}
      suppliers={suppliers}
      members={members}
    />
  );
}
