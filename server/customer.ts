"use server";

import { db } from "@/db";
import {
  customer,
  customerCompany,
  customerOrganization,
  user,
  member,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, ilike, or, desc, asc, inArray, sql } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

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

// ── Public types ──────────────────────────────────────────────────────────────

export type CustomerCompany = {
  id: string;
  organizationName: string | null;
  organizationAddress: string | null;
  position: string | null;
  department: string | null;
  isPrimary: boolean;
};

export type CustomerOrgMembership = {
  id: string;
  customerOrganizationId: string;
  orgName: string;
  orgAddress: string | null;
  position: string | null;
  department: string | null;
  isPrimary: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getMembershipsForCustomers(
  customerIds: string[],
): Promise<CustomerOrgMembership[]> {
  if (customerIds.length === 0) return [];

  const rows = await db
    .select({
      id: customerCompany.id,
      customerId: customerCompany.customerId,
      customerOrganizationId: customerCompany.customerOrganizationId,
      orgName: customerOrganization.name,
      orgAddress: customerOrganization.address,
      position: customerCompany.position,
      department: customerCompany.department,
      isPrimary: customerCompany.isPrimary,
      createdAt: customerCompany.createdAt,
    })
    .from(customerCompany)
    .innerJoin(
      customerOrganization,
      eq(customerOrganization.id, customerCompany.customerOrganizationId),
    )
    .where(inArray(customerCompany.customerId, customerIds))
    .orderBy(asc(customerCompany.createdAt));

  return rows as (CustomerOrgMembership & { customerId: string })[];
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getCustomers(search?: string) {
  const { orgId } = await requireAccess("customer:read");
  const orgIds = await getOwnerOrgIds(orgId);
  const conditions = [inArray(customer.organizationId, orgIds)];

  if (search && search.trim().length > 0) {
    const q = `%${search.trim()}%`;

    // Find customers that have a matching org membership
    const matchingMemberships = await db
      .select({ customerId: customerCompany.customerId })
      .from(customerCompany)
      .innerJoin(
        customerOrganization,
        eq(customerOrganization.id, customerCompany.customerOrganizationId),
      )
      .where(ilike(customerOrganization.name, q));
    const matchingIds = [...new Set(matchingMemberships.map((c) => c.customerId))];

    const orClauses: ReturnType<typeof ilike>[] = [
      ilike(customer.name, q),
      ilike(customer.email, q),
      ilike(customer.contactNo, q),
    ];
    if (matchingIds.length > 0) orClauses.push(inArray(customer.id, matchingIds) as any);

    conditions.push(or(...orClauses)!);
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

  const allMemberships = await getMembershipsForCustomers(rows.map((r) => r.id)) as (CustomerOrgMembership & { customerId: string })[];

  return rows.map((r) => ({
    ...r,
    memberships: allMemberships.filter((m) => m.customerId === r.id) as CustomerOrgMembership[],
    // legacy compat — keep companies pointing at memberships reshaped
    companies: allMemberships
      .filter((m) => m.customerId === r.id)
      .map((m) => ({
        id: m.id,
        organizationName: m.orgName,
        organizationAddress: m.orgAddress,
        position: m.position,
        department: m.department,
        isPrimary: m.isPrimary,
      })) as CustomerCompany[],
  }));
}

export async function getCustomer(id: string) {
  const { orgId } = await requireAccess("customer:read");
  const orgIds = await getOwnerOrgIds(orgId);

  const [row] = await db
    .select()
    .from(customer)
    .where(and(eq(customer.id, id), inArray(customer.organizationId, orgIds)))
    .limit(1);

  if (!row) return null;

  const memberships = await getMembershipsForCustomers([id]) as (CustomerOrgMembership & { customerId: string })[];

  return {
    ...row,
    memberships: memberships as CustomerOrgMembership[],
    companies: memberships.map((m) => ({
      id: m.id,
      organizationName: m.orgName,
      organizationAddress: m.orgAddress,
      position: m.position,
      department: m.department,
      isPrimary: m.isPrimary,
    })) as CustomerCompany[],
  };
}

export async function createCustomer(data: {
  title?: string;
  name: string;
  contactNo?: string;
  email?: string;
  companies?: {
    orgName?: string;
    organizationName?: string; // legacy alias
    organizationAddress?: string;
    position?: string;
    department?: string;
    isPrimary?: boolean;
  }[];
}) {
  const { orgId, userId } = await requireAccess("customer:create");

  const customerId = nanoid();

  const [row] = await db
    .insert(customer)
    .values({
      id: customerId,
      organizationId: orgId,
      createdBy: userId,
      title: data.title,
      name: data.name.trim(),
      contactNo: data.contactNo,
      email: data.email,
    })
    .returning();

  if (data.companies && data.companies.length > 0) {
    const hasExplicitPrimary = data.companies.some((c) => c.isPrimary);
    for (let i = 0; i < data.companies.length; i++) {
      const c = data.companies[i];
      const name = (c.orgName ?? c.organizationName ?? "").trim();
      if (!name) continue;

      // Upsert: find by name+orgId or insert
      const [existing] = await db
        .select({ id: customerOrganization.id })
        .from(customerOrganization)
        .where(
          and(
            eq(customerOrganization.organizationId, orgId),
            sql`LOWER(TRIM(${customerOrganization.name})) = LOWER(TRIM(${name}))`,
          ),
        )
        .limit(1);

      let customerOrgId: string;
      if (existing) {
        customerOrgId = existing.id;
      } else {
        const [newOrg] = await db
          .insert(customerOrganization)
          .values({
            id: nanoid(),
            organizationId: orgId,
            name,
            address: c.organizationAddress ?? null,
          })
          .returning({ id: customerOrganization.id });
        customerOrgId = newOrg.id;
      }

      await db.insert(customerCompany).values({
        id: nanoid(),
        customerId,
        customerOrganizationId: customerOrgId,
        position: c.position ?? null,
        department: c.department ?? null,
        isPrimary: hasExplicitPrimary ? (c.isPrimary ?? false) : i === 0,
      });
    }
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
  const { orgId } = await requireAccess("customer:update");

  await db
    .update(customer)
    .set({ ...data, ...(data.name ? { name: data.name.trim() } : {}), updatedAt: new Date() })
    .where(and(eq(customer.id, id), eq(customer.organizationId, orgId)));
}

export async function deleteCustomer(id: string) {
  const { orgId } = await requireAccess("customer:delete");

  await db
    .delete(customer)
    .where(and(eq(customer.id, id), eq(customer.organizationId, orgId)));
}

// ── Org entity management ─────────────────────────────────────────────────────

export async function getCustomerOrganizations() {
  const { orgId } = await requireAccess("customer:read");
  const orgIds = await getOwnerOrgIds(orgId);

  const orgs = await db
    .select({
      id: customerOrganization.id,
      name: customerOrganization.name,
      address: customerOrganization.address,
      phone: customerOrganization.phone,
      email: customerOrganization.email,
      createdAt: customerOrganization.createdAt,
    })
    .from(customerOrganization)
    .where(inArray(customerOrganization.organizationId, orgIds))
    .orderBy(asc(customerOrganization.name));

  if (orgs.length === 0) return [];

  const counts = await db
    .select({
      customerOrganizationId: customerCompany.customerOrganizationId,
      memberCount: sql<number>`cast(count(*) as int)`,
    })
    .from(customerCompany)
    .where(inArray(customerCompany.customerOrganizationId, orgs.map((o) => o.id)))
    .groupBy(customerCompany.customerOrganizationId);

  const countMap = Object.fromEntries(counts.map((c) => [c.customerOrganizationId, c.memberCount]));
  return orgs.map((o) => ({ ...o, memberCount: countMap[o.id] ?? 0 }));
}

export async function getCustomerOrganizationWithMembers(id: string) {
  const { orgId } = await requireAccess("customer:read");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const [org] = await db
    .select()
    .from(customerOrganization)
    .where(and(eq(customerOrganization.id, id), inArray(customerOrganization.organizationId, ownerOrgIds)))
    .limit(1);
  if (!org) return null;

  const members = await db
    .select({
      membershipId: customerCompany.id,
      customerId: customerCompany.customerId,
      position: customerCompany.position,
      department: customerCompany.department,
      isPrimary: customerCompany.isPrimary,
      customerTitle: customer.title,
      customerName: customer.name,
      customerEmail: customer.email,
      customerContactNo: customer.contactNo,
    })
    .from(customerCompany)
    .innerJoin(customer, eq(customer.id, customerCompany.customerId))
    .where(eq(customerCompany.customerOrganizationId, id))
    .orderBy(asc(customer.name));

  return { ...org, members };
}

export async function searchCustomerOrganizations(
  query: string,
): Promise<{ id: string; name: string; address: string | null }[]> {
  const { orgId } = await requireAccess("customer:read");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  if (!query.trim()) {
    return db
      .select({ id: customerOrganization.id, name: customerOrganization.name, address: customerOrganization.address })
      .from(customerOrganization)
      .where(inArray(customerOrganization.organizationId, ownerOrgIds))
      .orderBy(desc(customerOrganization.createdAt))
      .limit(20);
  }
  return db
    .select({ id: customerOrganization.id, name: customerOrganization.name, address: customerOrganization.address })
    .from(customerOrganization)
    .where(
      and(
        inArray(customerOrganization.organizationId, ownerOrgIds),
        ilike(customerOrganization.name, `%${query.trim()}%`),
      ),
    )
    .orderBy(asc(customerOrganization.name))
    .limit(20);
}

export async function createCustomerOrganization(data: {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
}): Promise<{ row: typeof customerOrganization.$inferSelect; existed: boolean }> {
  const { orgId } = await requireAccess("customer:update");

  const trimmedName = data.name.trim();
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  // Case-insensitive duplicate check across all owner tenants
  const [existing] = await db
    .select()
    .from(customerOrganization)
    .where(
      and(
        inArray(customerOrganization.organizationId, ownerOrgIds),
        ilike(customerOrganization.name, trimmedName),
      ),
    )
    .limit(1);

  if (existing) return { row: existing, existed: true };

  const [row] = await db
    .insert(customerOrganization)
    .values({
      id: nanoid(),
      organizationId: orgId,
      name: trimmedName,
      address: data.address ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
    })
    .returning();

  return { row, existed: false };
}

async function getOwnerOrgIds(orgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerMember) return [orgId];
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")));
  const ids = [...new Set(owned.map((m) => m.organizationId))];
  return ids.length > 0 ? ids : [orgId];
}

export async function updateCustomerOrganization(
  id: string,
  data: { name?: string; address?: string; phone?: string; email?: string },
) {
  const { orgId } = await requireAccess("customer:update");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const [existing] = await db
    .select({ id: customerOrganization.id })
    .from(customerOrganization)
    .where(and(eq(customerOrganization.id, id), inArray(customerOrganization.organizationId, ownerOrgIds)))
    .limit(1);
  if (!existing) throw new Error("Organization not found");

  await db
    .update(customerOrganization)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customerOrganization.id, id));
}

export async function deleteCustomerOrganization(id: string) {
  const { orgId } = await requireAccess("customer:update");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const [existing] = await db
    .select({ id: customerOrganization.id })
    .from(customerOrganization)
    .where(and(eq(customerOrganization.id, id), inArray(customerOrganization.organizationId, ownerOrgIds)))
    .limit(1);
  if (!existing) throw new Error("Organization not found");

  await db.delete(customerOrganization).where(eq(customerOrganization.id, id));
}

// ── Membership management ─────────────────────────────────────────────────────

export async function addCustomerOrgMembership(
  customerId: string,
  customerOrganizationId: string,
  data: { position?: string; department?: string; isPrimary?: boolean },
) {
  const { orgId } = await requireAccess("customer:update");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  // Verify customer belongs to the tenant
  const [exists] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, customerId), inArray(customer.organizationId, ownerOrgIds)))
    .limit(1);
  if (!exists) throw new Error("Customer not found");

  // Verify org belongs to the same tenant
  const [orgExists] = await db
    .select({ id: customerOrganization.id })
    .from(customerOrganization)
    .where(
      and(
        eq(customerOrganization.id, customerOrganizationId),
        inArray(customerOrganization.organizationId, ownerOrgIds),
      ),
    )
    .limit(1);
  if (!orgExists) throw new Error("Organization not found");

  if (data.isPrimary) {
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
      customerOrganizationId,
      position: data.position ?? null,
      department: data.department ?? null,
      isPrimary: data.isPrimary ?? false,
    })
    .returning();

  return row;
}

