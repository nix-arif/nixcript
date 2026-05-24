import { requirePermission } from "@/lib/auth/require-permission";
import { getInvoiceDetail } from "@/server/invoice";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { InvoiceDetailClient } from "./invoice-detail-client";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("invoice:read");
  const { id } = await params;

  const [invoice, permissions] = await Promise.all([
    getInvoiceDetail(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  if (!invoice) notFound();

  return <InvoiceDetailClient invoice={invoice} permissions={permissions} currentUserId={session.user.id} />;
}
