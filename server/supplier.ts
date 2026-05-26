"use server";

import { db } from "@/db";
import { supplier, member } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, ilike, desc, asc, inArray, isNull } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Forbidden");
  return { session, orgId, userId };
}

async function getOwnerOrgId(userId: string, currentOrgId: string): Promise<string> {
  const [primary] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .orderBy(asc(member.createdAt))
    .limit(1);
  return primary?.organizationId ?? currentOrgId;
}

async function getOwnerOrgIds(userId: string, currentOrgId: string): Promise<string[]> {
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "owner"), isNull(member.deletedAt)));
  const ids = owned.map((m) => m.organizationId);
  return ids.length > 0 ? ids : [currentOrgId];
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
}

export interface UpdateSupplierInput extends CreateSupplierInput {
  id: string;
}

export async function getSuppliers(search?: string): Promise<Supplier[]> {
  const { orgId, userId } = await requireAccess("supplier:read");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  let query = db
    .select()
    .from(supplier)
    .where(inArray(supplier.organizationId, ownerOrgIds))
    .$dynamic();

  if (search) {
    query = query.where(
      and(
        inArray(supplier.organizationId, ownerOrgIds),
        ilike(supplier.name, `%${search}%`),
      ),
    );
  }

  return query.orderBy(asc(supplier.name));
}

export async function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  const { orgId, userId } = await requireAccess("supplier:create");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [row] = await db
    .insert(supplier)
    .values({
      id: nanoid(),
      organizationId: ownerOrgId,
      name: input.name,
      registrationNo: input.registrationNo ?? null,
      address: input.address ?? null,
      contactPerson: input.contactPerson ?? null,
      contactNo: input.contactNo ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
      createdBy: userId,
    })
    .returning();

  return row;
}

export async function updateSupplier(input: UpdateSupplierInput): Promise<Supplier> {
  const { orgId, userId } = await requireAccess("supplier:update");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  const [check] = await db.select({ id: supplier.id }).from(supplier)
    .where(and(eq(supplier.id, input.id), inArray(supplier.organizationId, ownerOrgIds)));
  if (!check) throw new Error("Supplier not found");

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
    })
    .where(eq(supplier.id, input.id))
    .returning();

  return row;
}

export async function deleteSupplier(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("supplier:delete");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  const [check] = await db.select({ id: supplier.id }).from(supplier)
    .where(and(eq(supplier.id, id), inArray(supplier.organizationId, ownerOrgIds)));
  if (!check) throw new Error("Supplier not found");
  await db.delete(supplier).where(eq(supplier.id, id));
}

export async function lookupSuppliersByName(
  name: string,
): Promise<Pick<Supplier, "id" | "name" | "contactPerson" | "contactNo" | "email">[]> {
  const { orgId, userId } = await requireAccess("supplier:read");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  return db
    .select({
      id: supplier.id,
      name: supplier.name,
      contactPerson: supplier.contactPerson,
      contactNo: supplier.contactNo,
      email: supplier.email,
    })
    .from(supplier)
    .where(and(inArray(supplier.organizationId, ownerOrgIds), ilike(supplier.name, `%${name}%`)))
    .orderBy(asc(supplier.name))
    .limit(20);
}
