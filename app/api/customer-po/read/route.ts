import { NextRequest, NextResponse } from "next/server";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { validateUploadRequest } from "@/lib/uploads/validate";
import { extractPdfText } from "@/lib/customer-po/pdf-text";
import { findMatchingQuotations } from "@/lib/customer-po/find-quotations";
import { extractPoDate, extractPoNumber } from "@/lib/customer-po/quotation-match";

// Reads a customer's PO (a PDF) and suggests which of our quotations it belongs to. The file is read in memory and not
// kept here; it is stored by the normal upload. Nothing is linked: the page shows the suggestions and the user decides.
export async function POST(req: NextRequest) {
  const session = await getCachedSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "customer-po:create") || !hasAccess(perms, "quotation:read")) {
    return NextResponse.json({ error: "You don't have permission to do this" }, { status: 403 });
  }

  const file = (await req.formData()).get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  const bad = validateUploadRequest(file.name, file.size);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    return NextResponse.json({ readable: false, reason: "Only a PDF can be read. Link the quotation yourself." });
  }

  let pdf;
  try {
    pdf = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ readable: false, reason: "This file could not be opened as a PDF." });
  }
  if (!pdf.readable) {
    return NextResponse.json({ readable: false, reason: "No text could be read from this PDF (it may be a scan or a photo). Link the quotation yourself." });
  }
  const suggestions = await findMatchingQuotations(orgId, pdf.text);
  return NextResponse.json({ readable: true, suggestions, poNumber: extractPoNumber(pdf.text), poDate: extractPoDate(pdf.text) });
}
