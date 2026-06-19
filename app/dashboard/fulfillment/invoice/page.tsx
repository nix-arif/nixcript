import { requirePermission } from "@/lib/auth/require-permission";
import { getInvoices } from "@/server/invoice";
import { getPendingDosForInvoice } from "@/server/delivery-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getDocumentCategories } from "@/server/document-category";
import { InvoiceListClient } from "./invoice-list-client";

export default async function InvoicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await requirePermission("invoice:read");
  const sp     = await searchParams;
  const page   = parseInt(sp.page ?? "1") || 1;
  const search = sp.search ?? "";
  const status = sp.status ?? "";

  const [result, pendingDos, permissions, categories] = await Promise.all([
    getInvoices({ page, search: search || undefined, status: status || undefined }),
    getPendingDosForInvoice().catch(() => []),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    getDocumentCategories().catch(() => []),
  ]);

  return (
    <InvoiceListClient
      initialInvoices={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      initialSearch={search}
      initialStatus={status}
      pendingDos={pendingDos}
      permissions={permissions}
      currentUserId={session.user.id}
      categories={categories}
    />
  );
}
