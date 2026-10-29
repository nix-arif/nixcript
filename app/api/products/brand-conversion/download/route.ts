import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { buildConversionWorkbook, type ConversionSheetBody } from "@/lib/brand-conversion-xlsx";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return new NextResponse("No active organization", { status: 400 });
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "brand-conversion:read")) return new NextResponse("Forbidden", { status: 403 });

  const body = (await req.json().catch(() => null)) as ConversionSheetBody | null;
  if (!body || !Array.isArray(body.rows) || !Array.isArray(body.headers)) return NextResponse.json({ error: "Nothing to download" }, { status: 400 });
  if (body.rows.length > 5000) return NextResponse.json({ error: "Too many rows" }, { status: 400 });

  const wb = await buildConversionWorkbook(body);
  const buf = await wb.xlsx.writeBuffer();
  const base = (body.fileName || "order").replace(/\.[^.]+$/, "").replace(/[^\w .-]+/g, "_");
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base} - converted.xlsx"`,
    },
  });
}
