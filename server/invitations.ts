"use server";

import { db } from "@/db";
import { invitation, member, user, organization } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { grantDefaultPermissions } from "@/lib/permissions/grant-defaults";
import { unstable_noStore as noStore } from "next/cache";

export const getInvitations = async (organizationId: string) => {
  noStore();
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterName: user.name,
      inviterImage: user.image,
    })
    .from(invitation)
    .innerJoin(user, eq(invitation.inviterId, user.id))
    .where(eq(invitation.organizationId, organizationId));

  return rows;
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
  invites: { email: string; role: string }[],
) => {
  const results = [];

  for (const invite of invites) {
    try {
      await auth.api.createInvitation({
        body: {
          email: invite.email,
          role: invite.role as any,
          organizationId,
        },
        headers: await headers(),
      });
      results.push({ email: invite.email, success: true });
    } catch (e) {
      results.push({
        email: invite.email,
        success: false,
        message: (e as Error).message,
      });
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
  oldInvitationId: string,
) => {
  try {
    // Cancel old one first
    await auth.api.cancelInvitation({
      body: { invitationId: oldInvitationId },
      headers: await headers(),
    });

    // Send fresh invite
    await auth.api.createInvitation({
      body: { email, role, organizationId },
      headers: await headers(),
    });

    return { success: true };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
};

export const getInvitationsAction = async (organizationId: string) => {
  noStore();
  return await getInvitations(organizationId);
};
