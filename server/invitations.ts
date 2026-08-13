"use server";

import { db } from "@/db";
import { invitation, member, user, pendingInvitation } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { notifyOwners } from "@/server/member-approvals";

export const getInvitations = async (organizationId: string) => {
  noStore();
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      departmentId: invitation.departmentId,
      departmentRole: invitation.departmentRole,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterName: user.name,
      inviterImage: user.image,
    })
    .from(invitation)
    .innerJoin(user, eq(invitation.inviterId, user.id))
    .where(eq(invitation.organizationId, organizationId));
};

export const getMemberCount = async (organizationId: string) => {
  const members = await db
    .select()
    .from(member)
    .where(eq(member.organizationId, organizationId));
  return members.length;
};

export const sendInvitations = async (
  organizationId: string,
  invites: {
    email: string;
    // "manager" | "member" | "stakeholder" (what the user picks in UI)
    role: string;
    departmentId?: string;
  }[],
) => {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  if (session.session.activeOrganizationId !== organizationId) throw new Error("Unauthorized");

  const perms = await getUserPermissions(session.user.id, organizationId);
  if (!hasAccess(perms, "member:invite")) throw new Error("You don't have permission to do this");

  const [me] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId), isNull(member.deletedAt)))
    .limit(1);
  const isOwner = me?.role === "owner";

  const results = [];

  for (const invite of invites) {
    try {
      if (!isOwner) {
        // Non-owners never get to create a real invitation directly — it
        // goes into the approval queue and no email is sent until the owner
        // approves it. See server/member-approvals.ts.
        await db.insert(pendingInvitation).values({
          id: nanoid(),
          organizationId,
          email: invite.email,
          role: invite.role,
          departmentId: invite.departmentId ?? null,
          requestedBy: session.user.id,
        });
        results.push({ email: invite.email, success: true, pending: true });
        continue;
      }

      // Map UI role → Better Auth role
      // BA only understands "owner" | "admin" | "member"; we use "member" for
      // both manager and member; stakeholder also maps to "member" in BA.
      const baRole = invite.role === "stakeholder" ? "member" : "member";

      const created = await auth.api.createInvitation({
        body: {
          email: invite.email,
          role: baRole as any,
          organizationId,
        },
        headers: await headers(),
      });

      // Store dept + actual UI role in our custom columns
      if (created?.id) {
        await db
          .update(invitation)
          .set({
            departmentId: invite.departmentId ?? null,
            // role in invitation stores the actual UI role for display
            departmentRole: invite.role === "stakeholder" ? null : (invite.role || null),
          })
          .where(eq(invitation.id, created.id));

        // Update the BA-created invitation role to reflect stakeholder vs member
        // We'll use the invitation.role field for display: store the UI role there
        await db
          .update(invitation)
          .set({ role: invite.role })
          .where(eq(invitation.id, created.id));
      }

      results.push({ email: invite.email, success: true, pending: false });
    } catch (e) {
      results.push({ email: invite.email, success: false, message: (e as Error).message });
    }
  }

  if (!isOwner && results.some((r) => r.success)) {
    await notifyOwners(organizationId, {
      type: "invitation:pending_approval",
      title: "New invitation awaiting approval",
      body: `${session.user.name} requested to invite ${invites.length} ${invites.length === 1 ? "person" : "people"}.`,
      link: "/dashboard/admin/member-approvals",
    });
  }

  return results;
};

export const revokeInvitation = async (invitationId: string) => {
  try {
    await auth.api.cancelInvitation({
      body: { invitationId },
      headers: await headers(),
    });
    return { success: true };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};

export const resendInvitation = async (
  organizationId: string,
  email: string,
  role: string,
  departmentId: string | null | undefined,
  departmentRole: string | null | undefined,
  oldInvitationId: string,
) => {
  try {
    await auth.api.cancelInvitation({
      body: { invitationId: oldInvitationId },
      headers: await headers(),
    });

    const created = await auth.api.createInvitation({
      body: { email, role: "member" as any, organizationId },
      headers: await headers(),
    });

    if (created?.id) {
      await db
        .update(invitation)
        .set({
          role,
          departmentId: departmentId ?? null,
          departmentRole: role === "stakeholder" ? null : (departmentRole ?? null),
        })
        .where(eq(invitation.id, created.id));
    }

    return { success: true };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};

export const getInvitationsAction = async (organizationId: string) => {
  noStore();
  return getInvitations(organizationId);
};
