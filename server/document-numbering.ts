"use server";

import { db } from "@/db";
import { documentNumberingSetting, organization } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { type DocType, DOC_TYPE_DEFAULTS } from "@/lib/document-numbering";

export type NumberingSetting = typeof documentNumberingSetting.$inferSelect;

export interface NumberingConfig {
  documentType: DocType;
  prefix: string;
  docCode: string;
  separator: string;
  includeYear: number;
  paddingLength: number;
  numberFormat: string;
}

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getDocumentNumberingSettings(): Promise<NumberingSetting[]> {
  const { orgId } = await getSession();
  return db
    .select()
    .from(documentNumberingSetting)
    .where(eq(documentNumberingSetting.organizationId, orgId));
}

// Used inside other server actions, which have already resolved and
// authorized orgId themselves — this only adds a floor check that some
// authenticated session exists, since the config itself (a numbering
// prefix, not sensitive data) doesn't need a permission check on top.
export async function getNumberingConfig(orgId: string, docType: DocType): Promise<NumberingConfig> {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");

  const [row] = await db
    .select()
    .from(documentNumberingSetting)
    .where(
      and(
        eq(documentNumberingSetting.organizationId, orgId),
        eq(documentNumberingSetting.documentType, docType),
      ),
    )
    .limit(1);

  if (row) {
    return {
      documentType: docType,
      prefix: row.prefix,
      docCode: row.docCode,
      separator: row.separator,
      includeYear: row.includeYear,
      paddingLength: row.paddingLength,
      numberFormat: row.numberFormat ?? "standard",
    };
  }

  // Fall back: use org slug as prefix, standard codes
  const [org] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, orgId));

  return {
    documentType: docType,
    prefix: (org?.slug ?? "ORG").toUpperCase(),
    docCode: DOC_TYPE_DEFAULTS[docType].docCode,
    separator: "-",
    includeYear: 1,
    paddingLength: 4,
    numberFormat: "standard",
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function upsertDocumentNumberingSettings(
  settings: Pick<NumberingConfig, "documentType" | "prefix" | "docCode" | "separator" | "includeYear" | "paddingLength" | "numberFormat">[],
): Promise<void> {
  const { orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, "organization:update")) throw new Error("Forbidden");

  for (const s of settings) {
    const existing = await db
      .select({ id: documentNumberingSetting.id })
      .from(documentNumberingSetting)
      .where(
        and(
          eq(documentNumberingSetting.organizationId, orgId),
          eq(documentNumberingSetting.documentType, s.documentType),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(documentNumberingSetting)
        .set({
          prefix: s.prefix,
          docCode: s.docCode,
          separator: s.separator,
          includeYear: s.includeYear,
          paddingLength: s.paddingLength,
          numberFormat: s.numberFormat,
        })
        .where(eq(documentNumberingSetting.id, existing[0].id));
    } else {
      await db.insert(documentNumberingSetting).values({
        id: nanoid(),
        organizationId: orgId,
        documentType: s.documentType,
        prefix: s.prefix,
        docCode: s.docCode,
        separator: s.separator,
        includeYear: s.includeYear,
        paddingLength: s.paddingLength,
        numberFormat: s.numberFormat,
      });
    }
  }
}
