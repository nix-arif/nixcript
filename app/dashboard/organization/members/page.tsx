import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers, getDeletedMembers } from "@/server/members";
import { getDepartments } from "@/server/departments";
import { MembersClient } from "./members-client";

export default async function MembersPage() {
  await requirePermission("member:read");
  const [members, deletedMembers, departments] = await Promise.all([
    getOrgMembers(),
    getDeletedMembers(),
    getDepartments(),
  ]);
  return <MembersClient members={members} deletedMembers={deletedMembers} departments={departments} />;
}
