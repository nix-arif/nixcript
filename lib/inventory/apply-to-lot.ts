import { db } from "@/db";
import { stockLot } from "@/db/schema";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";

// Applies a signed quantity delta to a specific (product, warehouse, lot)
// balance — creating the lot row on first inbound movement, or adjusting an
// existing one. Shared by server/inventory.ts (general stock movements) and
// server/field-stock.ts (rep transfers), so a lot's real quantity stays
// correct no matter which flow moved it. Deliberately NOT a "use server"
// export: it trusts a caller-supplied orgId and signed delta with no
// permission check of its own — every caller must already have verified
// access and organization scope before calling this.
export async function applyToLot(opts: {
  orgId: string;
  productId: string;
  warehouseLabel: string;
  lotNo: string;
  expiryDate?: Date | null;
  signed: number;
  unitCost?: string | null;
}): Promise<{ lotId: string; newQty: number }> {
  const { orgId, productId, warehouseLabel, lotNo, expiryDate, signed, unitCost } = opts;

  const [existing] = await db
    .select()
    .from(stockLot)
    .where(and(
      eq(stockLot.productId, productId),
      eq(stockLot.organizationId, orgId),
      eq(stockLot.warehouseLabel, warehouseLabel),
      eq(stockLot.lotNo, lotNo),
    ))
    .limit(1);

  if (existing) {
    const newQty = parseFloat(existing.quantity) + signed;
    if (newQty < 0) throw new Error(`Lot ${lotNo} has insufficient quantity`);
    await db.update(stockLot)
      .set({ quantity: newQty.toFixed(4), updatedAt: new Date() })
      .where(eq(stockLot.id, existing.id));
    return { lotId: existing.id, newQty };
  } else {
    if (signed < 0) throw new Error(`Lot ${lotNo} does not exist — cannot deduct`);
    const lotId = nanoid();
    await db.insert(stockLot).values({
      id: lotId,
      organizationId: orgId,
      productId,
      warehouseLabel,
      lotNo,
      expiryDate: expiryDate ?? null,
      quantity: signed.toFixed(4),
      reservedQty: "0",
      unitCost: unitCost ?? null,
    });
    return { lotId, newQty: signed };
  }
}
