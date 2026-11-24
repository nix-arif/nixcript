import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { inspectionPhoto, packingList, packingListItem } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { extOf, getObjectBytes, IMAGE_EXTS } from "@/lib/r2/post-delivery";

// One defect photo, from this site, for the Pending from Supplier PDF (built in
// the browser, which can't read the storage bucket directly). Allowed for the
// photo's own company with purchase-order:read, or any company the owner holds
// with purchase-order:read:centralized — the same as the page that lists it.
// Images only.
export async function GET(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const session = await getCachedSession();
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId) return new Response("Not signed in", { status: 401 });

  const { photoId } = await params;
  const [row] = await db
    .select({ key: inspectionPhoto.imageKey, organizationId: packingList.organizationId })
    .from(inspectionPhoto)
    .innerJoin(packingListItem, eq(inspectionPhoto.packingListItemId, packingListItem.id))
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .where(and(eq(inspectionPhoto.id, photoId)));
  if (!row || !IMAGE_EXTS.includes(extOf(row.key))) return new Response("Not found", { status: 404 });

  const perms = await getUserPermissions(session.user.id, orgId);
  const allowed =
    (row.organizationId === orgId && hasAccess(perms, "purchase-order:read")) ||
    (hasAccess(perms, "purchase-order:read:centralized") && (await getOwnerOrgIds(orgId)).includes(row.organizationId));
  if (!allowed) return new Response("Not found", { status: 404 });

  const obj = await getObjectBytes(row.key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.bytes as BodyInit, {
    headers: { "Content-Type": obj.contentType || "application/octet-stream", "Cache-Control": "private, max-age=3600" },
  });
}
