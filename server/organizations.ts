"use server";

import { db } from "@/db";
import { getCurrentUser } from "./users";
import { member, organization, user } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import slugify from "slugify";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

export const createOrganization = async (
  name: string,
  logo: File | null | undefined,
) => {
  const generateSlug = (name: string) => {
    return slugify(name, {
      lower: true,
      strict: true, // buang special char
      trim: true,
    });
  };

  const baseSlug = generateSlug(name);
  // 🔥 handle duplicate slug
  let slug = baseSlug;
  let count = 1;

  while (true) {
    const existingSlug = await db
      .select()
      .from(organization)
      .where(eq(organization.slug, slug));

    if (existingSlug.length === 0) break;
    slug = `${baseSlug}-${count}`;
    count++;
  }

  try {
    let logoUrl: string | undefined = undefined;

    if (logo && logo?.size > 0) {
      if (logo.type !== "image/svg+xml")
        return { success: false, message: "Invalid file type, must be svg" };

      // ==============================
      // ✅ UPLOAD TO R2 (PRIVATE API)
      // ==============================
      const s3 = new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT!,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY!,
          secretAccessKey: process.env.R2_SECRET_KEY!,
        },
      });

      const buffer = Buffer.from(await logo!.arrayBuffer());

      const key = `organizations/${randomUUID()}.svg`;

      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET!,
          Key: key,
          Body: buffer,
          ContentType: "image/svg+xml",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );

      // ==============================
      // ✅ PUBLIC URL (FOR FRONTEND)
      // ==============================

      logoUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    }

    await auth.api.createOrganization({
      body: {
        name, // required
        slug,
        logo: logoUrl,
        keepCurrentActiveOrganization: false,
      },
      // This endpoint requires session cookies.
      headers: await headers(),
    });
    return { success: true, message: "Successfully created an organization." };
  } catch (error) {
    const e = error as Error;
    return {
      success: false,
      message: e.message || "An unknown error occurred.",
    };
  }
};

export const getOrganizations = async () => {
  const { user } = await getCurrentUser();

  if (!user) return [];

  const organizations = await db
    .select({
      id: organization.id,
      name: organization.name,
      logo: organization.logo,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, user.id));

  return organizations;
};

export const getActiveOrganization = async (userId: string) => {
  const memberUser = await db
    .select()
    .from(member)
    .where(eq(member.userId, userId))
    .then((res) => res[0]);

  if (!memberUser) {
    return null;
  }
  const activeOrganization = await db
    .select()
    .from(organization)
    .where(eq(organization.id, memberUser?.organizationId))
    .limit(1)
    .then((res) => res[0]);

  if (!memberUser) {
    return null;
  }

  return activeOrganization;
};
