import { NextRequest, NextResponse } from "next/server";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getTravelFormPresignedUploadUrl } from "@/lib/r2/travel-docs";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  const session = await getCachedSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "travel:apply"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { travelFormId, fileName, mimeType, fileSize } = await req.json();
  if (!travelFormId || !fileName || !mimeType || !fileSize) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const ext = fileName.includes(".") ? fileName.split(".").pop() : "bin";
  const key = `travel-forms/${orgId}/${travelFormId}/${nanoid()}.${ext}`;
  const uploadUrl = await getTravelFormPresignedUploadUrl(key, mimeType);
  return NextResponse.json({ uploadUrl, key });
}
