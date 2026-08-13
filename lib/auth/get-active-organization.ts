import { db } from "@/db";
import { member, organization, session } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";

// Deliberately not a "use server" export — this runs inside Better Auth's
// session.create.before hook, before any session (and therefore any
// getCachedSession()) exists yet, so it can't carry its own auth check.
// Keeping it out of the server actions layer means it's plain internal
// plumbing rather than a client-invokable RPC endpoint that happens to
// trust a caller-supplied userId.
export async function getActiveOrganization(userId: string) {
  // Use the most recently active org from existing sessions so new logins
  // inherit the org the user was last working in.
  const lastSession = await db
    .select({ activeOrganizationId: session.activeOrganizationId })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(desc(session.updatedAt))
    .limit(1)
    .then((res) => res[0]);

  if (lastSession?.activeOrganizationId) {
    const stillMember = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(
        and(
          eq(member.userId, userId),
          eq(member.organizationId, lastSession.activeOrganizationId),
        ),
      )
      .limit(1)
      .then((res) => res[0]);

    if (stillMember) {
      const org = await db
        .select()
        .from(organization)
        .where(eq(organization.id, lastSession.activeOrganizationId))
        .limit(1)
        .then((res) => res[0]);
      if (org) return org;
    }
  }

  // Fallback: first org the user joined
  const memberUser = await db
    .select()
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)
    .then((res) => res[0]);

  if (!memberUser) return null;

  return await db
    .select()
    .from(organization)
    .where(eq(organization.id, memberUser.organizationId))
    .limit(1)
    .then((res) => res[0]);
}
