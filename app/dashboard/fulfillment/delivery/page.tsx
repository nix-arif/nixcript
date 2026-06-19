import { requirePermission } from "@/lib/auth/require-permission";
import { getDeliveryOrders, getPendingSosForDo } from "@/server/delivery-order";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { DeliveryOrderListClient } from "./delivery-list-client";

export default async function DeliveryOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await requirePermission("delivery-order:read");
  const sp     = await searchParams;
  const page   = parseInt(sp.page ?? "1") || 1;
  const search = sp.search ?? "";
  const status = sp.status ?? "";

  const [result, pendingSos, permissions] = await Promise.all([
    getDeliveryOrders({ page, search: search || undefined, status: status || undefined }),
    getPendingSosForDo().catch(() => []),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);

  return (
    <DeliveryOrderListClient
      initialOrders={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      initialSearch={search}
      initialStatus={status}
      pendingSos={pendingSos}
      permissions={permissions}
      currentUserId={session.user.id}
    />
  );
}
