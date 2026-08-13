"use server";

import { db } from "@/db";
import { notification, member, memberDepartment, department, user, userPermission } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// ── Auth ───────────────────────────────────────────────────────────────────

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

// ── Internal: create a notification for a user ─────────────────────────────

export async function createNotification(params: {
  organizationId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}) {
  await db.insert(notification).values({
    id: nanoid(),
    organizationId: params.organizationId,
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link ?? null,
    isRead: 0,
  });
}

// ── Internal: find users who can approve SOs in an org ─────────────────────
// Owners always can. Managers of sales/management departments also can.

export async function getSoApprovers(organizationId: string): Promise<string[]> {
  // 1. Owners
  const owners = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, "owner")));

  // 2. Managers of sales or management departments
  const depts = await db
    .select({ id: department.id })
    .from(department)
    .where(and(
      eq(department.organizationId, organizationId),
      inArray(department.name, ["sales", "management"]),
    ));

  const deptIds = depts.map((d) => d.id);
  let managerUserIds: string[] = [];

  if (deptIds.length > 0) {
    const managers = await db
      .select({ userId: member.userId })
      .from(member)
      .innerJoin(
        memberDepartment,
        and(
          eq(memberDepartment.memberId, member.id),
          eq(memberDepartment.organizationId, organizationId),
          eq(memberDepartment.role, "manager"),
          inArray(memberDepartment.departmentId, deptIds),
        ),
      )
      .where(eq(member.organizationId, organizationId));

    managerUserIds = managers.map((m) => m.userId);
  }

  const all = [...new Set([...owners.map((o) => o.userId), ...managerUserIds])];
  return all;
}

// ── Internal: find users who can approve POs in an org ─────────────────────
// Owners always can. Managers of procurement/management departments also can.

export async function getPoApprovers(organizationId: string): Promise<string[]> {
  const owners = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, "owner")));

  const depts = await db
    .select({ id: department.id })
    .from(department)
    .where(and(
      eq(department.organizationId, organizationId),
      inArray(department.name, ["management", "logistic"]),
    ));

  const deptIds = depts.map((d) => d.id);
  let managerUserIds: string[] = [];

  if (deptIds.length > 0) {
    const managers = await db
      .select({ userId: member.userId })
      .from(member)
      .innerJoin(
        memberDepartment,
        and(
          eq(memberDepartment.memberId, member.id),
          eq(memberDepartment.organizationId, organizationId),
          eq(memberDepartment.role, "manager"),
          inArray(memberDepartment.departmentId, deptIds),
        ),
      )
      .where(eq(member.organizationId, organizationId));

    managerUserIds = managers.map((m) => m.userId);
  }

  return [...new Set([...owners.map((o) => o.userId), ...managerUserIds])];
}

// ── Notify every user holding a given permission key (e.g. eligible
// approvers of a submitted workflow) ────────────────────────────────────────
// Returns whether anyone was notified, so callers can fall back to a
// different key if no one currently holds this one (e.g. claim checking
// falling back to claim:approve when no checkers are assigned).

export async function notifyUsersWithPermission(
  orgId: string,
  permKey: string,
  notifData: { type: string; title: string; body: string; link: string },
): Promise<boolean> {
  const approvers = await db
    .select({ userId: userPermission.userId })
    .from(userPermission)
    .where(
      and(
        eq(userPermission.organizationId, orgId),
        eq(userPermission.permissionKey, permKey),
        eq(userPermission.allowed, true),
      ),
    );
  if (approvers.length === 0) return false;
  const notifs = approvers.map((a) => ({
    id: nanoid(),
    organizationId: orgId,
    userId: a.userId,
    ...notifData,
    isRead: 0,
    createdAt: new Date(),
  }));
  await db.insert(notification).values(notifs);
  return true;
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getNotifications() {
  const { userId, orgId } = await getSession();

  return db
    .select()
    .from(notification)
    .where(and(eq(notification.userId, userId), eq(notification.organizationId, orgId)))
    .orderBy(desc(notification.createdAt))
    .limit(50);
}

export async function getUnreadNotificationCount(): Promise<number> {
  const { userId, orgId } = await getSession();

  const rows = await db
    .select({ id: notification.id })
    .from(notification)
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.organizationId, orgId),
        eq(notification.isRead, 0),
      ),
    );

  return rows.length;
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function markNotificationRead(id: string) {
  const { userId } = await getSession();

  await db
    .update(notification)
    .set({ isRead: 1 })
    .where(and(eq(notification.id, id), eq(notification.userId, userId)));
}

export async function markAllNotificationsRead() {
  const { userId, orgId } = await getSession();

  await db
    .update(notification)
    .set({ isRead: 1 })
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.organizationId, orgId),
        eq(notification.isRead, 0),
      ),
    );

  revalidatePath("/dashboard");
}
