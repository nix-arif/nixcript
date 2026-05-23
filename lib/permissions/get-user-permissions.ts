import { cache } from "react";
import { db } from "@/db";
import { department, member, memberDepartment, userPermission } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { DEPT_ROLE_PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions/constants";

const OWNER_ALL_PERMISSIONS = "*";

export const getUserPermissions = cache(async function getUserPermissions(
  userId: string,
  organizationId: string,
): Promise<string[]> {
  // 1. Direct membership check
  const [memberData] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);

  if (memberData) {
    if (memberData.role === "owner") return [OWNER_ALL_PERMISSIONS];
    return resolvePermissions(userId, memberData.id, organizationId, memberData.role);
  }

  // 2. No direct membership — sibling org fallback.
  const [ownerMembership] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, "owner")))
    .limit(1);

  if (!ownerMembership) return [];

  const siblingOrgIds = (
    await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, ownerMembership.userId), eq(member.role, "owner")))
  ).map((r) => r.organizationId);

  if (siblingOrgIds.length === 0) return [];

  const [siblingMembership] = await db
    .select({ id: member.id, role: member.role, organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), inArray(member.organizationId, siblingOrgIds)))
    .limit(1);

  if (!siblingMembership) return [];
  if (siblingMembership.role === "owner") return [OWNER_ALL_PERMISSIONS];

  return resolvePermissions(userId, siblingMembership.id, siblingMembership.organizationId, siblingMembership.role);
});

async function resolvePermissions(
  userId: string,
  memberId: string,
  organizationId: string,
  role: string,
): Promise<string[]> {
  // Explicit user_permission rows take precedence if they exist
  const allRows = await db
    .select({ permissionKey: userPermission.permissionKey, allowed: userPermission.allowed })
    .from(userPermission)
    .where(and(eq(userPermission.userId, userId), eq(userPermission.organizationId, organizationId)));

  if (allRows.length > 0) {
    return allRows.filter((r) => r.allowed).map((r) => r.permissionKey);
  }

  // Stakeholder: flat read-only permission set
  if (role === "stakeholder") {
    return [...(ROLE_PERMISSIONS["stakeholder"] ?? [])];
  }

  // For regular members: union permissions from ALL their department assignments
  const deptAssignments = await db
    .select({ role: memberDepartment.role, departmentId: memberDepartment.departmentId })
    .from(memberDepartment)
    .where(and(eq(memberDepartment.memberId, memberId), eq(memberDepartment.organizationId, organizationId)));

  if (deptAssignments.length === 0) return [];

  const deptIds = deptAssignments.map((a) => a.departmentId);
  const depts = await db
    .select({ id: department.id, name: department.name })
    .from(department)
    .where(inArray(department.id, deptIds));

  const deptNameById = Object.fromEntries(depts.map((d) => [d.id, d.name]));

  // Union all permissions from all dept+role pairs
  const permSet = new Set<string>();
  for (const assignment of deptAssignments) {
    const deptName = deptNameById[assignment.departmentId];
    if (!deptName) continue;
    const perms = DEPT_ROLE_PERMISSIONS[deptName]?.[assignment.role as "manager" | "member"] ?? [];
    for (const p of perms) permSet.add(p);
  }

  return [...permSet];
}
