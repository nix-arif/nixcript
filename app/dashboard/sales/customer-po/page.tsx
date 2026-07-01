import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { CustomerPoClient } from "./customer-po-client";
import { redirect } from "next/navigation";

export default async function CustomerPoPage() {
  const session = await getCachedSession();
  if (!session) redirect("/login");
  const perms = await getUserPermissions(session.user.id, session.session.activeOrganizationId ?? "");
  if (!perms.includes("*") && !perms.includes("customer-po:read")) redirect("/dashboard");
  const pos = await getCustomerPos();
  const canCreateSo = perms.includes("*") || perms.includes("sales-order:create");
  return <CustomerPoClient initialPos={pos} canCreateSo={canCreateSo} />;
}
