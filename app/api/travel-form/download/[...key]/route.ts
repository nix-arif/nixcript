import { NextRequest, NextResponse } from "next/server";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getTravelFormPresignedDownloadUrl } from "@/lib/r2/travel-docs";
import { db } from "@/db";
import { travelFormDocument, travelForm } from "@/db/schema";
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
      fileName: travelFormDocument.fileName,
      applicantId: travelForm.userId,
    })
    .from(travelFormDocument)
    .innerJoin(travelForm, eq(travelForm.id, travelFormDocument.travelFormId))
    .where(and(eq(travelFormDocument.fileKey, fileKey), eq(travelFormDocument.organizationId, orgId)))
    .limit(1);
  if (!doc[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // travel:read:own only lets you download from your OWN form — the
  // previous check accepted any travel:read:own holder for any employee's
  // document, and never checked travel:read:all.
  const isOwner = doc[0].applicantId === userId && hasAccess(perms, "travel:read:own");
  const allowed = isOwner || hasAccess(perms, "travel:approve") || hasAccess(perms, "travel:read:all");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = await getTravelFormPresignedDownloadUrl(fileKey, doc[0].fileName);
  return NextResponse.redirect(url);
}
