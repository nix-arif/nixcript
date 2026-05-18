"use server";

import { db } from "@/db";
import { customer, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { eq, and, ilike, or, desc } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
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

export async function getCustomers(search?: string) {
  const { orgId } = await requireAccess("customer:read");

  const conditions = [eq(customer.organizationId, orgId)];

  if (search && search.trim().length > 0) {
    const q = `%${search.trim()}%`;
    conditions.push(
      or(
        ilike(customer.name, q),
        ilike(customer.organizationName, q),
        ilike(customer.email, q),
        ilike(customer.department, q),
        ilike(customer.position, q),
        ilike(customer.contactNo, q),
      )!,
    );
  }

  const rows = await db
    .select({
      id: customer.id,
      title: customer.title,
      name: customer.name,
      position: customer.position,
      department: customer.department,
      contactNo: customer.contactNo,
      email: customer.email,
      organizationName: customer.organizationName,
      organizationAddress: customer.organizationAddress,
      createdAt: customer.createdAt,
      createdByName: user.name,
    })
    .from(customer)
    .leftJoin(user, eq(user.id, customer.createdBy))
    .where(and(...conditions))
    .orderBy(desc(customer.createdAt));

  return rows;
}

export async function getCustomer(id: string) {
  const { orgId } = await requireAccess("customer:read");

  const [row] = await db
    .select()
    .from(customer)
    .where(and(eq(customer.id, id), eq(customer.organizationId, orgId)))
    .limit(1);

  return row ?? null;
}

export async function createCustomer(data: {
  title?: string;
  name: string;
  position?: string;
  department?: string;
  contactNo?: string;
  email?: string;
  organizationName?: string;
  organizationAddress?: string;
}) {
  const { orgId, userId } = await requireAccess("customer:create");

  const [row] = await db
    .insert(customer)
    .values({ id: nanoid(), organizationId: orgId, createdBy: userId, ...data })
    .returning();

  return row;
}

export async function updateCustomer(
  id: string,
  data: {
    title?: string;
    name?: string;
    position?: string;
    department?: string;
    contactNo?: string;
    email?: string;
    organizationName?: string;
    organizationAddress?: string;
  },
) {
  const { orgId } = await requireAccess("customer:update");

  await db
    .update(customer)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(customer.id, id), eq(customer.organizationId, orgId)));
}

export async function deleteCustomer(id: string) {
  const { orgId } = await requireAccess("customer:delete");

  await db
    .delete(customer)
    .where(and(eq(customer.id, id), eq(customer.organizationId, orgId)));
}
