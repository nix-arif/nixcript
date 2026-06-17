import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomers, getCustomerOrganizations } from "@/server/customer";
import { CustomerClient } from "./customer-client";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";

export default async function CustomerPage() {
  const session = await requirePermission("customer:read");
  const [customers, organizations, permissions] = await Promise.all([
    getCustomers(),
    getCustomerOrganizations(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  const canEdit = permissions.includes("*") || permissions.includes("customer:create");

  return (
    <CustomerClient
      initialCustomers={customers}
      initialOrganizations={organizations}
      canEdit={canEdit}
    />
  );
}
