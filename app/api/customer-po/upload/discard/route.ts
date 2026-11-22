import { NextRequest, NextResponse } from "next/server";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customerPurchaseOrder } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});
const BUCKET = process.env.R2_CUSTOMER_PURCHASE_ORDER_BUCKET!;

// a key as /api/customer-po/upload makes it: customer-pos/<21-character id>-<file name>, nothing else
const UPLOAD_KEY = /^customer-pos\/[A-Za-z0-9_-]{21}-[^/\\]+$/;

// Deletes a customer PO document that was uploaded on the form but not saved with a CPO: removed with X, replaced by
// another file, or left behind when the form was closed. A document a CPO points to is never deleted here; a saved
// CPO's document is deleted by the server when the CPO is saved without it (see updateCustomerPo).
// POST, so the page can also send it with navigator.sendBeacon while it is being closed.
export async function POST(req: NextRequest) {
  const session = await getCachedSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "customer-po:create") && !hasAccess(perms, "customer-po:update")) {
    return NextResponse.json({ error: "You don't have permission to do this" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (!UPLOAD_KEY.test(key) || key.includes("..")) return NextResponse.json({ error: "Not a customer PO upload" }, { status: 400 });

  // saved with a CPO (in any company): not ours to delete here
  const [used] = await db.select({ id: customerPurchaseOrder.id }).from(customerPurchaseOrder).where(eq(customerPurchaseOrder.documentKey, key)).limit(1);
  if (used) return NextResponse.json({ error: "This document is saved with a Customer PO" }, { status: 409 });

  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  return NextResponse.json({ ok: true });
}