export async function updateCustomerOrgMembership(
  membershipId: string,
  data: { position?: string; department?: string; isPrimary?: boolean },
) {
  const { orgId } = await requireAccess("customer:update");

  const [mem] = await db
    .select({ customerId: customerCompany.customerId })
    .from(customerCompany)
    .where(eq(customerCompany.id, membershipId))
    .limit(1);
  if (!mem) throw new Error("Membership not found");

  const [owns] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, mem.customerId), eq(customer.organizationId, orgId)))
    .limit(1);
  if (!owns) throw new Error("You don't have permission to do this");

  if (data.isPrimary) {
    await db
      .update(customerCompany)
      .set({ isPrimary: false })
      .where(eq(customerCompany.customerId, mem.customerId));
  }

  await db
    .update(customerCompany)
    .set(data)
    .where(eq(customerCompany.id, membershipId));
}

export async function deleteCustomerOrgMembership(membershipId: string) {
  const { orgId } = await requireAccess("customer:update");

  const [mem] = await db
    .select({ customerId: customerCompany.customerId })
    .from(customerCompany)
    .where(eq(customerCompany.id, membershipId))
    .limit(1);
  if (!mem) throw new Error("Membership not found");

  const [owns] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, mem.customerId), eq(customer.organizationId, orgId)))
    .limit(1);
  if (!owns) throw new Error("You don't have permission to do this");

  await db
    .delete(customerCompany)
    .where(eq(customerCompany.id, membershipId));
}

