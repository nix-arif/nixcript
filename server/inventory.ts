"use server";

import { db } from "@/db";
import { stockLevel, stockMovement, product, user } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, desc, asc } from "drizzle-orm";
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

/* =========================
   HELPERS
========================= */

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Forbidden");
  return { orgId, userId };
}

/* =========================
   QUERIES
========================= */

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
    .orderBy(asc(product.productCode));

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

/* =========================
   MUTATIONS
========================= */

export async function adjustStock(data: {
  productId: string;
  movementType: string;
  quantity: number;
  unitCost?: string;
  referenceType?: string;
  referenceNo?: string;
  notes?: string;
}): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:adjust");

  if (data.quantity === 0) throw new Error("Quantity cannot be zero");

  const [prod] = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(eq(product.id, data.productId), eq(product.organizationId, orgId)))
    .limit(1);
  if (!prod) throw new Error("Product not found");

  // Signed quantity: OUT movements are negative
  const isOut = [MOVEMENT_TYPE.STOCK_OUT].includes(data.movementType as never);
  const signed = isOut ? -Math.abs(data.quantity) : Math.abs(data.quantity);

  // Upsert stock level
  const existing = await db
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, data.productId), eq(stockLevel.organizationId, orgId)))
    .limit(1);

  let newBalance: number;
  if (existing[0]) {
    newBalance = parseFloat(existing[0].quantity) + signed;
    if (newBalance < 0) throw new Error("Insufficient stock — balance would go negative");
    await db
      .update(stockLevel)
      .set({ quantity: newBalance.toFixed(4), updatedAt: new Date() })
      .where(eq(stockLevel.id, existing[0].id));
  } else {
    newBalance = signed;
    if (newBalance < 0) throw new Error("Insufficient stock — balance would go negative");
    await db.insert(stockLevel).values({
      id: nanoid(),
      organizationId: orgId,
      productId: data.productId,
      quantity: newBalance.toFixed(4),
      reservedQty: "0",
      updatedAt: new Date(),
    });
  }

  await db.insert(stockMovement).values({
    id: nanoid(),
    organizationId: orgId,
    productId: data.productId,
    productCode: prod.productCode,
    movementType: data.movementType,
    quantity: signed.toFixed(4),
    balanceAfter: newBalance.toFixed(4),
    unitCost: data.unitCost?.trim() || null,
    referenceType: data.referenceType ?? REF_TYPE.MANUAL,
    referenceId: null,
    referenceNo: data.referenceNo?.trim() || null,
    notes: data.notes?.trim() || null,
    createdBy: userId,
    createdAt: new Date(),
  });

  revalidatePath("/dashboard/inventory");
}

export async function setReorderPoint(productId: string, reorderPoint: string | null, maxStock: string | null): Promise<void> {
  const { orgId } = await requireAccess("inventory:manage");

  const existing = await db
    .select({ id: stockLevel.id })
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, productId), eq(stockLevel.organizationId, orgId)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(stockLevel)
      .set({ reorderPoint: reorderPoint ?? null, maxStock: maxStock ?? null, updatedAt: new Date() })
      .where(eq(stockLevel.id, existing[0].id));
  } else {
    await db.insert(stockLevel).values({
      id: nanoid(),
      organizationId: orgId,
      productId,
      quantity: "0",
      reservedQty: "0",
      reorderPoint: reorderPoint ?? null,
      maxStock: maxStock ?? null,
      updatedAt: new Date(),
    });
  }
  revalidatePath("/dashboard/inventory");
}

export async function getProducts() {
  const { orgId } = await requireAccess("inventory:read");
  return db
    .select({ id: product.id, productCode: product.productCode, description: product.description, uom: product.uom })
    .from(product)
    .where(eq(product.organizationId, orgId))
    .orderBy(asc(product.productCode));
}
