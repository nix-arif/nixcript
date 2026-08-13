"use server";

import { db } from "@/db";
import {
  pendingInvitation,
  pendingDepartmentAssignment,
  member,
  user,
  department,
  invitation,
  notification,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { and, eq, isNull, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { grantDepartmentPermissions } from "@/lib/permissions/grant-defaults";

// Strictly owner — not owner-or-admin. Requests here can hand out
// department-manager-level access (member:invite, member:remove,
// organization-role:*, account:*, ...), so approval isn't delegable the way
// other admin actions in this app are.
async function requireOwner() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);

  if (!m || m.role !== "owner") throw new Error("Only the organization owner can do this");
  return { orgId, userId: session.user.id };
}

async function notifyOwners(orgId: string, notifData: { type: string; title: string; body: string; link: string }) {
  const owners = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt)));
  if (owners.length === 0) return;
  await db.insert(notification).values(
    owners.map((o) => ({
      id: nanoid(),
      organizationId: orgId,
      userId: o.userId,
      ...notifData,
      isRead: 0,
      createdAt: new Date(),
    })),
  );
}

async function notifyRequester(orgId: string, requesterId: string, notifData: { type: string; title: string; body: string; link: string }) {
  await db.insert(notification).values({
    id: nanoid(),
    organizationId: orgId,
    userId: requesterId,
    ...notifData,
    isRead: 0,
    createdAt: new Date(),
  });
}

// ── Queries ──────────────────────────────────────────────────────────────

export async function getPendingInvitations() {
  const { orgId } = await requireOwner();
  return db
    .select({
      id: pendingInvitation.id,
      email: pendingInvitation.email,
      role: pendingInvitation.role,
      departmentId: pendingInvitation.departmentId,
      departmentName: department.name,
      requestedByName: user.name,
      requestedByEmail: user.email,
      status: pendingInvitation.status,
      createdAt: pendingInvitation.createdAt,
    })
    .from(pendingInvitation)
    .innerJoin(user, eq(pendingInvitation.requestedBy, user.id))
    .leftJoin(department, eq(pendingInvitation.departmentId, department.id))
    .where(and(eq(pendingInvitation.organizationId, orgId), eq(pendingInvitation.status, "PENDING")))
    .orderBy(desc(pendingInvitation.createdAt));
}

