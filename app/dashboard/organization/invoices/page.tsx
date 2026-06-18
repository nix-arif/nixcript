import { requirePermission } from "@/lib/auth/require-permission";
import { getInvoices } from "@/server/invoice";
import { getDocumentCategories } from "@/server/document-category";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { getSuppliers } from "@/server/supplier";
import { AdminInvoiceClient } from "./admin-invoice-client";

export default async function AdminInvoicePage() {
  await requirePermission("organization-profile:update");
  const [invoices, categories, customerPos, suppliers] = await Promise.all([
    getInvoices(),
    getDocumentCategories().catch(() => []),
    getCustomerPos(),
    getSuppliers(),
  ]);
  return (
    <AdminInvoiceClient
      invoices={invoices}
      categories={categories}
      customerPos={customerPos}
      suppliers={suppliers}
    />
  );
}
