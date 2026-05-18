"use server";

import { db } from "@/db";
import { organizationProfile, organization } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ── S3 / R2 client ─────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────
async function getOrgId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return orgId;
}

type CertField = "ssmCertUrl" | "taxCertUrl" | "mofCertUrl" | "pkkCertUrl";

// ── Get organization profile ───────────────────────────────────────────────
export async function getOrganizationProfile() {
  const orgId = await getOrgId();

  const [existing] = await db
    .select()
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId))
    .limit(1);

  // Auto-create if missing
  if (!existing) {
    const [created] = await db
      .insert(organizationProfile)
      .values({ id: nanoid(), organizationId: orgId })
      .returning();
    return created;
  }

  return existing;
}

// ── Upsert organization profile ────────────────────────────────────────────
export async function upsertOrganizationProfile(
  data: Partial<
    Omit<
      typeof organizationProfile.$inferInsert,
      "id" | "organizationId" | "createdAt" | "updatedAt"
    >
  >,
) {
  const orgId = await getOrgId();

  await db
    .insert(organizationProfile)
    .values({
      id: nanoid(),
      organizationId: orgId,
      ...data,
    })
    .onConflictDoUpdate({
      target: organizationProfile.organizationId,
      set: {
        ...data,
        updatedAt: new Date(),
      },
    });
}

// ── Upload organization logo (public bucket) ───────────────────────────────
export async function uploadOrganizationLogo(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const file = formData.get("file") as File;
  if (!file) throw new Error("No file provided");

  const ext = file.name.split(".").pop();
  const key = `logos/${orgId}/logo-${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Upload to public logo bucket
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_LOGO_BUCKET!,
      Key: key,
      Body: bytes,
      ContentType: file.type,
    }),
  );

  const url = `${process.env.R2_LOGO_PUBLIC_URL}/${key}`;

  // Update Better Auth organization logo field
  await db
    .update(organization)
    .set({ logo: url })
    .where(eq(organization.id, orgId));

  return url;
}

// ── Upload certificate (private bucket) ────────────────────────────────────
export async function uploadOrgCertificate(
  formData: FormData,
  field: CertField,
) {
  const orgId = await getOrgId();

  const file = formData.get("file") as File;
  if (!file) throw new Error("No file provided");

  const ext = file.name.split(".").pop();
  const key = `org-certificates/${orgId}/${field}-${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_CERTIFICATES_BUCKET!,
      Key: key,
      Body: bytes,
      ContentType: file.type,
    }),
  );

  // Store only the key — not a public URL
  await upsertOrganizationProfile({ [field]: key });

  return key;
}

// ── Get presigned URL for private certificate ──────────────────────────────
export async function getPresignedUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const command = new GetObjectCommand({
    Bucket: process.env.R2_CERTIFICATES_BUCKET!,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn });
}

// ── Get organization with profile ──────────────────────────────────────────
export async function getOrganizationWithProfile() {
  const orgId = await getOrgId();

  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  const profile = await getOrganizationProfile();

  return { org, profile };
}

// ── Delete certificate ─────────────────────────────────────────────────────
export async function removeOrgCertificate(field: CertField) {
  await upsertOrganizationProfile({ [field]: null });
}
