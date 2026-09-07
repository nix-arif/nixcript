"use server";

// Owner-level governance: lets the owner restrict a real-world supplier
// (matched by name — supplier records have no shared identity across an
// owner's different orgs) to being dealt with directly by only one
// designated organization. Every other org gets a clean error pointing them
// at the designated org instead — pairs with the intercompany PO→SO link
// (server/sales-order.ts's maybeCreateIntercompanySalesOrder) as the actual
// route those other orgs should use.

import { db } from "@/db";
import { restrictedSupplier, member, organization } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, inArray, asc } from "drizzle-orm";

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

// For actions restricted to the organization owner regardless of any
// individually granted permission — same restriction/shape as the identical
// helper duplicated per-file elsewhere (server/goods-receipt.ts,
// server/purchase-order.ts, etc.).
async function requireOwner() {
  const { session, orgId, userId } = await getSession();
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!m || m.role !== "owner") throw new Error("Only the organization owner can do this");
  return { session, orgId, userId };
}

// Every org owned by the same owner as the given org (includes the org
// itself) — identical pattern to the 6 other per-file copies in this codebase.
async function getOwnerOrgIds(orgId: string): Promise<string[]> {
  const [ownerRow] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerRow) return [orgId];

  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerRow.userId), eq(member.role, "owner")));
  return rows.map((r) => r.organizationId);
}

// The userId that owns orgId (the member row with role "owner" there) —
// null if that org has no owner on record, which means no restriction rule
// could possibly apply to it.
async function getOwnerUserId(orgId: string): Promise<string | null> {
  const [ownerRow] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    .limit(1);
  return ownerRow?.userId ?? null;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export type RestrictedSupplierRule = typeof restrictedSupplier.$inferSelect & { designatedOrganizationName: string | null };

export async function getRestrictedSupplierRules(): Promise<RestrictedSupplierRule[]> {
  const { orgId } = await requireOwner();
  const ownerUserId = await getOwnerUserId(orgId);
  if (!ownerUserId) return [];

  const rows = await db
    .select({ rule: restrictedSupplier, designatedOrganizationName: organization.name })
    .from(restrictedSupplier)
    .leftJoin(organization, eq(organization.id, restrictedSupplier.designatedOrganizationId))
    .where(eq(restrictedSupplier.ownerUserId, ownerUserId))
    .orderBy(restrictedSupplier.supplierName);

  return rows.map((r) => ({ ...r.rule, designatedOrganizationName: r.designatedOrganizationName }));
}

// Every org owned by the same owner as the caller (including the caller's
// own active org) — unlike getOwnerOrganizations() in server/supplier.ts,
// which excludes the active org for the "link a supplier to..." picker, a
// designation rule can legitimately point at the caller's current org too.
export async function getOwnerOrganizationsForRules(): Promise<{ id: string; name: string }[]> {
  const { orgId } = await requireOwner();
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, ownerOrgIds))
    .orderBy(asc(organization.name));
}

export interface CreateRestrictedSupplierRuleInput {
  supplierName: string;
  designatedOrganizationId: string;
  notes?: string;
}

export async function createRestrictedSupplierRule(input: CreateRestrictedSupplierRuleInput): Promise<void> {
  const { orgId, userId } = await requireOwner();

  const supplierName = input.supplierName.trim();
  if (!supplierName) throw new Error("Supplier name is required");
  const supplierNameNormalized = normalize(supplierName);

  const ownerOrgIds = await getOwnerOrgIds(orgId);
  if (!ownerOrgIds.includes(input.designatedOrganizationId)) {
    throw new Error("You can only designate one of your own organizations");
  }

  const ownerUserId = await getOwnerUserId(orgId);
  if (!ownerUserId) throw new Error("No owner found for this organization");

  const [existing] = await db
    .select({ id: restrictedSupplier.id })
    .from(restrictedSupplier)
    .where(and(eq(restrictedSupplier.ownerUserId, ownerUserId), eq(restrictedSupplier.supplierNameNormalized, supplierNameNormalized)));
  if (existing) throw new Error(`A rule for "${supplierName}" already exists`);

  await db.insert(restrictedSupplier).values({
    id: nanoid(),
    ownerUserId,
    supplierName,
    supplierNameNormalized,
    designatedOrganizationId: input.designatedOrganizationId,
    notes: input.notes?.trim() || null,
    createdBy: userId,
  });
}

export async function deleteRestrictedSupplierRule(id: string): Promise<void> {
  const { orgId } = await requireOwner();
  const ownerUserId = await getOwnerUserId(orgId);
  if (!ownerUserId) throw new Error("No owner found for this organization");

  const [existing] = await db
    .select({ id: restrictedSupplier.id })
    .from(restrictedSupplier)
    .where(and(eq(restrictedSupplier.id, id), eq(restrictedSupplier.ownerUserId, ownerUserId)));
  if (!existing) throw new Error("Rule not found");

  await db.delete(restrictedSupplier).where(eq(restrictedSupplier.id, id));
}

// The enforcement primitive — call before creating/renaming a supplier
// record, before saving a PR line's preferred supplier, and before saving a
// PO's supplier. Pure read + validate, no side effects, safe to export and
// call from any of those files.
export async function assertSupplierAllowed(orgId: string, supplierName: string | null | undefined): Promise<void> {
  const name = supplierName?.trim();
  if (!name) return; // nothing to check

  const ownerUserId = await getOwnerUserId(orgId);
  if (!ownerUserId) return; // no owner on record — no rule could apply

  const [rule] = await db
    .select({ designatedOrganizationId: restrictedSupplier.designatedOrganizationId })
    .from(restrictedSupplier)
    .where(and(eq(restrictedSupplier.ownerUserId, ownerUserId), eq(restrictedSupplier.supplierNameNormalized, normalize(name))));
  if (!rule || rule.designatedOrganizationId === orgId) return; // no rule, or this is the designated org

  const [designatedOrg] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, rule.designatedOrganizationId));
  const designatedName = designatedOrg?.name ?? "another organization";
  throw new Error(
    `Only ${designatedName} can deal with "${name}" directly — issue a PO to ${designatedName} instead and let them handle it with this supplier.`,
  );
}
