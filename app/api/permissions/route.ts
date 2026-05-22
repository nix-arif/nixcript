// app/api/permissions/route.ts
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Verify session server-side — don't trust client-passed userId
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ permissions: [] }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");

  if (!organizationId) {
    return NextResponse.json({ permissions: [] });
  }

  // Always use session.user.id — never trust client-passed userId
  const permissions = await getUserPermissions(session.user.id, organizationId);
  return NextResponse.json({ permissions });
}
