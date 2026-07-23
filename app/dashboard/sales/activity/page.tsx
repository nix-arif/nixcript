import { requirePermission } from "@/lib/auth/require-permission";
import { getSalesActivities, getOrgMembers, getMemberRole } from "@/server/sales-activity";
import { ActivityClient } from "./activity-client";

export default async function SalesActivityPage() {
  const session = await requirePermission("customer:read");

  const [activities, members, role] = await Promise.all([
    getSalesActivities(),
    getOrgMembers(),
    getMemberRole(),
  ]);

  const canSeeAll = role === "owner" || role === "stakeholder";

  return (
    <ActivityClient
      initialActivities={activities}
      members={members}
      currentUserId={session.user.id}
      canSeeAll={canSeeAll}
    />
  );
}
