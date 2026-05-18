"use server";

import { db } from "@/db";
import { profile } from "@/db/schema";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!, // ← fixed key name
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, // ← fixed key name
  },
});

export async function getProfile() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const [existing] = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, session.user.id))
    .limit(1);

  return existing ?? null;
}

export async function upsertProfile(
  data: Partial<typeof profile.$inferInsert>,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const existing = await getProfile();

  if (existing) {
    await db
      .update(profile)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(profile.userId, session.user.id));
  } else {
    await db.insert(profile).values({
      id: nanoid(),
      userId: session.user.id,
      ...data,
    });
  }
}

export async function uploadBankBook(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const file = formData.get("file") as File;
  if (!file) throw new Error("No file");

  // Delete old bank book from R2 if exists
  const existing = await getProfile();
  if (existing?.bankBookUrl) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_CERTIFICATES_BUCKET!,
          Key: existing.bankBookUrl, // stored as key not URL
        }),
      );
    } catch {
      // ignore delete errors
    }
  }

  const ext = file.name.split(".").pop();
  const key = `bank-books/${session.user.id}/${nanoid()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_CERTIFICATES_BUCKET!, // ← private bucket
      Key: key,
      Body: buf,
      ContentType: file.type,
    }),
  );

  // Store key only — not public URL (private bucket)
  await upsertProfile({ bankBookUrl: key });
  return key;
}

export async function ensureProfileExists() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return;

  const [existing] = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, session.user.id))
    .limit(1);

  if (!existing) {
    await db
      .insert(profile)
      .values({
        id: nanoid(),
        userId: session.user.id,
        personalEmail: session.user.email ?? "",
        pdpaConsent: false,
        isActive: true,
      })
      .onConflictDoNothing();
  }
}
