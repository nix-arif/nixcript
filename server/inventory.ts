"use server";

import { db } from "@/db";
import { stockLevel, stockMovement, product, user, organizationProfile, member } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, ilike, or, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";

/* =========================
   TYPES
========================= */

export type StockLevelRow    = typeof stockLevel.$inferSelect;
export type StockMovementRow = typeof stockMovement.$inferSelect;

export type StockWithProduct = StockLevelRow & {
  productCode: string;
  description: string | null;
  uom: string | null;
  availableQty: number;
  isLowStock: boolean;
};

export type MovementWithMeta = StockMovementRow & {
  createdByName: string | null;
};

export type Warehouse = { label: string; address: string };

/* =========================
   HELPERS
========================= */

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId };
}

async function getAllOwnerOrgIds(currentOrgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .limit(1);

  if (!ownerMember) return [currentOrgId];

  const ownedOrgs = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner"), isNull(member.deletedAt)));

  const ids = ownedOrgs.map((o) => o.organizationId);
  return ids.length ? ids : [currentOrgId];
}

/* =========================
   QUERIES
========================= */

export async function getWarehouses(): Promise<Warehouse[]> {
  const { orgId } = await requireAccess("inventory:read");
  const [profile] = await db
    .select({ warehouseAddresses: organizationProfile.warehouseAddresses })
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId))
    .limit(1);
  const addresses = (profile?.warehouseAddresses as Warehouse[] | null) ?? [];
  const valid = addresses.filter(w => w.label?.trim());
  if (valid.length === 0) return [{ label: "Default", address: "" }];
  return valid;
}

export async function getInventory(): Promise<StockWithProduct[]> {
  const { orgId } = await requireAccess("inventory:read");

  const rows = await db
    .select({
      sl: stockLevel,
      productCode: product.productCode,
      description: product.description,
      uom: product.uom,
    })
    .from(stockLevel)
    .innerJoin(product, eq(stockLevel.productId, product.id))
    .where(eq(stockLevel.organizationId, orgId))
    .orderBy(asc(stockLevel.warehouseLabel), asc(product.productCode));

  return rows.map(({ sl, productCode, description, uom }) => {
    const qty      = parseFloat(sl.quantity);
    const reserved = parseFloat(sl.reservedQty);
    const reorder  = sl.reorderPoint ? parseFloat(sl.reorderPoint) : null;
    return {
      ...sl,
      productCode,
      description,
      uom,
      availableQty: qty - reserved,
      isLowStock: reorder !== null && qty <= reorder,
    };
  });
}

export async function getStockMovements(productId?: string): Promise<MovementWithMeta[]> {
  const { orgId } = await requireAccess("inventory:read");

  const rows = await db
    .select({ sm: stockMovement, createdByName: user.name })
    .from(stockMovement)
    .leftJoin(user, eq(stockMovement.createdBy, user.id))
    .where(
      and(
        eq(stockMovement.organizationId, orgId),
        productId ? eq(stockMovement.productId, productId) : undefined,
      ),
    )
    .orderBy(desc(stockMovement.createdAt))
    .limit(200);

  return rows.map(({ sm, createdByName }) => ({ ...sm, createdByName }));
}

export async function getPendingMovements(): Promise<MovementWithMeta[]> {
  const { orgId } = await requireAccess("inventory:approve");
  const rows = await db
    .select({ sm: stockMovement, createdByName: user.name })
    .from(stockMovement)
    .leftJoin(user, eq(stockMovement.createdBy, user.id))
    .where(and(eq(stockMovement.organizationId, orgId), eq(stockMovement.status, "PENDING")))
    .orderBy(desc(stockMovement.createdAt));
  return rows.map(({ sm, createdByName }) => ({ ...sm, createdByName }));
}

/* =========================
   MUTATIONS
========================= */

