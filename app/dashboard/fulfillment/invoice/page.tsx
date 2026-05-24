import { requirePermission } from "@/lib/auth/require-permission";
import { getInvoices } from "@/server/invoice";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { InvoiceListClient } from "./invoice-list-client";

export default async function InvoicePage() {
  const session = await requirePermission("invoice:read");
  const [invoices, permissions] = await Promise.all([
    getInvoices(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <InvoiceListClient initialInvoices={invoices} permissions={permissions} currentUserId={session.user.id} />;
}
