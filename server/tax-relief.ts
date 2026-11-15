"use server";

import { db } from "@/db";
import { taxReliefType, employeeTaxRelief } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { ensureReliefTypes } from "@/lib/payroll/relief";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

// Tax relief types are HR's decision, gated like the rest of Payslip Settings.
async function requireHr() {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "payslip:create")) throw new Error("You don't have permission to do this");
  return { orgId };
}

export type TaxReliefInput = {
  name: string;
  defaultAmount: number;
  maxAmount: number | null;
  appliesToAll: boolean;
  linkEpf: boolean;
  isActive?: boolean;
};

function clean(d: TaxReliefInput) {
  const name = d.name?.trim();
  if (!name) throw new Error("Name is required");
  if (name.length > 60) throw new Error("Name is too long");
  if (!(d.defaultAmount >= 0)) throw new Error("Invalid default amount");
  if (d.maxAmount !== null && !(d.maxAmount >= 0)) throw new Error("Invalid maximum");
  return {
    name,
    defaultAmount: String(d.defaultAmount),
    maxAmount: d.maxAmount === null ? null : String(d.maxAmount),
    appliesToAll: !!d.appliesToAll,
    linkEpf: !!d.linkEpf,
  };
}

export async function getTaxReliefTypes() {
  const { orgId } = await requireHr();
  await ensureReliefTypes(orgId);
  return db.select().from(taxReliefType).where(eq(taxReliefType.organizationId, orgId)).orderBy(asc(taxReliefType.sortOrder), asc(taxReliefType.name));
}

export async function createTaxReliefType(data: TaxReliefInput) {
  const { orgId } = await requireHr();
  const c = clean(data);
  const existing = await db.select({ name: taxReliefType.name }).from(taxReliefType).where(eq(taxReliefType.organizationId, orgId));
  if (existing.some((e) => e.name.toLowerCase() === c.name.toLowerCase())) throw new Error("A relief with this name already exists");
  await db.insert(taxReliefType).values({ id: nanoid(), organizationId: orgId, ...c, sortOrder: existing.length });
}

export async function updateTaxReliefType(id: string, data: TaxReliefInput) {
  const { orgId } = await requireHr();
  const c = clean(data);
  const others = await db.select({ id: taxReliefType.id, name: taxReliefType.name }).from(taxReliefType).where(eq(taxReliefType.organizationId, orgId));
  if (others.some((e) => e.id !== id && e.name.toLowerCase() === c.name.toLowerCase())) throw new Error("A relief with this name already exists");
  await db
    .update(taxReliefType)
    .set({ ...c, ...(data.isActive === undefined ? {} : { isActive: data.isActive }) })
    .where(and(eq(taxReliefType.id, id), eq(taxReliefType.organizationId, orgId)));
}

export async function setTaxReliefActive(id: string, isActive: boolean) {
  const { orgId } = await requireHr();
  await db.update(taxReliefType).set({ isActive }).where(and(eq(taxReliefType.id, id), eq(taxReliefType.organizationId, orgId)));
}

export async function deleteTaxReliefType(id: string) {
  const { orgId } = await requireHr();
  await db.delete(employeeTaxRelief).where(and(eq(employeeTaxRelief.reliefTypeId, id), eq(employeeTaxRelief.organizationId, orgId)));
  await db.delete(taxReliefType).where(and(eq(taxReliefType.id, id), eq(taxReliefType.organizationId, orgId)));
}
