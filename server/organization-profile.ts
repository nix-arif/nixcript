"use server";

import { db } from "@/db";
import { organizationProfile, organization } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
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
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return orgId;
}

type CertField =
  | "ssmCertUrl"
  | "taxCertUrl"
  | "mofCertUrl"
  | "pkkCertUrl"
  | "mdaCertUrl"
  | "bankStatementUrl"
  | "lampiran12Url"
  | "lampiran13Url";

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

  // ← Sync companyName to Better Auth organization.name
  if (data.companyName) {
    await db
      .update(organization)
      .set({ name: data.companyName })
      .where(eq(organization.id, orgId));
  }
}

// ── Upload organization logo (public bucket) ───────────────────────────────
export async function uploadOrganizationLogo(formData: FormData) {
  const session = await getCachedSession();
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
  const session = await getCachedSession();
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
  const orgId = await getOrgId();

  // Get current key before nulling it
  const [current] = await db
    .select()
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId))
    .limit(1);

  const key = current?.[field] as string | null;

  // Delete from R2 if key exists
  if (key) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_CERTIFICATES_BUCKET!,
          Key: key,
        }),
      );
    } catch (err) {
      console.error("Failed to delete from R2:", err);
      // Don't throw — still null the db field even if R2 delete fails
    }
  }

  // Null the db field
  await upsertOrganizationProfile({ [field]: null });
}

export async function getFullOrganizationProfile() {
  const orgId = await getOrgId();

  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  const profile = await getOrganizationProfile();

  const [
    ssmCertSignedUrl,
    taxCertSignedUrl,
    mofCertSignedUrl,
    pkkCertSignedUrl,
    mdaCertSignedUrl,
    bankStatementSignedUrl,
    lampiran12SignedUrl,
    lampiran13SignedUrl,
  ] = await Promise.all([
    profile.ssmCertUrl ? getPresignedUrl(profile.ssmCertUrl) : null,
    profile.taxCertUrl ? getPresignedUrl(profile.taxCertUrl) : null,
    profile.mofCertUrl ? getPresignedUrl(profile.mofCertUrl) : null,
    profile.pkkCertUrl ? getPresignedUrl(profile.pkkCertUrl) : null,
    profile.mdaCertUrl ? getPresignedUrl(profile.mdaCertUrl) : null,
    profile.bankStatementUrl ? getPresignedUrl(profile.bankStatementUrl) : null,
    profile.lampiran12Url ? getPresignedUrl(profile.lampiran12Url) : null,
    profile.lampiran13Url ? getPresignedUrl(profile.lampiran13Url) : null,
  ]);

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logo: org.logo ?? null,
    quotationNoFormat: profile.quotationNoFormat ?? "A",
    pdfTemplate: profile.pdfTemplate ?? "affirma",
    titlePosition: profile.titlePosition ?? "stamp",
    tableFontSize: profile.tableFontSize ?? "normal",
    headerLayout:     profile.headerLayout    ?? "standard",
    orgNameSize:      profile.orgNameSize     ?? "medium",
    orgNameBold:      profile.orgNameBold     ?? 1,
    orgNameUppercase: profile.orgNameUppercase ?? 0,
    orgInfoSide:             profile.orgInfoSide             ?? "left",
    quotationLabelSize:      profile.quotationLabelSize      ?? "normal",
    quotationLabelBold:      profile.quotationLabelBold      ?? 1,
    quotationLabelUppercase: profile.quotationLabelUppercase ?? 1,
    tableRowStyle:           profile.tableRowStyle           ?? "default",
    showCodeColumn:          profile.showCodeColumn          ?? 1,
    brandColor: profile.brandColor ?? "#1a56db",
    slateTextColor: profile.slateTextColor ?? null,
    slateHeadingColor: profile.slateHeadingColor ?? null,
    templateStyle: profile.templateStyle ?? "corporate",
    companyName: profile.companyName ?? org.name,
    companyAddress: profile.companyAddress ?? null,
    phone: profile.phone ?? null,
    email: profile.email ?? null,
    website: profile.website ?? null,
    oldSsmNo: profile.oldSsmNo ?? null,
    newSsmNo: profile.newSsmNo ?? null,
    taxNo: profile.taxNo ?? null,
    mofNo: profile.mofNo ?? null,
    mofValidity: profile.mofValidity ?? null,
    pkkNo: profile.pkkNo ?? null,
    mdaEstablishmentNo: profile.mdaEstablishmentNo ?? null,
    mdaEstablishmentValidity: profile.mdaEstablishmentValidity ?? null,
    attentionNameSize: profile.attentionNameSize ?? "medium",
    attentionNameBold: profile.attentionNameBold ?? 1,
    detailFontSize:    profile.detailFontSize    ?? "normal",
    detailFontBold:    profile.detailFontBold    ?? 0,
    detailAlignment:   profile.detailAlignment   ?? "right",
    warehouseAddresses:
      (profile.warehouseAddresses as { label: string; address: string }[]) ??
      [],
    bankingInfo:
      (profile.bankingInfo as {
        id: string;
        bankName: string;
        accountHolder: string;
        accountNo: string;
        accountType: string;
        swiftCode: string;
        isPrimary: boolean;
      }[]) ?? [],
    ssmCertKey: profile.ssmCertUrl ?? null,
    taxCertKey: profile.taxCertUrl ?? null,
    mofCertKey: profile.mofCertUrl ?? null,
    pkkCertKey: profile.pkkCertUrl ?? null,
    mdaCertKey: profile.mdaCertUrl ?? null,
    bankStatementKey: profile.bankStatementUrl ?? null,
    lampiran12Key: profile.lampiran12Url ?? null,
    lampiran13Key: profile.lampiran13Url ?? null,
    ssmCertSignedUrl,
    taxCertSignedUrl,
    mofCertSignedUrl,
    pkkCertSignedUrl,
    mdaCertSignedUrl,
    bankStatementSignedUrl,
    lampiran12SignedUrl,
    lampiran13SignedUrl,
  };
}

export type FullOrganizationProfile = Awaited<
  ReturnType<typeof getFullOrganizationProfile>
>;

export async function getLogoAsBase64(): Promise<{
  data: Uint8Array;
  format: "png" | "jpg";
} | null> {
  const orgId = await getOrgId();

  const [org] = await db
    .select({ logo: organization.logo })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  if (!org?.logo) return null;

  try {
    const res = await fetch(org.logo);
    const contentType = res.headers.get("content-type") ?? "";
    const buffer = await res.arrayBuffer();

    if (contentType.includes("svg")) {
      // SVG not supported by pdf-lib — return null, handle separately
      return null;
    }

    const format = contentType.includes("png") ? "png" : "jpg";
    return { data: new Uint8Array(buffer), format };
  } catch {
    return null;
  }
}