// Creates a PENDING movement — does NOT update stock level yet
export async function adjustStock(data: {
  productId: string;
  warehouseLabel: string;
  movementType: string;
  quantity: number;
  unitCost?: string;
  referenceType?: string;
  referenceNo?: string;
  notes?: string;
  lotNo?: string;
  expiryDate?: Date;
}): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:adjust");

  if (data.quantity === 0) throw new Error("Quantity cannot be zero");

  const [prod] = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(eq(product.id, data.productId), eq(product.organizationId, orgId)))
    .limit(1);
  if (!prod) throw new Error("Product not found");

  const isOut = data.movementType === MOVEMENT_TYPE.STOCK_OUT;
  const signed = isOut ? -Math.abs(data.quantity) : Math.abs(data.quantity);

  await db.insert(stockMovement).values({
    id: nanoid(),
    organizationId: orgId,
    productId: data.productId,
    productCode: prod.productCode,
    warehouseLabel: data.warehouseLabel,
    warehouseTo: null,
    movementType: data.movementType,
    quantity: signed.toFixed(4),
    balanceAfter: null,          // set at approval time
    unitCost: data.unitCost?.trim() || null,
    referenceType: data.referenceType ?? REF_TYPE.MANUAL,
    referenceId: null,
    referenceNo: data.referenceNo?.trim() || null,
    notes: data.notes?.trim() || null,
    lotNo: data.lotNo?.trim() || null,
    expiryDate: data.expiryDate ?? null,
    status: "PENDING",
    createdBy: userId,
    createdAt: new Date(),
  });

  revalidatePath("/dashboard/inventory");
}

// Creates a PENDING transfer — does NOT move stock yet
export async function transferStock(data: {
  productId: string;
  fromWarehouse: string;
  toWarehouse: string;
  quantity: number;
  notes?: string;
}): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:adjust");

  if (data.quantity <= 0) throw new Error("Quantity must be greater than zero");
  if (data.fromWarehouse === data.toWarehouse) throw new Error("Source and destination warehouses must differ");

  const [prod] = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(eq(product.id, data.productId), eq(product.organizationId, orgId)))
    .limit(1);
  if (!prod) throw new Error("Product not found");

  const now = new Date();
  await db.insert(stockMovement).values([
    { id: nanoid(), organizationId: orgId, productId: data.productId, productCode: prod.productCode, warehouseLabel: data.fromWarehouse, warehouseTo: data.toWarehouse, movementType: MOVEMENT_TYPE.TRANSFER, quantity: (-data.quantity).toFixed(4), balanceAfter: null, unitCost: null, referenceType: REF_TYPE.MANUAL, referenceId: null, referenceNo: null, notes: data.notes?.trim() || null, status: "PENDING", createdBy: userId, createdAt: now },
    { id: nanoid(), organizationId: orgId, productId: data.productId, productCode: prod.productCode, warehouseLabel: data.toWarehouse, warehouseTo: null, movementType: MOVEMENT_TYPE.TRANSFER, quantity: data.quantity.toFixed(4), balanceAfter: null, unitCost: null, referenceType: REF_TYPE.MANUAL, referenceId: null, referenceNo: null, notes: data.notes?.trim() || null, status: "PENDING", createdBy: userId, createdAt: now },
  ]);

  revalidatePath("/dashboard/inventory");
}

