"use server";

import { db } from "@/db";
import { member, user, userPermission, organization } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { APPROVAL_MODULES } from "@/lib/approvals/constants";

const ALL_APPROVAL_KEYS = APPROVAL_MODULES.flatMap(m => m.permissions.map(p => p.key));

/* =========================
   TYPES
========================= */

export type ApprovalMember = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  isOwner: boolean;
  permissions: Record<string, boolean>; // permKey → allowed
};

// A member of a sibling organization — one owned by the same person who
// owns the org whose approvals page is being viewed. Only relevant for
// ":centralized" keys, which are evaluated against the *grantee's own*
// active org at check time (see assertCanApprovePackingList), not the org
// whose page granted them — so `orgId`/`orgName` travel with each row and
// `permissions` reflects userPermission rows scoped to THAT org, not the
// viewer's.
export type CrossOrgApprovalMember = ApprovalMember & { orgId: string; orgName: string };

/* =========================
   HELPERS
========================= */

async function requireOwnerOrAdmin() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);

  if (!m || !["owner", "admin"].includes(m.role)) throw new Error("Only owners and admins can manage approvals");
  return { orgId, actorId: session.user.id };
}

// Other orgs owned by the same person who owns `orgId` — mirrors the
// getOwnerOrgIds pattern duplicated across server/*.ts (e.g.
// server/packing-list.ts), but excludes `orgId` itself since callers here
// want "the OTHER organizations this owner also owns", not the full set.
async function getSiblingOrgs(orgId: string): Promise<{ id: string; name: string }[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerMember) return [];

  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")));
  const siblingIds = [...new Set(owned.map(o => o.organizationId))].filter(id => id !== orgId);
  if (siblingIds.length === 0) return [];

  return db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, siblingIds));
}

// Cross-org grants are an owner-only concept — you're reaching into a
// permission table that belongs to a DIFFERENT org's member, something a
// same-org admin (who only has authority within their one org) shouldn't be
// able to do just because they happen to hold the centralized key
// themselves. Distinct from requireOwnerOrAdmin, which gates read access to
// the page in general.
async function requireActualOwner(orgId: string, actorId: string) {
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, actorId), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);
  if (!m || m.role !== "owner") throw new Error("Only the organization owner can assign cross-organization approval permissions");
}

// Nobody — including an admin with access to this page — can hand out an
// approval key they don't currently hold themselves. Same guard as
// server/permissions.ts and server/default-permissions.ts. Owners bypass
// via the "*" marker. Only checked on the grant path; revoking is a
// reduction in access, never an escalation.
async function assertCanGrant(actorId: string, orgId: string, key: string) {
  const perms = await getUserPermissions(actorId, orgId);
  if (perms.includes("*")) return;
  if (!perms.includes(key)) {
    throw new Error(`You cannot grant permissions you don't have yourself: ${key}`);
  }
}

/* =========================
   ACTIONS
========================= */

export async function getApprovalMembers(): Promise<ApprovalMember[]> {
  const { orgId } = await requireOwnerOrAdmin();

  const members = await db
    .select({ memberId: member.id, userId: member.userId, role: member.role, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt)));

  if (members.length === 0) return [];

  const userIds = members.map(m => m.userId);
  const perms = await db
    .select()
    .from(userPermission)
    .where(
      and(
        eq(userPermission.organizationId, orgId),
        inArray(userPermission.userId, userIds),
        inArray(userPermission.permissionKey, ALL_APPROVAL_KEYS as unknown as string[]),
      ),
    );

  const permMap: Record<string, Record<string, boolean>> = {};
  for (const p of perms) {
    if (!permMap[p.userId]) permMap[p.userId] = {};
    permMap[p.userId][p.permissionKey] = p.allowed;
  }

  // Owners never hold explicit userPermission rows for approval keys — the
  // "*" wildcard in getUserPermissions()/hasAccess() bypasses this whole
  // grant system at check-time (see lib/permissions/has-access.ts). They're
  // included here anyway, flagged via isOwner, so the UI can show them as an
  // always-on assignee per module instead of leaving that implicit — sorted
  // first since they apply to every module regardless of what's toggled.
  return members
    .sort((a, b) => {
      const ownerDiff = (b.role === "owner" ? 1 : 0) - (a.role === "owner" ? 1 : 0);
      return ownerDiff !== 0 ? ownerDiff : a.name.localeCompare(b.name);
    })
    .map(m => ({
      memberId: m.memberId,
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      isOwner: m.role === "owner",
      permissions: permMap[m.userId] ?? {},
    }));
}

