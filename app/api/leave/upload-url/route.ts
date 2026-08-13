import { NextRequest, NextResponse } from "next/server";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getLeavePresignedUploadUrl } from "@/lib/r2/leave-docs";
import { validateUploadRequest } from "@/lib/uploads/validate";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  const session = await getCachedSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "leave:apply"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { appId, fileName, mimeType, fileSize } = await req.json();
  if (!appId || !fileName || !mimeType || !fileSize) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const uploadError = validateUploadRequest(fileName, fileSize);
  if (uploadError) return NextResponse.json({ error: uploadError }, { status: 400 });
  const ext = fileName.includes(".") ? fileName.split(".").pop() : "bin";
  const key = `${orgId}/${appId}/${nanoid()}.${ext}`;
  const uploadUrl = await getLeavePresignedUploadUrl(key, mimeType);
  return NextResponse.json({ uploadUrl, key });
}
