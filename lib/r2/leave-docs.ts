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

// Set R2_LEAVE_DOCS_BUCKET=leave-docs in your .env.local
const BUCKET = process.env.R2_LEAVE_DOCS_BUCKET ?? "leave-docs";

export function buildLeaveDocKey(orgId: string, appId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  return `${orgId}/${appId}/${nanoid()}.${ext}`;
}

export async function getLeavePresignedUploadUrl(key: string, mimeType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimeType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 300 }); // 5 min
}

export async function getLeavePresignedDownloadUrl(
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

export async function deleteLeaveDocFromR2(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
