import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers } from "@/server/members";
import { CreateCustomerPoClient } from "./create-customer-po-client";

export default async function CreateCustomerPoPage() {
  await requirePermission("customer-po:create");
  const members = await getOrgMembers().catch(() => []);
  return <CreateCustomerPoClient members={members} />;
}
