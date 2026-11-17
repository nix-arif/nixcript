"use server";

// Owner-level governance: lets the owner restrict a real-world supplier
// (matched by name — supplier records have no shared identity across an
// owner's different orgs) to being dealt with directly by only one
// designated organization. Every other org gets a clean error pointing them
// at the designated org instead — pairs with the intercompany PO→SO link
// (server/sales-order.ts's maybeCreateIntercompanySalesOrder) as the actual
// route those other orgs should use.

import { db } from "@/db";
import { restrictedSupplier, member, organization, supplier } from "@/db/schema";
import { nanoid } from "nanoid";
import { eq, and, inArray, asc } from "drizzle-orm";

import { getOwnerOrgIds } from "@/lib/org/owner-orgs";
import { requireIntercompany } from "@/lib/auth/intercompany-access";
import { activeRule, todayKL } from "@/lib/org/handling-periods";
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
  const { orgId } = await requireIntercompany("read");
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
  const { orgId } = await requireIntercompany("read");
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, ownerOrgIds))
    .orderBy(asc(organization.name));
}

// Distinct supplier names across every org the caller's owner controls —
// powers the "Supplier name" autocomplete in the rule form so the owner can
// pick a name that already exists somewhere instead of retyping it exactly.
// Freeform names are still allowed (a rule can pre-empt a supplier no org
// has added yet), so this is a suggestion list, not a closed set.
export async function getSupplierNamesForRules(): Promise<string[]> {
  const { orgId } = await requireIntercompany("read");
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  const rows = await db
    .selectDistinct({ name: supplier.name })
    .from(supplier)
    .where(inArray(supplier.organizationId, ownerOrgIds))
    .orderBy(asc(supplier.name));
  return rows.map((r) => r.name);
}

export interface CreateRestrictedSupplierRuleInput {
  supplierName: string;
  designatedOrganizationId: string;
  // The date this organization takes over the supplier (YYYY-MM-DD). Empty = from the beginning. A later date on a
  // second rule for the same supplier hands it to another organization from that date on.
  effectiveFrom?: string;
  notes?: string;
}

export async function createRestrictedSupplierRule(input: CreateRestrictedSupplierRuleInput): Promise<void> {
  const { orgId, userId } = await requireIntercompany("manage");

  const supplierName = input.supplierName.trim();
  if (!supplierName) throw new Error("Supplier name is required");
  const supplierNameNormalized = normalize(supplierName);

  const ownerOrgIds = await getOwnerOrgIds(orgId);
  if (!ownerOrgIds.includes(input.designatedOrganizationId)) {
    throw new Error("You can only designate one of your own organizations");
  }

  const ownerUserId = await getOwnerUserId(orgId);
  if (!ownerUserId) throw new Error("No owner found for this organization");

  const effectiveFrom = input.effectiveFrom?.trim() || null;
  if (effectiveFrom && !(/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) && !Number.isNaN(Date.parse(effectiveFrom)))) {
    throw new Error("Enter a valid date for when this organization takes over");
  }

  const sameSupplier = await db
    .select({ id: restrictedSupplier.id, effectiveFrom: restrictedSupplier.effectiveFrom })
    .from(restrictedSupplier)
    .where(and(eq(restrictedSupplier.ownerUserId, ownerUserId), eq(restrictedSupplier.supplierNameNormalized, supplierNameNormalized)));
  if (sameSupplier.some((r) => (r.effectiveFrom ?? null) === effectiveFrom)) {
    throw new Error(effectiveFrom
      ? `"${supplierName}" already has a rule starting on that date`
      : `"${supplierName}" already has a rule from the beginning. Give this one a start date to hand the supplier over.`);
  }

  await db.insert(restrictedSupplier).values({
    id: nanoid(),
    ownerUserId,
    supplierName,
    supplierNameNormalized,
    designatedOrganizationId: input.designatedOrganizationId,
    effectiveFrom,
    notes: input.notes?.trim() || null,
    createdBy: userId,
  });
}

export async function deleteRestrictedSupplierRule(id: string): Promise<void> {
  const { orgId } = await requireIntercompany("manage");
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
// asOf: the date of the document (a PO dated before a handover follows the organization that handled the supplier then);
// default today.
export async function assertSupplierAllowed(orgId: string, supplierName: string | null | undefined, asOf?: string): Promise<void> {
  const name = supplierName?.trim();
  if (!name) return; // nothing to check

  const ownerUserId = await getOwnerUserId(orgId);
  if (!ownerUserId) return; // no owner on record — no rule could apply

  // the rule that applies today (a supplier can be handed from one organization to another on a date)
  const rules = await db
    .select({ designatedOrganizationId: restrictedSupplier.designatedOrganizationId, effectiveFrom: restrictedSupplier.effectiveFrom })
    .from(restrictedSupplier)
    .where(and(eq(restrictedSupplier.ownerUserId, ownerUserId), eq(restrictedSupplier.supplierNameNormalized, normalize(name))));
  const rule = activeRule(rules, asOf ?? todayKL());
  if (!rule || rule.designatedOrganizationId === orgId) return; // no rule, or this is the designated org

  const [designatedOrg] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, rule.designatedOrganizationId));
  const designatedName = designatedOrg?.name ?? "another organization";
  throw new Error(
    `Only ${designatedName} can deal with "${name}" directly — issue a PO to ${designatedName} instead and let them handle it with this supplier.`,
  );
}
