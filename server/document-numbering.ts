"use server";

import { db } from "@/db";
import { documentNumberingSetting, member, organization } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, asc } from "drizzle-orm";
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

async function getOwnerOrgId(userId: string, currentOrgId: string): Promise<string> {
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerMember) return currentOrgId;
  const [primaryOrg] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);
  return primaryOrg?.organizationId ?? currentOrgId;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getDocumentNumberingSettings(): Promise<NumberingSetting[]> {
  const { orgId, userId } = await getSession();
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  return db
    .select()
    .from(documentNumberingSetting)
    .where(eq(documentNumberingSetting.organizationId, ownerOrgId));
}

// Used inside other server actions — no auth check, orgId already resolved.
export async function getNumberingConfig(orgId: string, docType: DocType): Promise<NumberingConfig> {
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
  const perms = await import("@/lib/permissions/get-user-permissions").then((m) =>
    m.getUserPermissions(userId, orgId),
  );
  const { hasAccess } = await import("@/lib/permissions/has-access");
  if (!hasAccess(perms, "organization:update")) throw new Error("Forbidden");

  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  for (const s of settings) {
    const existing = await db
      .select({ id: documentNumberingSetting.id })
      .from(documentNumberingSetting)
      .where(
        and(
          eq(documentNumberingSetting.organizationId, ownerOrgId),
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
        organizationId: ownerOrgId,
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
