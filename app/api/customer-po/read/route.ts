import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerPurchaseOrder } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { validateUploadRequest } from "@/lib/uploads/validate";
import { extractPdfText } from "@/lib/customer-po/pdf-text";
import { parseGovLines } from "@/lib/customer-po/po-lines";
import { findMatchingQuotations } from "@/lib/customer-po/find-quotations";
import { extractDeliveryAddress, extractDeliveryDate, extractPoDate, extractPoNumber, extractPoTotal } from "@/lib/customer-po/quotation-match";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});
const BUCKET = process.env.R2_CUSTOMER_PURCHASE_ORDER_BUCKET!;

// Reads a customer's PO (a PDF) and suggests which of our quotations it belongs to. The file is read in memory and not
// kept here; it is stored by the normal upload. Nothing is linked: the page shows the suggestions and the user decides.
//
// ?only=total: just the PO's total, to check a CPO's items against (the edit page). The PDF is then either sent, or,
// for the document already saved with a CPO, named by its key (a CPO of this company must point to it).
export async function POST(req: NextRequest) {
  const session = await getCachedSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });
  const perms = await getUserPermissions(session.user.id, orgId);
  const onlyTotal = req.nextUrl.searchParams.get("only") === "total";
  const allowed = onlyTotal
    ? hasAccess(perms, "customer-po:create") || hasAccess(perms, "customer-po:update")
    : hasAccess(perms, "customer-po:create") && hasAccess(perms, "quotation:read");
  if (!allowed) return NextResponse.json({ error: "You don't have permission to do this" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const key = onlyTotal ? (form.get("key") as string | null) : null;
  let bytes: Uint8Array;
  if (file) {
    const bad = validateUploadRequest(file.name, file.size);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      return NextResponse.json({ readable: false, reason: "Only a PDF can be read. Link the quotation yourself." });
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } else if (key) {
    if (!/\.pdf$/i.test(key)) return NextResponse.json({ readable: false, reason: "Only a PDF can be read." });
    const [own] = await db.select({ id: customerPurchaseOrder.id }).from(customerPurchaseOrder)
      .where(and(eq(customerPurchaseOrder.organizationId, orgId), eq(customerPurchaseOrder.documentKey, key))).limit(1);
    if (!own) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      bytes = await obj.Body!.transformToByteArray();
    } catch {
      return NextResponse.json({ readable: false, reason: "The document could not be fetched." });
    }
  } else {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  let pdf;
  try {
    pdf = await extractPdfText(bytes);
  } catch (e) {
    console.error("customer-po read: the PDF could not be opened", e);
    return NextResponse.json({ readable: false, reason: `This file could not be opened as a PDF (${String((e as Error)?.message ?? e).slice(0, 160)}).` });
  }
  if (!pdf.readable) {
    return NextResponse.json({ readable: false, reason: "No text could be read from this PDF (it may be a scan or a photo). Link the quotation yourself." });
  }
  // the PO's own lines (a government order): to tell whether everything on the PO is in a quotation, and its total
  const lines = parseGovLines(pdf.cells);
  const poTotal = extractPoTotal(pdf.text, pdf.cells, lines); // the PO's total, to check the CPO's items against
  if (onlyTotal) return NextResponse.json({ readable: true, poTotal });
  const suggestions = await findMatchingQuotations(orgId, pdf.text, lines);
  return NextResponse.json({ readable: true, suggestions, poNumber: extractPoNumber(pdf.text), poDate: extractPoDate(pdf.text),
    lines, poTotal,
    deliveryDate: extractDeliveryDate(pdf.text), deliveryAddress: extractDeliveryAddress(pdf.text),
  });
}
