import { auth } from "@/lib/auth";
import { db } from "@/db";
import { invitation, member } from "@/db/schema";
import { eq } from "drizzle-orm";
import { grantDefaultPermissions } from "@/lib/permissions/grant-defaults";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  const { invitationId } = await params;

  try {
    // 1. Fetch invitation before accepting (to get dept info + role)
    const [inv] = await db
      .select()
      .from(invitation)
      .where(eq(invitation.id, invitationId))
      .limit(1);

    // 2. Accept via Better Auth — creates the member record
    const data = await auth.api.acceptInvitation({
      body: { invitationId },
      headers: await headers(),
    });

    if (inv && data?.member) {
      const organizationId = inv.organizationId;
      // Better Auth sets member.role from invitation.role.
      // For manager/member the invitation.role is "member" (BA role);
      // the actual dept role comes from invitation.departmentRole.
      const memberRole   = data.member.role ?? "member";
      const departmentId = inv.departmentId ?? null;
      const deptRole     = inv.departmentRole ?? null;

      await grantDefaultPermissions(
        data.member.userId,
        data.member.id,
        organizationId,
        memberRole,
        departmentId,
        deptRole,
      );
    }

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (error) {
    console.error("accept-invitation error", error);
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
}
