import { db } from "@/db";
import { member, organization } from "@/db/schema";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { and, eq, isNull } from "drizzle-orm";

// Other organizations sharing this one's owner where the caller may also
// perform `permission` — the ones a settings change can be applied to.
export async function siblingOrgs(orgId: string, userId: string, permission: string) {
  const [ownerRow] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .limit(1);
  if (!ownerRow) return [];
  const owned = await db
    .select({ id: member.organizationId, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, ownerRow.userId), eq(member.role, "owner"), isNull(member.deletedAt)));
  const others = owned.filter((o) => o.id !== orgId);
  const allowed: { id: string; name: string }[] = [];
  for (const o of others) {
    const perms = await getUserPermissions(userId, o.id);
    if (hasAccess(perms, permission)) allowed.push(o);
  }
  return allowed;
}
