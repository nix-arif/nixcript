import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers } from "@/server/members";
import { getDepartments } from "@/server/departments";
import { MembersClient } from "./members-client";

export default async function MembersPage() {
  await requirePermission("member:read");
  const [members, departments] = await Promise.all([getOrgMembers(), getDepartments()]);
  return <MembersClient members={members} departments={departments} />;
}
