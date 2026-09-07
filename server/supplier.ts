"use server";

import { db } from "@/db";
import { supplier, member, organization } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, ilike, asc, inArray } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { assertSupplierAllowed } from "@/server/supplier-restrictions";

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { session, orgId, userId };
}


/** Returns all org IDs owned by the same owner as the given org (includes the org itself). */
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

export type Supplier = typeof supplier.$inferSelect;

export interface CreateSupplierInput {
  name: string;
  registrationNo?: string;
  address?: string;
  contactPerson?: string;
  contactNo?: string;
  email?: string;
  notes?: string;
  // Marks this supplier as actually being one of the same owner's other
  // organizations — see server/intercompany.ts. Must be one of
  // getOwnerOrgIds(orgId), verified server-side, never trusted as-is.
  linkedOrganizationId?: string;
}

export interface UpdateSupplierInput extends CreateSupplierInput {
  id: string;
}

// Verifies a client-supplied linkedOrganizationId is actually one of the
// same owner's other orgs before it's allowed to be written — returns null
// (un-linking) unchanged, throws on anything else invalid.
async function resolveLinkedOrgId(orgId: string, linkedOrganizationId: string | undefined): Promise<string | null> {
  if (!linkedOrganizationId) return null;
  if (linkedOrganizationId === orgId) throw new Error("A supplier can't be linked to its own organization");
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  if (!ownerOrgIds.includes(linkedOrganizationId)) throw new Error("You can only link a supplier to one of your own organizations");
  return linkedOrganizationId;
}

// The owner's other organizations (excludes the caller's own active org) —
// for populating the "link to your organization" picker when creating or
// editing a supplier.
export async function getOwnerOrganizations(): Promise<{ id: string; name: string }[]> {
  const { orgId } = await requireAccess("supplier:read");
  const ownerOrgIds = (await getOwnerOrgIds(orgId)).filter((id) => id !== orgId);
  if (ownerOrgIds.length === 0) return [];
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, ownerOrgIds))
    .orderBy(asc(organization.name));
}

export async function getSuppliers(search?: string): Promise<Supplier[]> {
  const { orgId } = await requireAccess("supplier:read");
  const orgIds = await getOwnerOrgIds(orgId);

  const baseFilter = orgIds.length === 1
    ? eq(supplier.organizationId, orgIds[0])
    : inArray(supplier.organizationId, orgIds);

  return db
    .select()
    .from(supplier)
    .where(search ? and(baseFilter, ilike(supplier.name, `%${search}%`)) : baseFilter)
    .orderBy(asc(supplier.name));
}

export async function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  const { orgId, userId } = await requireAccess("supplier:create");
  await assertSupplierAllowed(orgId, input.name);
  const linkedOrganizationId = await resolveLinkedOrgId(orgId, input.linkedOrganizationId);

  const [row] = await db
    .insert(supplier)
    .values({
      id: nanoid(),
      organizationId: orgId,
      name: input.name,
      registrationNo: input.registrationNo ?? null,
      address: input.address ?? null,
      contactPerson: input.contactPerson ?? null,
      contactNo: input.contactNo ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
      linkedOrganizationId,
      createdBy: userId,
    })
    .returning();

  return row;
}

export async function updateSupplier(input: UpdateSupplierInput): Promise<Supplier> {
  const { orgId } = await requireAccess("supplier:update");
  const orgIds = await getOwnerOrgIds(orgId);
  const baseFilter = orgIds.length === 1
    ? eq(supplier.organizationId, orgIds[0])
    : inArray(supplier.organizationId, orgIds);
  const [check] = await db.select({ id: supplier.id, organizationId: supplier.organizationId }).from(supplier)
    .where(and(eq(supplier.id, input.id), baseFilter));
  if (!check) throw new Error("Supplier not found");
  // Both checks below are relative to the supplier's own org, not the
  // caller's active one — an owner can edit a sibling org's supplier from
  // here too (see baseFilter above), so "own org" must mean the record's.
  await assertSupplierAllowed(check.organizationId, input.name);
  const linkedOrganizationId = await resolveLinkedOrgId(check.organizationId, input.linkedOrganizationId);

  const [row] = await db
    .update(supplier)
    .set({
      name: input.name,
      registrationNo: input.registrationNo ?? null,
      address: input.address ?? null,
      contactPerson: input.contactPerson ?? null,
      contactNo: input.contactNo ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
      linkedOrganizationId,
    })
    .where(eq(supplier.id, input.id))
    .returning();

  return row;
}

export async function deleteSupplier(id: string): Promise<void> {
  const { orgId } = await requireAccess("supplier:delete");
  const orgIds = await getOwnerOrgIds(orgId);
  const baseFilter = orgIds.length === 1
    ? eq(supplier.organizationId, orgIds[0])
    : inArray(supplier.organizationId, orgIds);
  const [check] = await db.select({ id: supplier.id }).from(supplier)
    .where(and(eq(supplier.id, id), baseFilter));
  if (!check) throw new Error("Supplier not found");
  await db.delete(supplier).where(eq(supplier.id, id));
}

export async function lookupSuppliersByName(
  name: string,
): Promise<Pick<Supplier, "id" | "name" | "contactPerson" | "contactNo" | "email">[]> {
  const { orgId } = await requireAccess("supplier:read");
  const orgIds = await getOwnerOrgIds(orgId);
  const baseFilter = orgIds.length === 1
    ? eq(supplier.organizationId, orgIds[0])
    : inArray(supplier.organizationId, orgIds);

  return db
    .select({
      id: supplier.id,
      name: supplier.name,
      contactPerson: supplier.contactPerson,
      contactNo: supplier.contactNo,
      email: supplier.email,
    })
    .from(supplier)
    .where(and(baseFilter, ilike(supplier.name, `%${name}%`)))
    .orderBy(asc(supplier.name))
    .limit(20);
}
