"use server";

import { db } from "@/db";
import { member, user, userPermission } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

/* =========================
   APPROVAL MODULE CONFIG
========================= */

export const APPROVAL_MODULES = [
  {
    id: "leave",
    title: "Leave Management",
    description: "Who can approve or reject leave applications and configure leave types.",
    permissions: [
      { key: "leave:approve", label: "Approve / Reject Leave" },
      { key: "leave:manage",  label: "Manage Leave Types" },
    ],
  },
  {
    id: "claim",
    title: "Claim Management",
    description: "Who can approve or reject expense claims and configure claim types & rates.",
    permissions: [
      { key: "claim:approve", label: "Approve / Reject Claims" },
      { key: "claim:manage",  label: "Manage Claim Types & Rates" },
    ],
  },
  {
    id: "payroll",
    title: "Payroll",
    description: "Who can approve payroll periods and publish payslips to employees.",
    permissions: [
      { key: "payslip:approve", label: "Approve Payroll Period" },
      { key: "payslip:publish", label: "Publish Payslips" },
    ],
  },
  {
    id: "sales",
    title: "Sales Orders",
    description: "Who can approve, reject or recall sales orders.",
    permissions: [
      { key: "sales-order:approve", label: "Approve Sales Order" },
      { key: "sales-order:reject",  label: "Reject Sales Order" },
      { key: "sales-order:recall",  label: "Recall Sales Order" },
    ],
  },
] as const;

export type ApprovalModule = typeof APPROVAL_MODULES[number];

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
  permissions: Record<string, boolean>; // permKey → allowed
};

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

  return members
    .filter(m => m.role !== "owner")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(m => ({
      memberId: m.memberId,
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      permissions: permMap[m.userId] ?? {},
    }));
}

export async function setApprovalPermission(
  targetUserId: string,
  permissionKey: string,
  allowed: boolean,
): Promise<void> {
  const { orgId } = await requireOwnerOrAdmin();

  if (!ALL_APPROVAL_KEYS.includes(permissionKey as never)) throw new Error("Invalid permission key");

  await db
    .insert(userPermission)
    .values({ id: nanoid(), userId: targetUserId, organizationId: orgId, permissionKey, allowed })
    .onConflictDoUpdate({
      target: [userPermission.userId, userPermission.organizationId, userPermission.permissionKey],
      set: { allowed },
    });

  revalidatePath("/dashboard/organization/approvals");
}
