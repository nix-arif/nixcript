import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomers } from "@/server/customer";
import { CustomerClient } from "./customer-client";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";

export default async function CustomerPage() {
  await requirePermission("customer:read");

  const session = await auth.api.getSession({ headers: await headers() });
  const orgId = session?.session.activeOrganizationId ?? "";
  const userId = session?.user.id ?? "";
  const perms = await getUserPermissions(userId, orgId);
  const canEdit = perms.includes("*") || perms.includes("customer:create");

  const customers = await getCustomers();

  return <CustomerClient initialCustomers={customers} canEdit={canEdit} />;
}
