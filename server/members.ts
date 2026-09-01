"use server";

import { db } from "@/db";
import { department, member, memberDepartment, user, userPermission, pendingDepartmentAssignment, profile } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { and, asc, eq, isNull, isNotNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { grantDepartmentPermissions, resyncAllMemberPermissions } from "@/lib/permissions/grant-defaults";
import { nanoid } from "nanoid";
import { notifyOwners } from "@/server/member-approvals";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId: session.user.id };
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getOrgMembers() {
  const { orgId } = await requireAccess("member:read");

  const members = await db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
      hireDate: member.hireDate,
      noticeDate: member.noticeDate,
      leaveBlockedOnNotice: member.leaveBlockedOnNotice,
      employmentStatus: profile.employmentStatus,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(profile, eq(profile.userId, member.userId))
    .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .orderBy(asc(member.createdAt));

  // Fetch all dept assignments for this org in one query
  const assignments = await db
    .select({
      memberId: memberDepartment.memberId,
      deptRole: memberDepartment.role,
      departmentId: memberDepartment.departmentId,
      departmentName: department.name,
    })
    .from(memberDepartment)
    .innerJoin(department, eq(memberDepartment.departmentId, department.id))
    .where(eq(memberDepartment.organizationId, orgId));

  // Group assignments by memberId
  const assignmentsByMember: Record<string, typeof assignments> = {};
  for (const a of assignments) {
    if (!assignmentsByMember[a.memberId]) assignmentsByMember[a.memberId] = [];
    assignmentsByMember[a.memberId].push(a);
  }

  return members.map((m) => ({
    ...m,
    departments: assignmentsByMember[m.memberId] ?? [],
  }));
}

export type OrgMember = Awaited<ReturnType<typeof getOrgMembers>>[number];

// ── Deleted members ────────────────────────────────────────────────────────

export async function getDeletedMembers() {
  const { orgId } = await requireAccess("member:read");

  const deleter = alias(user, "deleter");

  const members = await db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
      deletedAt: member.deletedAt,
      deletedBy: member.deletedBy,
      deletedByName: deleter.name,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(deleter, eq(member.deletedBy, deleter.id))
    .where(and(eq(member.organizationId, orgId), isNotNull(member.deletedAt)))
    .orderBy(asc(member.createdAt));

  // Fetch dept assignments for deleted members (kept for restore)
  const memberIds = members.map((m) => m.memberId);
  if (memberIds.length === 0) return members.map((m) => ({ ...m, departments: [] }));

  const assignments = await db
    .select({
      memberId: memberDepartment.memberId,
      deptRole: memberDepartment.role,
      departmentId: memberDepartment.departmentId,
      departmentName: department.name,
    })
    .from(memberDepartment)
    .innerJoin(department, eq(memberDepartment.departmentId, department.id))
    .where(and(eq(memberDepartment.organizationId, orgId), inArray(memberDepartment.memberId, memberIds)));

  const assignmentsByMember: Record<string, typeof assignments> = {};
  for (const a of assignments) {
    if (!assignmentsByMember[a.memberId]) assignmentsByMember[a.memberId] = [];
    assignmentsByMember[a.memberId].push(a);
  }

  return members.map((m) => ({
    ...m,
    departments: assignmentsByMember[m.memberId] ?? [],
  }));
}

export type DeletedMember = Awaited<ReturnType<typeof getDeletedMembers>>[number];

// ── Member dept management ─────────────────────────────────────────────────

export async function addMemberToDepartment(
  memberId: string,
  departmentId: string,
  deptRole: "manager" | "member",
): Promise<{ pending: boolean }> {
  const { orgId, userId } = await requireAccess("member:invite");

  const [m] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);

  if (!m) throw new Error("Member not found");

  const [me] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);

  if (me?.role !== "owner") {
    // Assigning a department+role can hand out a large permission bundle
    // (see DEPT_ROLE_PERMISSIONS) — only the owner can approve that, same as
    // invitations. See server/member-approvals.ts.
    await db.insert(pendingDepartmentAssignment).values({
      id: nanoid(),
      organizationId: orgId,
      memberId,
      departmentId,
      departmentRole: deptRole,
      requestedBy: userId,
    });

    await notifyOwners(orgId, {
      type: "department-assignment:pending_approval",
      title: "New department assignment awaiting approval",
      body: "A request to assign a member to a department needs your approval.",
      link: "/dashboard/admin/member-approvals",
    });

    revalidatePath("/dashboard/organization/members");
    return { pending: true };
  }

  await grantDepartmentPermissions(m.userId, memberId, orgId, departmentId, deptRole);

  revalidatePath("/dashboard/organization/members");
  return { pending: false };
}

