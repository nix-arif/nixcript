import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// Reuses the claim-docs bucket by default (already provisioned) under a
// "travel-forms/" prefix — set R2_TRAVEL_DOCS_BUCKET to use a separate bucket instead.
const BUCKET = process.env.R2_TRAVEL_DOCS_BUCKET ?? process.env.R2_CLAIM_DOCS_BUCKET ?? "claim-docs";

export function buildTravelFormDocKey(orgId: string, travelFormId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  return `travel-forms/${orgId}/${travelFormId}/${nanoid()}.${ext}`;
}

export async function getTravelFormPresignedUploadUrl(key: string, mimeType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimeType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 300 }); // 5 min
}

export async function getTravelFormPresignedDownloadUrl(
  key: string,
  filename: string,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 900 }); // 15 min
}

export async function deleteTravelFormDocFromR2(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