export async function getPendingDepartmentAssignments() {
  const { orgId } = await requireOwner();
  const requester = alias(user, "requester");
  return db
    .select({
      id: pendingDepartmentAssignment.id,
      memberName: user.name,
      memberEmail: user.email,
      departmentId: pendingDepartmentAssignment.departmentId,
      departmentName: department.name,
      departmentRole: pendingDepartmentAssignment.departmentRole,
      requestedByName: requester.name,
      status: pendingDepartmentAssignment.status,
      createdAt: pendingDepartmentAssignment.createdAt,
    })
    .from(pendingDepartmentAssignment)
    .innerJoin(member, eq(pendingDepartmentAssignment.memberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(department, eq(pendingDepartmentAssignment.departmentId, department.id))
    .innerJoin(requester, eq(pendingDepartmentAssignment.requestedBy, requester.id))
    .where(and(eq(pendingDepartmentAssignment.organizationId, orgId), eq(pendingDepartmentAssignment.status, "PENDING")))
    .orderBy(desc(pendingDepartmentAssignment.createdAt));
}

// ── Invitation approval ─────────────────────────────────────────────────

export async function approvePendingInvitation(id: string): Promise<void> {
  const { orgId, userId } = await requireOwner();

  const [req] = await db
    .select()
    .from(pendingInvitation)
    .where(and(eq(pendingInvitation.id, id), eq(pendingInvitation.organizationId, orgId)))
    .limit(1);
  if (!req) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("This request has already been reviewed");

  const created = await auth.api.createInvitation({
    body: { email: req.email, role: "member" as never, organizationId: orgId },
    headers: await headers(),
  });

  if (created?.id) {
    await db
      .update(invitation)
      .set({
        role: req.role,
        departmentId: req.departmentId,
        departmentRole: req.role === "stakeholder" ? null : req.role,
      })
      .where(eq(invitation.id, created.id));
  }

  await db
    .update(pendingInvitation)
    .set({ status: "APPROVED", reviewedBy: userId, reviewedAt: new Date() })
    .where(eq(pendingInvitation.id, id));

  await notifyRequester(orgId, req.requestedBy, {
    type: "invitation:approved",
    title: "Invitation approved",
    body: `Your invitation for ${req.email} was approved and has been sent.`,
    link: "/dashboard/organization/invite",
  });

  revalidatePath("/dashboard/admin/member-approvals");
  revalidatePath("/dashboard/organization/invite");
}

export async function rejectPendingInvitation(id: string, reason?: string): Promise<void> {
  const { orgId, userId } = await requireOwner();

  const [req] = await db
    .select()
    .from(pendingInvitation)
    .where(and(eq(pendingInvitation.id, id), eq(pendingInvitation.organizationId, orgId)))
    .limit(1);
  if (!req) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("This request has already been reviewed");

  await db
    .update(pendingInvitation)
    .set({ status: "REJECTED", reviewedBy: userId, reviewedAt: new Date(), reviewComment: reason?.trim() || null })
    .where(eq(pendingInvitation.id, id));

  await notifyRequester(orgId, req.requestedBy, {
    type: "invitation:rejected",
    title: "Invitation rejected",
    body: `Your invitation request for ${req.email} was rejected${reason ? `: ${reason}` : "."}`,
    link: "/dashboard/organization/invite",
  });

  revalidatePath("/dashboard/admin/member-approvals");
}

// ── Department assignment approval ──────────────────────────────────────

export async function approvePendingDepartmentAssignment(id: string): Promise<void> {
  const { orgId, userId } = await requireOwner();

  const [req] = await db
    .select()
    .from(pendingDepartmentAssignment)
    .where(and(eq(pendingDepartmentAssignment.id, id), eq(pendingDepartmentAssignment.organizationId, orgId)))
    .limit(1);
  if (!req) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("This request has already been reviewed");

  const [m] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.id, req.memberId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!m) throw new Error("Member not found");

  await grantDepartmentPermissions(m.userId, req.memberId, orgId, req.departmentId, req.departmentRole as "manager" | "member");

  await db
    .update(pendingDepartmentAssignment)
    .set({ status: "APPROVED", reviewedBy: userId, reviewedAt: new Date() })
    .where(eq(pendingDepartmentAssignment.id, id));

  await notifyRequester(orgId, req.requestedBy, {
    type: "department-assignment:approved",
    title: "Department assignment approved",
    body: "Your department assignment request was approved.",
    link: "/dashboard/organization/members",
  });

  revalidatePath("/dashboard/admin/member-approvals");
  revalidatePath("/dashboard/organization/members");
}

export async function rejectPendingDepartmentAssignment(id: string, reason?: string): Promise<void> {
  const { orgId, userId } = await requireOwner();

  const [req] = await db
    .select()
    .from(pendingDepartmentAssignment)
    .where(and(eq(pendingDepartmentAssignment.id, id), eq(pendingDepartmentAssignment.organizationId, orgId)))
    .limit(1);
  if (!req) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("This request has already been reviewed");

  await db
    .update(pendingDepartmentAssignment)
    .set({ status: "REJECTED", reviewedBy: userId, reviewedAt: new Date(), reviewComment: reason?.trim() || null })
    .where(eq(pendingDepartmentAssignment.id, id));

  await notifyRequester(orgId, req.requestedBy, {
    type: "department-assignment:rejected",
    title: "Department assignment rejected",
    body: `Your department assignment request was rejected${reason ? `: ${reason}` : "."}`,
    link: "/dashboard/organization/members",
  });

  revalidatePath("/dashboard/admin/member-approvals");
}

export { notifyOwners };
