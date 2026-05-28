import { NextRequest, NextResponse } from "next/server";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getPresignedDownloadUrl } from "@/lib/r2/ledger-docs";
import { db } from "@/db";
import { ledgerDocument } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const session = await getCachedSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "account:read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { key: keyParts } = await params;
  const fileKey = keyParts.join("/");

  // Verify document belongs to this org
  const doc = await db.select().from(ledgerDocument)
    .where(eq(ledgerDocument.fileKey, fileKey))
    .limit(1);
  if (!doc[0] || doc[0].organizationId !== orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = await getPresignedDownloadUrl(fileKey, doc[0].fileName);
  return NextResponse.redirect(url);
}
