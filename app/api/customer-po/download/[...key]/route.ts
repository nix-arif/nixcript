import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { db } from "@/db";
import { customerPurchaseOrder } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_CUSTOMER_PURCHASE_ORDER_BUCKET!;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const session = await getCachedSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "customer-po:read"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { key: keyParts } = await params;
  const fileKey = keyParts.join("/");

  const [row] = await db
    .select({ id: customerPurchaseOrder.id })
    .from(customerPurchaseOrder)
    .where(
      and(
        eq(customerPurchaseOrder.organizationId, orgId),
        eq(customerPurchaseOrder.documentKey, fileKey),
      ),
    )
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: fileKey }),
    { expiresIn: 900 },
  );
  return NextResponse.redirect(url);
}
