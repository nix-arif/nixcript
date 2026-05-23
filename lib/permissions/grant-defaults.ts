import { db } from "@/db";
import { department, memberDepartment, userPermission } from "@/db/schema";
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
