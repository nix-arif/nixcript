"use server";

import { db } from "@/db";
import { invitation, member, user } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";

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
  const results = [];

  for (const invite of invites) {
    try {
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

      results.push({ email: invite.email, success: true });
    } catch (e) {
      results.push({ email: invite.email, success: false, message: (e as Error).message });
    }
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
