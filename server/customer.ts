"use server";

import { db } from "@/db";
import { customer, customerCompany, user, member } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, ilike, or, desc, asc, inArray, isNull } from "drizzle-orm";
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

// ── Get the owner's primary org — used for mutations (create / update / delete) ──
async function getOwnerOrgId(
  userId: string,
  currentOrgId: string,
): Promise<string> {
  const [primaryOrg] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(
      and(
        eq(member.userId, userId),
        eq(member.role, "owner"),
        isNull(member.deletedAt),
      ),
    )
    .orderBy(asc(member.createdAt))
    .limit(1);

  return primaryOrg?.organizationId ?? currentOrgId;
}

// ── Get ALL org IDs the owner controls — used for list / read queries ─────────
async function getOwnerOrgIds(
  userId: string,
  currentOrgId: string,
): Promise<string[]> {
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(
      and(
        eq(member.userId, userId),
        eq(member.role, "owner"),
        isNull(member.deletedAt),
      ),
    );

  const ids = owned.map((m) => m.organizationId);
  return ids.length > 0 ? ids : [currentOrgId];
}

export type CustomerCompany = {
  id: string;
  organizationName: string | null;
  organizationAddress: string | null;
  position: string | null;
  department: string | null;
  isPrimary: boolean;
};

export async function getCustomers(search?: string) {
  const { orgId, userId } = await requireAccess("customer:read");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  const conditions = [inArray(customer.organizationId, ownerOrgIds)];

  if (search && search.trim().length > 0) {
    const q = `%${search.trim()}%`;
    conditions.push(
      or(
        ilike(customer.name, q),
        ilike(customer.email, q),
        ilike(customer.contactNo, q),
      )!,
    );
  }

  const rows = await db
    .select({
      id: customer.id,
      title: customer.title,
      name: customer.name,
      organizationId: customer.organizationId,
      contactNo: customer.contactNo,
      email: customer.email,
      createdAt: customer.createdAt,
      createdByName: user.name,
    })
    .from(customer)
    .leftJoin(user, eq(user.id, customer.createdBy))
    .where(and(...conditions))
    .orderBy(desc(customer.createdAt));

  if (rows.length === 0) return [];

  const companies = await db
    .select()
    .from(customerCompany)
    .where(
      inArray(
        customerCompany.customerId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(customerCompany.createdAt));

  return rows.map((r) => ({
    ...r,
    companies: companies.filter((c) => c.customerId === r.id) as CustomerCompany[],
  }));
}

export async function getCustomer(id: string) {
  const { orgId, userId } = await requireAccess("customer:read");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  const [row] = await db
    .select()
    .from(customer)
    .where(and(eq(customer.id, id), inArray(customer.organizationId, ownerOrgIds)))
    .limit(1);

  if (!row) return null;

  const companies = await db
    .select()
    .from(customerCompany)
    .where(eq(customerCompany.customerId, id))
    .orderBy(asc(customerCompany.createdAt));

  return { ...row, companies: companies as CustomerCompany[] };
}

export async function createCustomer(data: {
  title?: string;
  name: string;
  contactNo?: string;
  email?: string;
  companies?: {
    organizationName?: string;
    organizationAddress?: string;
    position?: string;
    department?: string;
    isPrimary?: boolean;
  }[];
}) {
  const { orgId, userId } = await requireAccess("customer:create");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const customerId = nanoid();

  const [row] = await db
    .insert(customer)
    .values({
      id: customerId,
      organizationId: ownerOrgId,
      createdBy: userId,
      title: data.title,
      name: data.name.trim(),
      contactNo: data.contactNo,
      email: data.email,
    })
    .returning();

  if (data.companies && data.companies.length > 0) {
    // If none marked as primary, mark the first one
    const hasExplicitPrimary = data.companies.some((c) => c.isPrimary);
    await db.insert(customerCompany).values(
      data.companies.map((c, i) => ({
        id: nanoid(),
        customerId,
        organizationName: c.organizationName ?? null,
        organizationAddress: c.organizationAddress ?? null,
        position: c.position ?? null,
        department: c.department ?? null,
        isPrimary: hasExplicitPrimary ? (c.isPrimary ?? false) : i === 0,
      })),
    );
  }

  return row;
}

export async function updateCustomer(
  id: string,
  data: {
    title?: string;
    name?: string;
    contactNo?: string;
    email?: string;
  },
) {
  const { orgId, userId } = await requireAccess("customer:update");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  await db
    .update(customer)
    .set({ ...data, ...(data.name ? { name: data.name.trim() } : {}), updatedAt: new Date() })
    .where(and(eq(customer.id, id), inArray(customer.organizationId, ownerOrgIds)));
}

export async function deleteCustomer(id: string) {
  const { orgId, userId } = await requireAccess("customer:delete");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  await db
    .delete(customer)
    .where(and(eq(customer.id, id), inArray(customer.organizationId, ownerOrgIds)));
}

// ── Company affiliation management ────────────────────────────────────────

export async function addCustomerCompany(
  customerId: string,
  data: {
    organizationName?: string;
    organizationAddress?: string;
    position?: string;
    department?: string;
    isPrimary?: boolean;
  },
) {
  const { orgId, userId } = await requireAccess("customer:update");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  // Verify this customer belongs to any of the owner's orgs
  const [exists] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, customerId), inArray(customer.organizationId, ownerOrgIds)))
    .limit(1);
  if (!exists) throw new Error("Customer not found");

  if (data.isPrimary) {
    // Clear any existing primary
    await db
      .update(customerCompany)
      .set({ isPrimary: false })
      .where(eq(customerCompany.customerId, customerId));
  }

  const [row] = await db
    .insert(customerCompany)
    .values({
      id: nanoid(),
      customerId,
      organizationName: data.organizationName ?? null,
      organizationAddress: data.organizationAddress ?? null,
      position: data.position ?? null,
      department: data.department ?? null,
      isPrimary: data.isPrimary ?? false,
    })
    .returning();

  return row;
}