// Applies the movement to stock level and marks APPROVED
export async function approveStockMovement(movementId: string, comment?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:approve");

  const [mv] = await db
    .select()
    .from(stockMovement)
    .where(and(eq(stockMovement.id, movementId), eq(stockMovement.organizationId, orgId)))
    .limit(1);

  if (!mv) throw new Error("Movement not found");
  if (mv.status !== "PENDING") throw new Error("Only pending movements can be approved");

  const signed = parseFloat(mv.quantity);

  // Upsert stock level
  const [existing] = await db
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, mv.productId), eq(stockLevel.organizationId, orgId), eq(stockLevel.warehouseLabel, mv.warehouseLabel)))
    .limit(1);

  let newBalance: number;
  if (existing) {
    newBalance = parseFloat(existing.quantity) + signed;
    if (newBalance < 0) throw new Error(`Insufficient stock in ${mv.warehouseLabel} — cannot approve`);
    await db.update(stockLevel).set({ quantity: newBalance.toFixed(4), updatedAt: new Date() }).where(eq(stockLevel.id, existing.id));
  } else {
    newBalance = signed;
    if (newBalance < 0) throw new Error(`Insufficient stock in ${mv.warehouseLabel} — cannot approve`);
    await db.insert(stockLevel).values({ id: nanoid(), organizationId: orgId, productId: mv.productId, warehouseLabel: mv.warehouseLabel, quantity: newBalance.toFixed(4), reservedQty: "0", updatedAt: new Date() });
  }

  await db.update(stockMovement)
    .set({ status: "APPROVED", balanceAfter: newBalance.toFixed(4), reviewedBy: userId, reviewedAt: new Date(), reviewComment: comment?.trim() || null })
    .where(eq(stockMovement.id, movementId));

  revalidatePath("/dashboard/inventory");
}

export async function rejectStockMovement(movementId: string, reason: string): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:approve");
  if (!reason.trim()) throw new Error("Rejection reason is required");

  const [mv] = await db
    .select({ status: stockMovement.status })
    .from(stockMovement)
    .where(and(eq(stockMovement.id, movementId), eq(stockMovement.organizationId, orgId)))
    .limit(1);

  if (!mv) throw new Error("Movement not found");
  if (mv.status !== "PENDING") throw new Error("Only pending movements can be rejected");

  await db.update(stockMovement)
    .set({ status: "REJECTED", reviewedBy: userId, reviewedAt: new Date(), reviewComment: reason.trim() })
    .where(eq(stockMovement.id, movementId));

  revalidatePath("/dashboard/inventory");
}

export async function setReorderPoint(
  productId: string,
  warehouseLabel: string,
  reorderPoint: string | null,
  maxStock: string | null,
): Promise<void> {
  const { orgId } = await requireAccess("inventory:manage");

  const [existing] = await db
    .select({ id: stockLevel.id })
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, productId), eq(stockLevel.organizationId, orgId), eq(stockLevel.warehouseLabel, warehouseLabel)))
    .limit(1);

  if (existing) {
    await db.update(stockLevel).set({ reorderPoint: reorderPoint ?? null, maxStock: maxStock ?? null, updatedAt: new Date() }).where(eq(stockLevel.id, existing.id));
  } else {
    await db.insert(stockLevel).values({ id: nanoid(), organizationId: orgId, productId, warehouseLabel, quantity: "0", reservedQty: "0", reorderPoint: reorderPoint ?? null, maxStock: maxStock ?? null, updatedAt: new Date() });
  }
  revalidatePath("/dashboard/inventory");
}

export async function getProductsByCode(
  codes: string[],
): Promise<{ productCode: string; id: string; description: string | null; uom: string | null }[]> {
  if (codes.length === 0) return [];
  const { orgId } = await requireAccess("inventory:read");
  return db
    .select({ id: product.id, productCode: product.productCode, description: product.description, uom: product.uom })
    .from(product)
    .where(and(eq(product.organizationId, orgId), inArray(product.productCode, codes)));
}

export async function searchProducts(query: string) {
  const { orgId } = await requireAccess("inventory:read");
  if (!query.trim()) return [];
  const orgIds = await getAllOwnerOrgIds(orgId);
  return db
    .select({ id: product.id, productCode: product.productCode, description: product.description, uom: product.uom })
    .from(product)
    .where(and(
      inArray(product.organizationId, orgIds),
      or(
        ilike(product.productCode, `%${query}%`),
        ilike(product.description, `%${query}%`),
      ),
    ))
    .orderBy(asc(product.productCode))
    .limit(50);
}
