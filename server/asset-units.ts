"use server";

import { db } from "@/db";
import { assetUnit, member, product, stockMovement, user, customer } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { ASSET_UNIT_STATUS } from "@/lib/inventory/constants";
import { nanoid } from "nanoid";
import { eq, and, desc, inArray, isNull, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Forbidden");
  return { orgId, userId: session.user.id };
}

// Every org owned by the same owner as orgId — same "owner org group"
// pattern duplicated across server/inventory.ts, server/supplier.ts,
// server/field-stock.ts, server/delivery-order.ts, server/document-category.ts etc.
async function getOwnerOrgIds(orgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .limit(1);
  if (!ownerMember) return [orgId];
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner"), isNull(member.deletedAt)));
  const ids = [...new Set(owned.map((m) => m.organizationId))];
  return ids.length > 0 ? ids : [orgId];
}

export type AssetUnitRow = typeof assetUnit.$inferSelect;

export interface AssetUnitListRow extends AssetUnitRow {
  productCode: string;
  productDescription: string | null;
  holderName: string | null;
  customerName: string | null;
}

export interface RegisterAssetUnitInput {
  productId: string;
  serialNo: string;
  status: string; // ASSET_UNIT_STATUS.*
  warehouseLabel?: string; // when IN_STOCK / IN_REPAIR
  repId?: string; // when WITH_REP / ON_LOAN
  customerId?: string; // when SOLD / ON_LOAN
  notes?: string;
}

export async function registerAssetUnit(input: RegisterAssetUnitInput): Promise<AssetUnitRow> {
  const { orgId, userId } = await requireAccess("inventory:manage");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const serialNo = input.serialNo.trim();
  if (!serialNo) throw new Error("Serial number is required");

  const [existing] = await db
    .select({ id: assetUnit.id })
    .from(assetUnit)
    .where(and(
      eq(assetUnit.productId, input.productId),
      eq(assetUnit.serialNo, serialNo),
      inArray(assetUnit.organizationId, ownerOrgIds),
    ))
    .limit(1);
  if (existing) throw new Error(`Serial number "${serialNo}" is already registered for this product`);

  const isFieldHeld = input.status === ASSET_UNIT_STATUS.WITH_REP || input.status === ASSET_UNIT_STATUS.ON_LOAN;

  const [row] = await db
    .insert(assetUnit)
    .values({
      id: nanoid(),
      organizationId: orgId,
      productId: input.productId,
      serialNo,
      status: input.status,
      currentOrgId: orgId,
      currentWarehouseLabel: isFieldHeld ? null : (input.warehouseLabel ?? "Default"),
      currentHolderUserId: isFieldHeld ? (input.repId ?? null) : null,
      currentCustomerId: input.customerId ?? null,
      referenceType: "MANUAL",
      notes: input.notes ?? null,
      registeredBy: userId,
    })
    .returning();

  revalidatePath("/dashboard/inventory/serialized-units");
  return row;
}

export interface AssetUnitFilters {
  productId?: string;
  status?: string;
  search?: string; // serial number contains
}

export async function listAssetUnits(filters: AssetUnitFilters = {}): Promise<AssetUnitListRow[]> {
  const { orgId } = await requireAccess("inventory:read");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const conditions = [inArray(assetUnit.organizationId, ownerOrgIds)];
  if (filters.productId) conditions.push(eq(assetUnit.productId, filters.productId));
  if (filters.status) conditions.push(eq(assetUnit.status, filters.status));
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    conditions.push(or(ilike(assetUnit.serialNo, q), ilike(product.productCode, q))!);
  }

  const rows = await db
    .select({
      unit: assetUnit,
      productCode: product.productCode,
      productDescription: product.description,
      holderName: user.name,
      customerName: customer.name,
    })
    .from(assetUnit)
    .innerJoin(product, eq(assetUnit.productId, product.id))
    .leftJoin(user, eq(assetUnit.currentHolderUserId, user.id))
    .leftJoin(customer, eq(assetUnit.currentCustomerId, customer.id))
    .where(and(...conditions))
    .orderBy(desc(assetUnit.updatedAt));

  return rows.map((r) => ({
    ...r.unit,
    productCode: r.productCode,
    productDescription: r.productDescription,
    holderName: r.holderName,
    customerName: r.customerName,
  }));
}

export async function getAssetUnitHistory(unitId: string) {
  const { orgId } = await requireAccess("inventory:read");
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  return db
    .select()
    .from(stockMovement)
    .where(and(eq(stockMovement.unitId, unitId), inArray(stockMovement.organizationId, ownerOrgIds)))
    .orderBy(desc(stockMovement.createdAt));
}

// Entry point for returning a loaned-out unit — looks up its most recent
// LOAN_OUT movement and delegates to returnRentalItems (server/delivery-order.ts),
// which nets the qty back and (per its own logic) transitions the unit
// ON_LOAN → WITH_REP when that movement carries a unitId.
export async function markAssetUnitReturned(unitId: string): Promise<void> {
  const { orgId } = await requireAccess("inventory:manage");
  const ownerOrgIds = await getOwnerOrgIds(orgId);

  const [unitRow] = await db
    .select()
    .from(assetUnit)
    .where(and(eq(assetUnit.id, unitId), inArray(assetUnit.organizationId, ownerOrgIds)))
    .limit(1);
  if (!unitRow) throw new Error("Unit not found");
  if (unitRow.status !== ASSET_UNIT_STATUS.ON_LOAN) throw new Error("This unit is not currently on loan");

  const [loanMovement] = await db
    .select()
    .from(stockMovement)
    .where(and(
      eq(stockMovement.unitId, unitId),
      eq(stockMovement.movementType, "LOAN_OUT"),
      inArray(stockMovement.organizationId, ownerOrgIds),
    ))
    .orderBy(desc(stockMovement.createdAt))
    .limit(1);
  if (!loanMovement || !loanMovement.referenceId) throw new Error("Could not find the original loan-out movement for this unit");

  const { returnRentalItems } = await import("@/server/delivery-order");
  await returnRentalItems(loanMovement.referenceId, [{ movementId: loanMovement.id, returnQty: 1 }]);

  revalidatePath("/dashboard/inventory/serialized-units");
}
