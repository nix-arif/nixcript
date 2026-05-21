"use server";

import { db } from "@/db";
import { customer, user, member } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, ilike, or, desc, asc } from "drizzle-orm";
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

// ── Get the owner's primary org — all orgs under same owner share data ────
async function getOwnerOrgId(
  userId: string,
  currentOrgId: string,
): Promise<string> {
  // Find the owner of the current org
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")),
    )
    .limit(1);

  if (!ownerMember) return currentOrgId;

  // Find the owner's earliest org (primary org)
  const [primaryOrg] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);

  return primaryOrg?.organizationId ?? currentOrgId;
}

export async function getCustomers(search?: string) {
  const { orgId, userId } = await requireAccess("customer:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const conditions = [eq(customer.organizationId, ownerOrgId)];

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
  const { orgId, userId } = await requireAccess("customer:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [row] = await db
    .select()
    .from(customer)
    .where(and(eq(customer.id, id), eq(customer.organizationId, ownerOrgId)))
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
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [row] = await db
    .insert(customer)
    .values({
      id: nanoid(),
      organizationId: ownerOrgId, // ← store under owner org
      createdBy: userId,
      ...data,
    })
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
  const { orgId, userId } = await requireAccess("customer:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  await db
    .update(customer)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(customer.id, id), eq(customer.organizationId, ownerOrgId)));
}

export async function deleteCustomer(id: string) {
  const { orgId, userId } = await requireAccess("customer:delete");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  await db
    .delete(customer)
    .where(and(eq(customer.id, id), eq(customer.organizationId, ownerOrgId)));
}

export async function lookupCustomersByName(names: string[]) {
  const { orgId, userId } = await requireAccess("customer:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  if (!names.length) return [];

  const rows = await db
    .select({
      id: customer.id,
      name: customer.name,
      department: customer.department,
      organizationName: customer.organizationName,
      organizationAddress: customer.organizationAddress,
      contactNo: customer.contactNo,
      email: customer.email,
    })
    .from(customer)
    .where(eq(customer.organizationId, ownerOrgId));

  return names.map((name) => {
    const found = rows.find(
      (r) => r.name.toLowerCase().trim() === name.toLowerCase().trim(),
    );
    return { name, found: !!found, customer: found ?? null };
  });
}