// ── Legacy company management (backward-compat — kept for migration) ──────────


// ── Lookup helpers ────────────────────────────────────────────────────────────

export async function lookupCustomersByName(names: string[]) {
  const { orgId } = await requireAccess("customer:read");
  if (!names.length) return [];

  const rows = await db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(eq(customer.organizationId, orgId));

  if (rows.length === 0) return names.map((name) => ({ name, found: false, customer: null }));

  const memberships = await getMembershipsForCustomers(rows.map((r) => r.id)) as (CustomerOrgMembership & { customerId: string })[];

  return names.map((name) => {
    const cust = rows.find(
      (r) => r.name.toLowerCase().trim() === name.toLowerCase().trim(),
    );
    if (!cust) return { name, found: false, customer: null };

    const custMemberships = memberships.filter((m) => m.customerId === cust.id);
    const primary = custMemberships.find((m) => m.isPrimary) ?? custMemberships[0] ?? null;

    return {
      name,
      found: true,
      customer: {
        id: cust.id,
        name: cust.name,
        department: primary?.department ?? null,
        organizationName: primary?.orgName ?? null,
        organizationAddress: primary?.orgAddress ?? null,
        contactNo: null as string | null,
        email: null as string | null,
      },
    };
  });
}

// ── Snapshot builder ──────────────────────────────────────────────────────────
// Called by all document server functions to produce a consistent customerSnapshot.
// customerOrgMemberId: if provided, use that specific membership's org;
//   otherwise fall back to the customer's primary / first membership.

