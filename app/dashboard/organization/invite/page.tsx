import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getInvitations, getMemberCount } from "@/server/invitations";
import { getRoles } from "@/server/roles";
import { InviteClient } from "./invite-client";

export default async function InvitePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const activeOrgId = session?.session.activeOrganizationId;

  if (!activeOrgId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No active organization selected.
      </div>
    );
  }

  const [invitations, roles, memberCount] = await Promise.all([
    getInvitations(activeOrgId),
    getRoles(activeOrgId),
    getMemberCount(activeOrgId),
  ]);

  const pendingCount = invitations.filter((i) => i.status === "pending").length;
  const expiredCount = invitations.filter(
    (i) => i.status === "expired" || new Date(i.expiresAt) < new Date(),
  ).length;

  return (
    <InviteClient
      invitations={invitations}
      roles={roles}
      organizationId={activeOrgId}
      memberCount={memberCount}
      pendingCount={pendingCount}
      expiredCount={expiredCount}
    />
  );
}
