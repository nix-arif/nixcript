"use server";

import { db } from "@/db";
import { department, member, memberDepartment, user, userPermission } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { grantDepartmentPermissions } from "@/lib/permissions/grant-defaults";
import { nanoid } from "nanoid";

async function getActiveOrgId() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return orgId;
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getOrgMembers() {
  const orgId = await getActiveOrgId();

  const members = await db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId));

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

// ── Member dept management ─────────────────────────────────────────────────

export async function addMemberToDepartment(
  memberId: string,
  departmentId: string,
  deptRole: "manager" | "member",
) {
  const orgId = await getActiveOrgId();

  const [m] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1);

  if (!m) throw new Error("Member not found");

  await grantDepartmentPermissions(m.userId, memberId, orgId, departmentId, deptRole);

  revalidatePath("/dashboard/organization/members");
}

export async function removeMemberFromDepartment(memberId: string, departmentId: string) {
  const orgId = await getActiveOrgId();

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

// ── Remove member entirely ─────────────────────────────────────────────────

export async function removeMember(memberId: string) {
  const orgId = await getActiveOrgId();

  const [m] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1);

  if (!m) throw new Error("Member not found");
  if (m.role === "owner") throw new Error("Cannot remove the organization owner");

  await db
    .delete(userPermission)
    .where(and(eq(userPermission.userId, m.userId), eq(userPermission.organizationId, orgId)));

  await db
    .delete(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)));

  revalidatePath("/dashboard/organization/members");
}
