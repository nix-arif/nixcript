// Who may use Intercompany Purchasing (supplier handling, pricing between organizations, price list).
// The owner always can. Others need "intercompany:read" to view, "intercompany:manage" to change (manage includes view).
// The data covers every organization of the active organization's owner.
import { getSession } from "@/lib/auth/require-access";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";

export const INTERCOMPANY_READ = "intercompany:read";
export const INTERCOMPANY_MANAGE = "intercompany:manage";

export const canViewIntercompany = (perms: string[]) => hasAccess(perms, INTERCOMPANY_READ) || hasAccess(perms, INTERCOMPANY_MANAGE);

export async function requireIntercompany(level: "read" | "manage") {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  const canManage = hasAccess(perms, INTERCOMPANY_MANAGE);
  if (!(level === "manage" ? canManage : canViewIntercompany(perms))) throw new Error("You don't have permission to do this");
  return { session, orgId, userId, canManage, ownerOrgIds: await getOwnerOrgIds(orgId) };
}
