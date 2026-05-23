import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getInvitations, getMemberCount } from "@/server/invitations";
import { getDepartments } from "@/server/departments";
import { InviteClient } from "./invite-client";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function InvitePage() {
  await requirePermission("member:invite");
  const session = await auth.api.getSession({ headers: await headers() });
  const activeOrgId = session?.session.activeOrganizationId;

  if (!activeOrgId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No active organization selected.
      </div>
    );
  }

  const [invitations, departments, memberCount] = await Promise.all([
    getInvitations(activeOrgId),
    getDepartments(),
    getMemberCount(activeOrgId),
  ]);

  const pendingCount = invitations.filter(
    (i) => i.status === "pending" && new Date(i.expiresAt) > new Date(),
  ).length;
  const expiredCount = invitations.filter(
    (i) =>
      i.status !== "accepted" &&
      i.status !== "cancelled" &&
      i.status !== "canceled" &&
      new Date(i.expiresAt) < new Date(),
  ).length;

  return (
    <InviteClient
      invitations={invitations}
      departments={departments}
      organizationId={activeOrgId}
      memberCount={memberCount}
      pendingCount={pendingCount}
      expiredCount={expiredCount}
    />
  );
}
