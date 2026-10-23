// Public, login-free links to ONE piece of inspection evidence (a photo or
// video), for the discrepancy report that gets shared with the supplier — who
// has no account and so can't use the signed-in download route.
//
// The link carries an HMAC signature of the photo id, made with the app's
// secret, so it can't be guessed or enumerated: only someone who was handed
// the link (i.e. the report) can open that one file, nothing else. It has no
// expiry — a report stays usable for as long as it exists — and stops working
// when the photo is deleted. Server-side only (uses the app secret + R2).

import { createHmac, timingSafeEqual } from "crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inspectionPhoto, organization, packingList, packingListItem } from "@/db/schema";
import { extOf, inspectionMediaFilename, mediaKindOf, type InspectionMediaKind } from "@/lib/inspection-media";

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}

export function signInspectionMediaId(photoId: string): string {
  return createHmac("sha256", secret()).update(`inspection-media:${photoId}`).digest("base64url");
}

export function verifyInspectionMediaSignature(photoId: string, sig: string | undefined | null): boolean {
  if (!sig) return false;
  const expected = Buffer.from(signInspectionMediaId(photoId));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The public address to print in report links. Follows the same rule as the
 * rest of the app (sign-in, emails): in production it is APP_DOMAIN. Behind a
 * reverse proxy the request's own address is the INTERNAL one (e.g.
 * http://192.168.x.x:3000), so it is only a last resort — forwarded headers
 * first, then the raw request origin.
 */
export function publicBaseUrl(req: Request): string {
  const strip = (u: string) => u.trim().replace(/\/$/, "");
  if (process.env.NODE_ENV === "production" && process.env.APP_DOMAIN) return strip(process.env.APP_DOMAIN);
  const configured = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return strip(configured);
  const host = req.headers.get("x-forwarded-host");
  if (host) return `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  return new URL(req.url).origin;
}

/** The full public link printed in the report. */
export function inspectionMediaShareUrl(baseUrl: string, photoId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/share/inspection-media/${photoId}?s=${signInspectionMediaId(photoId)}`;
}

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const CATEGORY_LABEL: Record<string, string> = {
  return: "Return evidence",
  repair: "Repair evidence",
  accept: "Inspection remark",
};

export type SharedInspectionMedia = {
  kind: InspectionMediaKind;
  /** presigned, plays/shows inline */
  url: string;
  /** presigned, saves to disk under `filename` */
  downloadUrl: string;
  filename: string;
  packingListNo: string;
  lineNo: number;
  categoryLabel: string;
  companyName: string | null;
};

/** null when the signature is wrong or the file no longer exists. */
export async function getSharedInspectionMedia(photoId: string, sig: string | undefined): Promise<SharedInspectionMedia | null> {
  if (!verifyInspectionMediaSignature(photoId, sig)) return null;

  const [row] = await db
    .select({ photo: inspectionPhoto, item: packingListItem, pl: packingList, companyName: organization.name })
    .from(inspectionPhoto)
    .innerJoin(packingListItem, eq(inspectionPhoto.packingListItemId, packingListItem.id))
    .innerJoin(packingList, eq(packingListItem.packingListId, packingList.id))
    .innerJoin(organization, eq(organization.id, packingList.organizationId))
    .where(eq(inspectionPhoto.id, photoId));
  if (!row) return null;

  // Same naming as the in-app Download button and the report's own captions
  const sameKind = (await db
    .select({ id: inspectionPhoto.id, imageKey: inspectionPhoto.imageKey })
    .from(inspectionPhoto)
    .where(and(eq(inspectionPhoto.packingListItemId, row.item.id), eq(inspectionPhoto.category, row.photo.category)))
    .orderBy(asc(inspectionPhoto.createdAt)))
    .filter((p) => mediaKindOf(p.imageKey) === mediaKindOf(row.photo.imageKey));
  const n = Math.max(1, sameKind.findIndex((p) => p.id === photoId) + 1);
  const filename = inspectionMediaFilename(row.pl.packingListNo, row.item.rowNo, row.photo.category, n, row.photo.imageKey);

  const bucket = process.env.R2_ITEM_INSPECTIONS_BUCKET!;
  // An iPhone .mov is H.264 in a QuickTime box: served as video/mp4 it plays in Chrome/Edge too
  const mov = extOf(row.photo.imageKey) === "mov";
  const type = mov ? { ResponseContentType: "video/mp4" } : {};
  const [url, downloadUrl] = await Promise.all([
    getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: row.photo.imageKey, ...type }), { expiresIn: 7200 }),
    getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: row.photo.imageKey, ResponseContentDisposition: `attachment; filename="${filename}"`, ...type }), { expiresIn: 7200 }),
  ]);

  return {
    kind: mediaKindOf(row.photo.imageKey),
    url,
    downloadUrl,
    filename,
    packingListNo: row.pl.packingListNo,
    lineNo: row.item.rowNo,
    categoryLabel: CATEGORY_LABEL[row.photo.category] ?? "Inspection evidence",
    companyName: row.companyName,
  };
}
