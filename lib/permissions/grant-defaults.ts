import { db } from "@/db";
import { department, member, memberDepartment, userPermission, orgDefaultPermission } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { DEPT_ROLE_PERMISSIONS, ROLE_PERMISSIONS, type PermissionKey } from "./constants";

export async function grantDefaultPermissions(
  userId: string,
  memberId: string,
  organizationId: string,
  role: string,
  departmentId?: string | null,
  departmentRole?: string | null,
) {
  if (role === "owner") return;

  let permissions: PermissionKey[] = [];

  if (role === "stakeholder") {
    permissions = ROLE_PERMISSIONS["stakeholder"] ?? [];
  } else if (departmentId && departmentRole) {
    // Create member_department row for the first dept assignment
    const [dept] = await db
      .select({ name: department.name })
      .from(department)
      .where(and(eq(department.id, departmentId), eq(department.organizationId, organizationId)))
      .limit(1);

    if (dept) {
      // Insert member_department row
      await db
        .insert(memberDepartment)
        .values({
          id: nanoid(),
          memberId,
          organizationId,
          departmentId,
          role: departmentRole,
        })
        .onConflictDoNothing();

      permissions = DEPT_ROLE_PERMISSIONS[dept.name]?.[departmentRole as "manager" | "member"] ?? [];
    }
  }

  if (permissions.length === 0) return;

  await db
    .insert(userPermission)
    .values(
      permissions.map((key) => ({
        id: nanoid(),
        userId,
        organizationId,
        permissionKey: key,
        allowed: true,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Recomputes and replaces every department-role member's permissions for the
 * given org based on the current DEPT_ROLE_PERMISSIONS constants.
 * Safe to call after updating constants — owners and stakeholders are untouched.
 */
export async function resyncAllMemberPermissions(orgId: string): Promise<number> {
  // All dept assignments in this org
  const allAssignments = await db
    .select({ memberId: memberDepartment.memberId, role: memberDepartment.role, departmentId: memberDepartment.departmentId })
    .from(memberDepartment)
    .where(eq(memberDepartment.organizationId, orgId));

  if (allAssignments.length === 0) return 0;

  const deptIds = [...new Set(allAssignments.map((a) => a.departmentId))];
  const depts = await db.select({ id: department.id, name: department.name }).from(department).where(inArray(department.id, deptIds));
  const deptNameById = Object.fromEntries(depts.map((d) => [d.id, d.name]));

  const memberIds = [...new Set(allAssignments.map((a) => a.memberId))];
  // Only resync regular members (skip owners — they bypass permission checks entirely)
  const members = await db
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(and(inArray(member.id, memberIds), eq(member.organizationId, orgId)));
  const userIdByMemberId = Object.fromEntries(
    members.filter((m) => m.role !== "owner").map((m) => [m.id, m.userId]),
  );

  // Group assignments by memberId
  const byMember = new Map<string, typeof allAssignments>();
  for (const a of allAssignments) {
    if (!byMember.has(a.memberId)) byMember.set(a.memberId, []);
    byMember.get(a.memberId)!.push(a);
  }

  let synced = 0;
  for (const [memberId, assignments] of byMember) {
    const userId = userIdByMemberId[memberId];
    if (!userId) continue;

    const permSet = new Set<PermissionKey>();
    for (const a of assignments) {
      const name = deptNameById[a.departmentId];
      if (!name) continue;
      for (const p of DEPT_ROLE_PERMISSIONS[name]?.[a.role as "manager" | "member"] ?? []) {
        permSet.add(p);
      }
    }

    await db.delete(userPermission).where(and(eq(userPermission.userId, userId), eq(userPermission.organizationId, orgId)));
    if (permSet.size > 0) {
      await db.insert(userPermission).values(
        [...permSet].map((key) => ({ id: nanoid(), userId, organizationId: orgId, permissionKey: key, allowed: true })),
      ).onConflictDoNothing();
    }
    synced++;
  }
  return synced;
}

// Call this when a member is added to an additional department (after initial onboarding).
// Merges new permissions into their existing set.
export async function grantDepartmentPermissions(
  userId: string,
  memberId: string,
  organizationId: string,
  departmentId: string,
  deptRole: "manager" | "member",
) {
  const [dept] = await db
    .select({ name: department.name })
    .from(department)
    .where(and(eq(department.id, departmentId), eq(department.organizationId, organizationId)))
    .limit(1);

  if (!dept) throw new Error("Department not found");

  // Upsert member_department row
  await db
    .insert(memberDepartment)
    .values({ id: nanoid(), memberId, organizationId, departmentId, role: deptRole })
    .onConflictDoNothing();

  // Re-compute full permission set from all dept assignments
  const allAssignments = await db
    .select({ role: memberDepartment.role, departmentId: memberDepartment.departmentId })
    .from(memberDepartment)
    .where(and(eq(memberDepartment.memberId, memberId), eq(memberDepartment.organizationId, organizationId)));

  const deptIds = allAssignments.map((a) => a.departmentId);
  const depts = await db
    .select({ id: department.id, name: department.name })
    .from(department)
    .where(inArray(department.id, deptIds));

  const deptNameById = Object.fromEntries(depts.map((d) => [d.id, d.name]));

  const permSet = new Set<PermissionKey>();
  for (const a of allAssignments) {
    const name = deptNameById[a.departmentId];
    if (!name) continue;
    for (const p of DEPT_ROLE_PERMISSIONS[name]?.[a.role as "manager" | "member"] ?? []) {
      permSet.add(p);
    }
  }

  // Replace all user_permission rows for this user+org with the new union
  await db
    .delete(userPermission)
    .where(and(eq(userPermission.userId, userId), eq(userPermission.organizationId, organizationId)));

  if (permSet.size > 0) {
    await db
      .insert(userPermission)
      .values(
        [...permSet].map((key) => ({
          id: nanoid(),
          userId,
          organizationId,
          permissionKey: key,
          allowed: true,
        })),
      )
      .onConflictDoNothing();
  }
}

// Call this once, right after grantDefaultPermissions(), when a brand-new
// member accepts their invite. Grants whatever the org has configured as a
// default permission baseline (see /dashboard/admin/default-permissions),
// on top of whatever their department/role already gave them. No "zero
// explicit rows" edge case to worry about here — the member is new, so
// there's no prior fallback-derived access that could be lost.
export async function applyOrgDefaultPermissionsToMember(userId: string, organizationId: string): Promise<void> {
  const defaults = await db
    .select({ permissionKey: orgDefaultPermission.permissionKey })
    .from(orgDefaultPermission)
    .where(eq(orgDefaultPermission.organizationId, organizationId));

  if (defaults.length === 0) return;

  await db
    .insert(userPermission)
    .values(
      defaults.map((d) => ({
        id: nanoid(),
        userId,
        organizationId,
        permissionKey: d.permissionKey,
        allowed: true,
      })),
    )
    .onConflictDoUpdate({
      target: [userPermission.userId, userPermission.organizationId, userPermission.permissionKey],
      set: { allowed: true },
    });
}
