"use server";

import { db } from "@/db";
import { getCurrentUser } from "./users";
import { member, organization } from "@/db/schema";
import { eq } from "drizzle-orm";
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
      if (logo.type !== "image/png")
        return { success: false, message: "Invalid file type, must be PNG" };

      const s3 = new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT!,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID!,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
      });

      const ext = logo.name.split(".").pop() ?? "png";
      const key = `logos/${randomUUID()}/logo-${Date.now()}.${ext}`;
      const bytes = new Uint8Array(await logo.arrayBuffer());

      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.R2_LOGO_BUCKET!,
          Key: key,
          Body: bytes,
          ContentType: logo.type,
        }),
      );

      logoUrl = `${process.env.R2_LOGO_PUBLIC_URL}/${key}`;
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

