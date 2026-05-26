"use server";

import { db } from "@/db";
import { supplier } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, ilike, asc } from "drizzle-orm";
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
  const { orgId } = await requireAccess("supplier:read");

  let query = db
    .select()
    .from(supplier)
    .where(eq(supplier.organizationId, orgId))
    .$dynamic();

  if (search) {
    query = query.where(
      and(
        eq(supplier.organizationId, orgId),
        ilike(supplier.name, `%${search}%`),
      ),
    );
  }

  return query.orderBy(asc(supplier.name));
}

export async function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  const { orgId, userId } = await requireAccess("supplier:create");

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
      createdBy: userId,
    })
    .returning();

  return row;
}

export async function updateSupplier(input: UpdateSupplierInput): Promise<Supplier> {
  const { orgId } = await requireAccess("supplier:update");
  const [check] = await db.select({ id: supplier.id }).from(supplier)
    .where(and(eq(supplier.id, input.id), eq(supplier.organizationId, orgId)));
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
  const { orgId } = await requireAccess("supplier:delete");
  const [check] = await db.select({ id: supplier.id }).from(supplier)
    .where(and(eq(supplier.id, id), eq(supplier.organizationId, orgId)));
  if (!check) throw new Error("Supplier not found");
  await db.delete(supplier).where(eq(supplier.id, id));
}

export async function lookupSuppliersByName(
  name: string,
): Promise<Pick<Supplier, "id" | "name" | "contactPerson" | "contactNo" | "email">[]> {
  const { orgId } = await requireAccess("supplier:read");

  return db
    .select({
      id: supplier.id,
      name: supplier.name,
      contactPerson: supplier.contactPerson,
      contactNo: supplier.contactNo,
      email: supplier.email,
    })
    .from(supplier)
    .where(and(eq(supplier.organizationId, orgId), ilike(supplier.name, `%${name}%`)))
    .orderBy(asc(supplier.name))
    .limit(20);
}
