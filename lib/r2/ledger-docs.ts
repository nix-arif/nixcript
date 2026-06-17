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

// Set R2_LEDGER_DOCS_BUCKET=ledger-docs in your .env.local
const BUCKET = process.env.R2_LEDGER_DOCS_BUCKET ?? "ledger-docs";

export function buildLedgerDocKey(orgId: string, entryId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  return `${orgId}/${entryId}/${nanoid()}.${ext}`;
}

export async function getPresignedUploadUrl(key: string, mimeType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimeType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 300 }); // 5 min
}

export async function getPresignedDownloadUrl(key: string, filename: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 900 }); // 15 min
}

export async function deleteLedgerDocFromR2(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function getLedgerDocBytes(key: string): Promise<Uint8Array> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const res = await s3.send(cmd);
  if (!res.Body) throw new Error(`No body for R2 key: ${key}`);
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return merged;
}
