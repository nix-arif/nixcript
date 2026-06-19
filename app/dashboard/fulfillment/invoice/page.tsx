import { requirePermission } from "@/lib/auth/require-permission";
import { getInvoices } from "@/server/invoice";
import { getPendingDosForInvoice } from "@/server/delivery-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getDocumentCategories } from "@/server/document-category";
import { InvoiceListClient } from "./invoice-list-client";

export default async function InvoicePage() {
  const session = await requirePermission("invoice:read");
  const [invoices, pendingDos, permissions, categories] = await Promise.all([
    getInvoices(),
    getPendingDosForInvoice().catch(() => []),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getDocumentCategories().catch(() => []),
  ]);
  return <InvoiceListClient initialInvoices={invoices} pendingDos={pendingDos} permissions={permissions} currentUserId={session.user.id} categories={categories} />;
}
