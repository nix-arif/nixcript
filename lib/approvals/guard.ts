import { isSelfActionAllowed } from "@/server/approval-settings";

// The one shared self-action check for every checker/approver-gated
// mutation — replaces the ad-hoc inline `if (x.userId === userId) throw ...`
// that used to be duplicated per workflow. No-ops when the acting user
// isn't the record's owner; otherwise defers to the org's configured
// setting for this permission key (see lib/approvals/constants.ts's
// DEFAULT_SELF_ACTION_ALLOWED for the fallback when no override exists).
export async function assertSelfActionAllowed(
  orgId: string,
  permissionKey: string,
  recordOwnerUserId: string,
  actingUserId: string,
  actionLabel: string,
): Promise<void> {
  if (recordOwnerUserId !== actingUserId) return;
  if (await isSelfActionAllowed(orgId, permissionKey)) return;
  throw new Error(`You cannot ${actionLabel} your own submission`);
}
