// Evidence for problems found after delivery (customer photos and videos). Same bucket as the receiving inspection evidence.
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
});
const bucket = () => {
  const b = process.env.R2_ITEM_INSPECTIONS_BUCKET;
  if (!b) throw new Error("The evidence storage is not set up on this server");
  return b;
};

export const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
export const VIDEO_EXTS = ["mp4", "mov", "m4v", "webm", "3gp"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export const uploadUrl = (key: string, contentType: string) => getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn: 3600 });
export const downloadUrl = (key: string, opts: { filename?: string; video?: boolean } = {}) =>
  getSignedUrl(s3, new GetObjectCommand({
    Bucket: bucket(), Key: key,
    ...(opts.filename ? { ResponseContentDisposition: `attachment; filename="${encodeURIComponent(opts.filename)}"` } : {}),
    ...(opts.video ? { ResponseContentType: "video/mp4" } : {}),
  }), { expiresIn: 7200 });
export const deleteObject = (key: string) => s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).then(() => undefined);
export async function getObjectBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return r.Body ? { bytes: await r.Body.transformToByteArray(), contentType: r.ContentType ?? "" } : null;
  } catch { return null; }
}
