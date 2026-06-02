import { db } from "@/db";
import { stockLevel, stockMovement, product } from "@/db/schema";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { MOVEMENT_TYPE } from "./constants";

interface MovementParams {
  orgId: string;
  userId: string;
  productId: string;
  warehouseLabel: string;
  movementType: string;
  quantity: number;
  unitCost?: string;
  referenceType: string;
  referenceId: string;
  referenceNo: string;
  notes?: string;
}

async function resolveProductCode(productId: string, orgId: string): Promise<string> {
  const [prod] = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(eq(product.id, productId), eq(product.organizationId, orgId)))
    .limit(1);
  if (!prod) throw new Error(`Product ${productId} not found in org`);
  return prod.productCode;
}

/**
 * Creates an auto-approved movement and immediately updates stockLevel.
 * Used by PO receipt (STOCK_IN), DO delivery (STOCK_OUT), and DO return (RETURN).
 * Also updates weighted-average unitCost on STOCK_IN.
 */
export async function createApprovedMovement(p: MovementParams): Promise<void> {
  const productCode = await resolveProductCode(p.productId, p.orgId);
  const isOut = p.movementType === MOVEMENT_TYPE.STOCK_OUT;
  const signed = isOut ? -Math.abs(p.quantity) : Math.abs(p.quantity);

  const [existing] = await db
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.productId, p.productId),
        eq(stockLevel.organizationId, p.orgId),
        eq(stockLevel.warehouseLabel, p.warehouseLabel),
      ),
    )
    .limit(1);

  let newBalance: number;

  if (existing) {
    newBalance = parseFloat(existing.quantity) + signed;
    if (newBalance < 0) throw new Error(`Insufficient stock: ${productCode} in ${p.warehouseLabel}`);

    const updates: Record<string, unknown> = { quantity: newBalance.toFixed(4), updatedAt: new Date() };

    // Weighted average cost on STOCK_IN
    if (p.movementType === MOVEMENT_TYPE.STOCK_IN && p.unitCost) {
      const inCost = parseFloat(p.unitCost);
      if (!isNaN(inCost) && inCost > 0 && newBalance > 0) {
        const oldQty = parseFloat(existing.quantity);
        const oldCost = parseFloat(existing.unitCost ?? "0");
        const inQty = Math.abs(p.quantity);
        updates.unitCost = (((oldQty * oldCost) + (inQty * inCost)) / newBalance).toFixed(4);
      }
    }

    await db.update(stockLevel).set(updates).where(eq(stockLevel.id, existing.id));
  } else {
    newBalance = signed;
    if (newBalance < 0) throw new Error(`Insufficient stock: ${productCode} in ${p.warehouseLabel}`);
    await db.insert(stockLevel).values({
      id: nanoid(),
      organizationId: p.orgId,
      productId: p.productId,
      warehouseLabel: p.warehouseLabel,
      quantity: newBalance.toFixed(4),
      reservedQty: "0",
      unitCost: p.unitCost?.trim() || null,
      updatedAt: new Date(),
    });
  }

  await db.insert(stockMovement).values({
    id: nanoid(),
    organizationId: p.orgId,
    productId: p.productId,
    productCode,
    warehouseLabel: p.warehouseLabel,
    warehouseTo: null,
    movementType: p.movementType,
    quantity: signed.toFixed(4),
    balanceAfter: newBalance.toFixed(4),
    unitCost: p.unitCost?.trim() || null,
    referenceType: p.referenceType,
    referenceId: p.referenceId,
    referenceNo: p.referenceNo,
    notes: p.notes?.trim() || null,
    status: "APPROVED",
    reviewedBy: p.userId,
    reviewedAt: new Date(),
    createdBy: p.userId,
    createdAt: new Date(),
  });
}

/**
 * Adjusts reservedQty on stockLevel (positive = reserve, negative = release).
 * No movement record is created — reservations are a soft hold only.
 * Clamps at zero so partial DO deliveries don't cause double-release errors.
 */
export async function adjustReservation(p: {
  orgId: string;
  productId: string;
  warehouseLabel: string;
  delta: number;
}): Promise<void> {
  const [existing] = await db
    .select({ id: stockLevel.id, reservedQty: stockLevel.reservedQty })
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.productId, p.productId),
        eq(stockLevel.organizationId, p.orgId),
        eq(stockLevel.warehouseLabel, p.warehouseLabel),
      ),
    )
    .limit(1);

  if (!existing) {
    if (p.delta > 0) {
      await db.insert(stockLevel).values({
        id: nanoid(),
        organizationId: p.orgId,
        productId: p.productId,
        warehouseLabel: p.warehouseLabel,
        quantity: "0",
        reservedQty: p.delta.toFixed(4),
        updatedAt: new Date(),
      });
    }
    return;
  }

  const newReserved = Math.max(0, parseFloat(existing.reservedQty) + p.delta);
  await db
    .update(stockLevel)
    .set({ reservedQty: newReserved.toFixed(4), updatedAt: new Date() })
    .where(eq(stockLevel.id, existing.id));
}