export async function removeMemberFromDepartment(memberId: string, departmentId: string) {
  const { orgId } = await requireAccess("member:invite");

  await db
    .delete(memberDepartment)
    .where(
      and(
        eq(memberDepartment.memberId, memberId),
        eq(memberDepartment.departmentId, departmentId),
        eq(memberDepartment.organizationId, orgId),
      ),
    );

  // Recompute permissions without this dept
  const [m] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1);

  if (m) {
    // Re-derive from remaining assignments
    const remaining = await db
      .select({ role: memberDepartment.role, deptName: department.name })
      .from(memberDepartment)
      .innerJoin(department, eq(memberDepartment.departmentId, department.id))
      .where(and(eq(memberDepartment.memberId, memberId), eq(memberDepartment.organizationId, orgId)));

    const { DEPT_ROLE_PERMISSIONS } = await import("@/lib/permissions/constants");
    const permSet = new Set<string>();
    for (const a of remaining) {
      for (const p of DEPT_ROLE_PERMISSIONS[a.deptName]?.[a.role as "manager" | "member"] ?? []) {
        permSet.add(p);
      }
    }

    await db
      .delete(userPermission)
      .where(and(eq(userPermission.userId, m.userId), eq(userPermission.organizationId, orgId)));

    if (permSet.size > 0) {
      await db
        .insert(userPermission)
        .values(
          [...permSet].map((key) => ({
            id: nanoid(),
            userId: m.userId,
            organizationId: orgId,
            permissionKey: key,
            allowed: true,
          })),
        )
        .onConflictDoNothing();
    }
  }

  revalidatePath("/dashboard/organization/members");
}

// ── Soft-delete member ─────────────────────────────────────────────────────

export async function removeMember(memberId: string) {
  const { orgId, userId: actorId } = await requireAccess("member:remove");

  const [m] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);

  if (!m) throw new Error("Member not found");
  if (m.role === "owner") throw new Error("Cannot remove the organization owner");
  if (m.userId === actorId) throw new Error("You cannot remove yourself from the organization");

  // Clear all permissions — they lose access immediately
  await db
    .delete(userPermission)
    .where(and(eq(userPermission.userId, m.userId), eq(userPermission.organizationId, orgId)));

  // Soft-delete: stamp deletedAt + who deleted
  await db
    .update(member)
    .set({ deletedAt: new Date(), deletedBy: actorId })
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)));

  revalidatePath("/dashboard/organization/members");
}

// ── Restore deleted member ─────────────────────────────────────────────────

export async function restoreMember(memberId: string) {
  const { orgId } = await requireAccess("member:invite");

  const [m] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId), isNotNull(member.deletedAt)))
    .limit(1);

  if (!m) throw new Error("Deleted member not found");

  // Restore the member row
  await db
    .update(member)
    .set({ deletedAt: null, deletedBy: null })
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)));

  // Re-derive permissions from their existing dept assignments
  const assignments = await db
    .select({ role: memberDepartment.role, deptName: department.name, deptId: memberDepartment.departmentId })
    .from(memberDepartment)
    .innerJoin(department, eq(memberDepartment.departmentId, department.id))
    .where(and(eq(memberDepartment.memberId, memberId), eq(memberDepartment.organizationId, orgId)));

  if (assignments.length > 0) {
    const { DEPT_ROLE_PERMISSIONS } = await import("@/lib/permissions/constants");
    const permSet = new Set<string>();
    for (const a of assignments) {
      for (const p of DEPT_ROLE_PERMISSIONS[a.deptName]?.[a.role as "manager" | "member"] ?? []) {
        permSet.add(p);
      }
    }

    if (permSet.size > 0) {
      await db
        .insert(userPermission)
        .values(
          [...permSet].map((key) => ({
            id: nanoid(),
            userId: m.userId,
            organizationId: orgId,
            permissionKey: key,
            allowed: true,
          })),
        )
        .onConflictDoNothing();
    }
  }

  revalidatePath("/dashboard/organization/members");
}

// ── Permanent delete (hard delete) ────────────────────────────────────────

export async function permanentlyDeleteMember(memberId: string) {
  const { orgId } = await requireAccess("member:remove");

  const [m] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId), isNotNull(member.deletedAt)))
    .limit(1);

  if (!m) throw new Error("Deleted member not found");
  if (m.role === "owner") throw new Error("Cannot permanently delete the owner");

  // Remove all dept assignments
  await db
    .delete(memberDepartment)
    .where(and(eq(memberDepartment.memberId, memberId), eq(memberDepartment.organizationId, orgId)));

  // Remove all permissions
  await db
    .delete(userPermission)
    .where(and(eq(userPermission.userId, m.userId), eq(userPermission.organizationId, orgId)));

  // Hard delete the member row
  await db
    .delete(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)));

  revalidatePath("/dashboard/organization/members");
}

export async function resyncOrgPermissions(): Promise<number> {
  const { orgId } = await requireAccess("member:invite");
  const count = await resyncAllMemberPermissions(orgId);
  revalidatePath("/dashboard/organization/members");
  revalidatePath("/dashboard/organization/departments");
  return count;
}
