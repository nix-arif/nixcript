// Serial numbers entered on a stock-in (opening balance, stock in, return)
// become real serialized units, so every later step (inventory, field
// transfer, Case DO, consignment) can pick the exact machine.
//
// NOT a "use server" module: trusts its inputs. Callers check access.

import { db } from "@/db";
import { assetUnit, stockMovement } from "@/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ASSET_UNIT_STATUS, INTENDED_USE, isFieldWarehouseLabel } from "@/lib/inventory/constants";

const INCOMING = new Set(["OPENING", "STOCK_IN", "RETURN", "ADJUSTMENT"]);

/** Serial numbers already in use (in stock, with a rep, on loan, consigned…) for a product in the owner group. */
export async function activeSerials(ownerOrgIds: string[], productId: string, serials: string[]) {
  if (!serials.length) return [];
  const rows = await db.select({ serialNo: assetUnit.serialNo }).from(assetUnit).where(and(
    inArray(assetUnit.organizationId, ownerOrgIds), eq(assetUnit.productId, productId),
    inArray(assetUnit.serialNo, serials), ne(assetUnit.status, ASSET_UNIT_STATUS.SOLD), ne(assetUnit.status, ASSET_UNIT_STATUS.DISPOSED),
  ));
  return rows.map((r) => r.serialNo);
}

/**
 * After an incoming movement carrying a serial number is approved: register
 * that unit where the stock landed (or bring a previously sold/disposed unit
 * with the same serial back), and link the movement to it.
 */
export async function registerUnitForMovement(movementId: string, userId: string) {
  const [mv] = await db.select().from(stockMovement).where(eq(stockMovement.id, movementId)).limit(1);
  // A machine stocked out leaves inventory for good
  if (mv && mv.status === "APPROVED" && mv.unitId && mv.movementType === "STOCK_OUT") {
    await db.update(assetUnit).set({ status: ASSET_UNIT_STATUS.DISPOSED, currentHolderUserId: null, updatedAt: new Date(),
      notes: sql`coalesce(${assetUnit.notes} || E'\n', '') || ${`Stocked out — ${mv.notes ?? mv.referenceNo ?? "stock out"}`}` })
      .where(eq(assetUnit.id, mv.unitId));
    return;
  }
  if (!mv || mv.status !== "APPROVED" || !mv.serialNo || mv.unitId) return;
  if (!INCOMING.has(mv.movementType) || parseFloat(mv.quantity) <= 0) return;
  const label = mv.warehouseLabel;
  const repId = isFieldWarehouseLabel(label) ? label.slice("Field:".length).split(":")[0] : null;
  const place = {
    status: repId ? ASSET_UNIT_STATUS.WITH_REP : ASSET_UNIT_STATUS.IN_STOCK,
    currentOrgId: mv.organizationId, currentWarehouseLabel: label, currentHolderUserId: repId, currentCustomerId: null,
  };
  const [existing] = await db.select().from(assetUnit).where(and(
    eq(assetUnit.organizationId, mv.organizationId), eq(assetUnit.productId, mv.productId), eq(assetUnit.serialNo, mv.serialNo),
  )).limit(1);
  let unitId: string;
  if (existing) {
    unitId = existing.id;
    await db.update(assetUnit).set({ ...place, ...(mv.intendedUse ? { intendedUse: mv.intendedUse } : {}), updatedAt: new Date() }).where(eq(assetUnit.id, existing.id));
  } else {
    unitId = nanoid();
    await db.insert(assetUnit).values({
      id: unitId, organizationId: mv.organizationId, productId: mv.productId, serialNo: mv.serialNo,
      intendedUse: mv.intendedUse && mv.intendedUse in INTENDED_USE ? mv.intendedUse : INTENDED_USE.SALE,
      ...place, referenceType: "STOCK_MOVEMENT", referenceId: mv.id, referenceNo: mv.referenceNo ?? null,
      registeredBy: userId,
    });
  }
  await db.update(stockMovement).set({ unitId }).where(eq(stockMovement.id, mv.id));
}

/** Undo the registration a deleted stock-in made — refused once the unit has later history. */
export async function unregisterUnitForMovement(mv: typeof stockMovement.$inferSelect) {
  if (!mv.unitId) return;
  if (mv.movementType === "STOCK_OUT") {
    const repId = isFieldWarehouseLabel(mv.warehouseLabel) ? mv.warehouseLabel.slice("Field:".length).split(":")[0] : null;
    await db.update(assetUnit).set({ status: repId ? ASSET_UNIT_STATUS.WITH_REP : ASSET_UNIT_STATUS.IN_STOCK, currentWarehouseLabel: mv.warehouseLabel, currentHolderUserId: repId, updatedAt: new Date() })
      .where(and(eq(assetUnit.id, mv.unitId), eq(assetUnit.status, ASSET_UNIT_STATUS.DISPOSED)));
    return;
  }
  const [unit] = await db.select().from(assetUnit).where(eq(assetUnit.id, mv.unitId)).limit(1);
  if (!unit || unit.referenceId !== mv.id) return;
  const later = await db.select({ id: stockMovement.id }).from(stockMovement)
    .where(and(eq(stockMovement.unitId, unit.id), ne(stockMovement.id, mv.id))).limit(1);
  if (later.length || unit.status !== ASSET_UNIT_STATUS.IN_STOCK && unit.status !== ASSET_UNIT_STATUS.WITH_REP) {
    throw new Error(`Cannot delete — serial ${unit.serialNo} has been moved or used since. Reverse those first.`);
  }
  await db.update(stockMovement).set({ unitId: null }).where(eq(stockMovement.id, mv.id));
  await db.delete(assetUnit).where(eq(assetUnit.id, unit.id));
}