export type CustomerSnapshot = {
  title?: string;
  name: string;
  email?: string;
  contactNo?: string;
  organizationName?: string;
  organizationAddress?: string;
  position?: string;
  department?: string;
};

export async function buildCustomerSnapshot(
  customerId: string,
  customerOrgMemberId?: string | null,
): Promise<CustomerSnapshot | null> {
  const [cust] = await db
    .select()
    .from(customer)
    .where(eq(customer.id, customerId))
    .limit(1);
  if (!cust) return null;

  let membership: { orgName: string; orgAddress: string | null; position: string | null; department: string | null } | null = null;

  if (customerOrgMemberId) {
    const [row] = await db
      .select({
        orgName: customerOrganization.name,
        orgAddress: customerOrganization.address,
        position: customerCompany.position,
        department: customerCompany.department,
      })
      .from(customerCompany)
      .innerJoin(
        customerOrganization,
        eq(customerOrganization.id, customerCompany.customerOrganizationId),
      )
      .where(
        and(
          eq(customerCompany.id, customerOrgMemberId),
          eq(customerCompany.customerId, customerId),
        ),
      )
      .limit(1);
    membership = row ?? null;
  }

  if (!membership) {
    // Fall back to primary membership, then first
    const [row] = await db
      .select({
        orgName: customerOrganization.name,
        orgAddress: customerOrganization.address,
        position: customerCompany.position,
        department: customerCompany.department,
      })
      .from(customerCompany)
      .innerJoin(
        customerOrganization,
        eq(customerOrganization.id, customerCompany.customerOrganizationId),
      )
      .where(eq(customerCompany.customerId, customerId))
      .orderBy(desc(customerCompany.isPrimary), asc(customerCompany.createdAt))
      .limit(1);
    membership = row ?? null;
  }

  return {
    title: cust.title ?? undefined,
    name: cust.name,
    email: cust.email ?? undefined,
    contactNo: cust.contactNo ?? undefined,
    organizationName: membership?.orgName ?? undefined,
    organizationAddress: membership?.orgAddress ?? undefined,
    position: membership?.position ?? undefined,
    department: membership?.department ?? undefined,
  };
}