export async function updateCustomerCompany(
  companyId: string,
  data: {
    organizationName?: string;
    organizationAddress?: string;
    position?: string;
    department?: string;
    isPrimary?: boolean;
  },
) {
  const { orgId, userId } = await requireAccess("customer:update");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  // Verify ownership via the parent customer
  const [comp] = await db
    .select({ customerId: customerCompany.customerId })
    .from(customerCompany)
    .where(eq(customerCompany.id, companyId))
    .limit(1);
  if (!comp) throw new Error("Company not found");

  const [owns] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, comp.customerId), inArray(customer.organizationId, ownerOrgIds)))
    .limit(1);
  if (!owns) throw new Error("Forbidden");

  if (data.isPrimary) {
    await db
      .update(customerCompany)
      .set({ isPrimary: false })
      .where(eq(customerCompany.customerId, comp.customerId));
  }

  await db
    .update(customerCompany)
    .set(data)
    .where(eq(customerCompany.id, companyId));
}

export async function deleteCustomerCompany(companyId: string) {
  const { orgId, userId } = await requireAccess("customer:update");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  const [comp] = await db
    .select({ customerId: customerCompany.customerId })
    .from(customerCompany)
    .where(eq(customerCompany.id, companyId))
    .limit(1);
  if (!comp) throw new Error("Company not found");

  const [owns] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, comp.customerId), inArray(customer.organizationId, ownerOrgIds)))
    .limit(1);
  if (!owns) throw new Error("Forbidden");

  await db.delete(customerCompany).where(eq(customerCompany.id, companyId));
}

export async function lookupCustomersByName(names: string[]) {
  const { orgId, userId } = await requireAccess("customer:read");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  if (!names.length) return [];

  const rows = await db
    .select({
      id: customer.id,
      name: customer.name,
    })
    .from(customer)
    .where(inArray(customer.organizationId, ownerOrgIds));

  if (rows.length === 0) return names.map((name) => ({ name, found: false, customer: null }));

  const companies = await db
    .select()
    .from(customerCompany)
    .where(
      inArray(
        customerCompany.customerId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(customerCompany.createdAt));

  return names.map((name) => {
    const cust = rows.find(
      (r) => r.name.toLowerCase().trim() === name.toLowerCase().trim(),
    );
    if (!cust) return { name, found: false, customer: null };

    const custCompanies = companies.filter((c) => c.customerId === cust.id);
    const primary = custCompanies.find((c) => c.isPrimary) ?? custCompanies[0] ?? null;

    return {
      name,
      found: true,
      customer: {
        id: cust.id,
        name: cust.name,
        department: primary?.department ?? null,
        organizationName: primary?.organizationName ?? null,
        organizationAddress: primary?.organizationAddress ?? null,
        contactNo: null as string | null,
        email: null as string | null,
      },
    };
  });
}