// Members of every OTHER org the current org's owner also owns — the pool
// eligible for ":centralized" keys, which check the grantee's own active
// org rather than the org whose page granted them (see
// assertCanApprovePackingList in server/packing-list.ts). Empty for anyone
// who isn't that owner, so the UI can just render nothing rather than a
// permission error when a non-owner admin views the page.
export async function getCrossOrgApprovalMembers(): Promise<CrossOrgApprovalMember[]> {
  const { orgId, actorId } = await requireOwnerOrAdmin();

  const [actorMember] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, actorId), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);
  if (!actorMember || actorMember.role !== "owner") return [];

  const siblings = await getSiblingOrgs(orgId);
  if (siblings.length === 0) return [];
  const siblingIds = siblings.map(s => s.id);
  const orgNameById = Object.fromEntries(siblings.map(s => [s.id, s.name]));

  const members = await db
    .select({ memberId: member.id, userId: member.userId, organizationId: member.organizationId, role: member.role, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(inArray(member.organizationId, siblingIds), isNull(member.deletedAt)));
  if (members.length === 0) return [];

  const centralizedKeys = ALL_APPROVAL_KEYS.filter(k => k.endsWith(":centralized"));
  const userIds = [...new Set(members.map(m => m.userId))];
  const perms = await db
    .select()
    .from(userPermission)
    .where(
      and(
        inArray(userPermission.organizationId, siblingIds),
        inArray(userPermission.userId, userIds),
        inArray(userPermission.permissionKey, centralizedKeys as unknown as string[]),
      ),
    );

  const permMap: Record<string, Record<string, boolean>> = {}; // keyed by `${userId}:${organizationId}`
  for (const p of perms) {
    const key = `${p.userId}:${p.organizationId}`;
    if (!permMap[key]) permMap[key] = {};
    permMap[key][p.permissionKey] = p.allowed;
  }

  // Every sibling org has the same owner (that's what makes them siblings),
  // so their owner-role members are all just the current org's owner again
  // — already shown once via getApprovalMembers(). Drop them here so the UI
  // doesn't render duplicate "Owner" chips per sibling org.
  return members
    .filter(m => m.role !== "owner")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(m => ({
      memberId: m.memberId,
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      isOwner: false,
      orgId: m.organizationId,
      orgName: orgNameById[m.organizationId] ?? "",
      permissions: permMap[`${m.userId}:${m.organizationId}`] ?? {},
    }));
}

export async function setCrossOrgApprovalPermission(
  targetUserId: string,
  targetOrgId: string,
  permissionKey: string,
  allowed: boolean,
): Promise<void> {
  const { orgId, actorId } = await requireOwnerOrAdmin();
  await requireActualOwner(orgId, actorId);

  if (!permissionKey.endsWith(":centralized") || !ALL_APPROVAL_KEYS.includes(permissionKey as never)) {
    throw new Error("Invalid permission key");
  }

  const siblings = await getSiblingOrgs(orgId);
  if (!siblings.some(s => s.id === targetOrgId)) {
    throw new Error("That organization isn't one you own");
  }

  if (allowed) await assertCanGrant(actorId, orgId, permissionKey);

  await db
    .insert(userPermission)
    .values({ id: nanoid(), userId: targetUserId, organizationId: targetOrgId, permissionKey, allowed })
    .onConflictDoUpdate({
      target: [userPermission.userId, userPermission.organizationId, userPermission.permissionKey],
      set: { allowed },
    });

  revalidatePath("/dashboard/admin/approvals");
}

export async function setApprovalPermission(
  targetUserId: string,
  permissionKey: string,
  allowed: boolean,
): Promise<void> {
  const { orgId, actorId } = await requireOwnerOrAdmin();

  if (!ALL_APPROVAL_KEYS.includes(permissionKey as never)) throw new Error("Invalid permission key");
  if (allowed) await assertCanGrant(actorId, orgId, permissionKey);

  await db
    .insert(userPermission)
    .values({ id: nanoid(), userId: targetUserId, organizationId: orgId, permissionKey, allowed })
    .onConflictDoUpdate({
      target: [userPermission.userId, userPermission.organizationId, userPermission.permissionKey],
      set: { allowed },
    });

  revalidatePath("/dashboard/admin/approvals");
}
