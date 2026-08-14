import { NextRequest, NextResponse } from "next/server";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getClaimPresignedDownloadUrl } from "@/lib/r2/claim-docs";
import { db } from "@/db";
import { claimDocument, claimApplication } from "@/db/schema";
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
      fileName: claimDocument.fileName,
      organizationId: claimDocument.organizationId,
      applicantId: claimApplication.userId,
    })
    .from(claimDocument)
    .innerJoin(claimApplication, eq(claimApplication.id, claimDocument.applicationId))
    .where(and(eq(claimDocument.fileKey, fileKey), eq(claimDocument.organizationId, orgId)))
    .limit(1);
  if (!doc[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Same access set as the claim detail view itself (getClaimApplicationDetail):
  // the claim's own submitter, its checker, its approver, or an org-wide reader.
  // Previously this only allowed claim:read:own OR claim:approve — missing
  // claim:check entirely (checkers got "Forbidden" trying to download an
  // attachment they were reviewing) and not actually verifying claim:read:own
  // meant *this user's own* claim rather than any claim in the org.
  const isOwner = doc[0].applicantId === userId && hasAccess(perms, "claim:read:own");
  const allowed = isOwner || hasAccess(perms, "claim:check") || hasAccess(perms, "claim:approve") || hasAccess(perms, "claim:read:all");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = await getClaimPresignedDownloadUrl(fileKey, doc[0].fileName);
  return NextResponse.redirect(url);
}
