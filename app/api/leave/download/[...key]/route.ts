import { NextRequest, NextResponse } from "next/server";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getLeavePresignedDownloadUrl } from "@/lib/r2/leave-docs";
import { db } from "@/db";
import { leaveDocument, leaveApplication } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const session = await getCachedSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });
  const userId = session.user.id;
  const perms = await getUserPermissions(userId, orgId);

  const { key: keyParts } = await params;
  const fileKey = keyParts.join("/");

  const doc = await db
    .select({
      fileName: leaveDocument.fileName,
      applicantId: leaveApplication.userId,
    })
    .from(leaveDocument)
    .innerJoin(leaveApplication, eq(leaveApplication.id, leaveDocument.applicationId))
    .where(and(eq(leaveDocument.fileKey, fileKey), eq(leaveDocument.organizationId, orgId)))
    .limit(1);
  if (!doc[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // leave:read:own only lets you download from your OWN application — the
  // previous check accepted any leave:read:own holder for any employee's
  // document, and never checked leave:approve/leave:read:all at all (an
  // approver reviewing someone else's application got "Forbidden").
  const isOwner = doc[0].applicantId === userId && hasAccess(perms, "leave:read:own");
  const allowed = isOwner || hasAccess(perms, "leave:approve") || hasAccess(perms, "leave:read:all");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = await getLeavePresignedDownloadUrl(fileKey, doc[0].fileName);
  return NextResponse.redirect(url);
}
