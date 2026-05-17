"use server";

import { db } from "@/db";
import { profile } from "@/db/schema";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
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

  const ext = file.name.split(".").pop();
  const key = `bank-books/${session.user.id}/${nanoid()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      Body: buf,
      ContentType: file.type,
    }),
  );

  const url = `${process.env.R2_PUBLIC_URL}/${key}`;
  await upsertProfile({ bankBookUrl: url });
  return url;
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
