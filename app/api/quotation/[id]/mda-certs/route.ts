import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { member, quotation, quotationItem } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { appendMdaCertPages } from "@/lib/mda/cert-pages";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

export const maxDuration = 60;

interface Props {
  params: Promise<{ id: string }>;
}

async function getAllOwnerOrgIds(userId: string, currentOrgId: string): Promise<string[]> {
  const [orgOwner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")))
    .limit(1);
  const ownerId = orgOwner?.userId ?? userId;
  const ownedOrgs = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerId), eq(member.role, "owner")));
  const ids = ownedOrgs.map((o) => o.organizationId);
  return ids.length ? ids : [currentOrgId];
}

export async function GET(_req: Request, { params }: Props) {
  try {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  // Resolve all org IDs the user's owner controls
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return new Response("No active organization", { status: 400 });

  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "quotation:read")) return new Response("Forbidden", { status: 403 });

  const ownerOrgIds = await getAllOwnerOrgIds(session.user.id, orgId);

  // Load quotation — must belong to one of the owner's orgs
  const [q] = await db
    .select({ id: quotation.id, quotationNo: quotation.quotationNo, organizationId: quotation.organizationId })
    .from(quotation)
    .where(and(eq(quotation.id, id), inArray(quotation.organizationId, ownerOrgIds)))
    .limit(1);

  if (!q) return new Response("Not Found", { status: 404 });

  // Load all quotation items that have a product code (hasCert not trusted — may be stale)
  const items = await db
    .select({
      rowNo: quotationItem.rowNo,
      productCode: quotationItem.productCode,
      mdaRegNo: quotationItem.mdaRegNo,
    })
    .from(quotationItem)
    .where(and(eq(quotationItem.quotationId, id)));

  if (!items.some((i) => i.productCode)) {
    return new Response("No product codes in this quotation", { status: 404 });
  }

  const mergedPdf = await PDFDocument.create();
  const res = await appendMdaCertPages(mergedPdf, items.map((i) => ({ rowNo: i.rowNo, productCode: i.productCode, mdaRegNo: i.mdaRegNo })), ownerOrgIds);
  if (res.pages === 0 && res.detail) {
    return new Response(`No MDA certificates available. ${res.detail}`, { status: 404 });
  }

  if (mergedPdf.getPageCount() === 0) {
    return new Response("No MDA certificate pages could be retrieved", { status: 404 });
  }

  const bytes = await mergedPdf.save();
  const filename = `${q.quotationNo}-mda-certs.pdf`;

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  } catch (e) {
    console.error("[mda-certs] unhandled error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
