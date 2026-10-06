import { db } from "@/db";
import { organization, organizationProfile } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getPackingListDetail, getPackingListDetailCentralized, type PackingListWithItems } from "@/server/packing-list";
import { getProductImageUrl } from "@/helper/product-image";
import { generatePackingListPdf, type PlPdfImage } from "@/app/dashboard/procurement/packing-list/[id]/print/generate-pl-pdf";

export const maxDuration = 60;

interface Props {
  params: Promise<{ id: string }>;
}

// pdf-lib embeds only JPEG and PNG — anything else (e.g. WebP) is skipped
// and the next candidate image tried.
async function fetchImage(url: string): Promise<PlPdfImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, format: "jpg" };
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, format: "png" };
    return null;
  } catch {
    return null;
  }
}

// Same order as the on-screen thumbnail: the packing list's own image, then
// the catalogue image by design code, then by product code.
async function itemImages(pl: PackingListWithItems): Promise<Map<string, PlPdfImage>> {
  const cache = new Map<string, Promise<PlPdfImage | null>>();
  const get = (url: string) => {
    if (!cache.has(url)) cache.set(url, fetchImage(url));
    return cache.get(url)!;
  };
  const out = new Map<string, PlPdfImage>();
  await Promise.all(pl.items.map(async (item) => {
    const candidates = [
      item.imageUrl,
      item.designBrandCode?.trim() ? getProductImageUrl(item.designBrandCode.trim()) : "",
      item.productCode?.trim() ? getProductImageUrl(item.productCode.trim()) : "",
    ].filter((u): u is string => !!u);
    for (const url of candidates) {
      const img = await get(url);
      if (img) { out.set(item.id, img); return; }
    }
  }));
  return out;
}

async function printProfile(orgId: string) {
  const [o] = await db
    .select({
      name: organization.name,
      logo: organization.logo,
      logoKey: organizationProfile.logoKey,
      brandColor: organizationProfile.brandColor,
      companyName: organizationProfile.companyName,
      companyAddress: organizationProfile.companyAddress,
      taxNo: organizationProfile.taxNo,
      phone: organizationProfile.phone,
      email: organizationProfile.email,
      website: organizationProfile.website,
      oldSsmNo: organizationProfile.oldSsmNo,
      newSsmNo: organizationProfile.newSsmNo,
      mdaEstablishmentNo: organizationProfile.mdaEstablishmentNo,
      headerLayout: organizationProfile.headerLayout,
      orgNameSize: organizationProfile.orgNameSize,
    })
    .from(organization)
    .leftJoin(organizationProfile, eq(organizationProfile.organizationId, organization.id))
    .where(eq(organization.id, orgId))
    .limit(1);
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  return {
    name: o?.name ?? "",
    logoUrl: o?.logoKey ? `${r2Public}/${o.logoKey}` : (o?.logo ?? null),
    brandColor: o?.brandColor ?? null,
    companyName: o?.companyName ?? null,
    companyAddress: o?.companyAddress ?? null,
    taxNo: o?.taxNo ?? null,
    phone: o?.phone ?? null,
    email: o?.email ?? null,
    website: o?.website ?? null,
    oldSsmNo: o?.oldSsmNo ?? null,
    newSsmNo: o?.newSsmNo ?? null,
    mdaEstablishmentNo: o?.mdaEstablishmentNo ?? null,
    headerLayout: o?.headerLayout ?? null,
    orgNameSize: o?.orgNameSize ?? null,
  };
}

export async function GET(_req: Request, { params }: Props) {
  const { id } = await params;

  // Own company first, then the cross-company (centralized) view — tried
  // separately, as in the discrepancy report, since a caller may hold only
  // one of the two permissions.
  let pl: PackingListWithItems | null = null;
  try {
    pl = await getPackingListDetail(id);
  } catch { /* not readable in the active company — try centralized */ }
  if (!pl) {
    try {
      pl = await getPackingListDetailCentralized(id);
    } catch {
      return new Response("You don't have permission to view this packing list", { status: 403 });
    }
  }
  if (!pl) return new Response("Packing list not found", { status: 404 });

  try {
    // Branding of the company that issued the packing list, not the viewer's
    const [org, images] = await Promise.all([printProfile(pl.organizationId), itemImages(pl)]);
    const bytes = await generatePackingListPdf(pl, org, images);
    const safeNo = pl.packingListNo.replace(/[^a-z0-9-]/gi, "_");
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeNo}.pdf"`,
      },
    });
  } catch (e) {
    console.error("[packing-list/pdf] failed:", e);
    return new Response("Couldn't generate the PDF", { status: 500 });
  }
}
