"use server";

import { db } from "@/db";
import { stockLevel, stockMovement, stockLot, product, user, organizationProfile, member } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { assertSelfActionAllowed } from "@/lib/approvals/guard";
import { isSelfActionAllowed } from "@/server/approval-settings";
import { notifyUsersWithPermission } from "@/server/notifications";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, ilike, or, inArray, notInArray, isNull, isNotNull, lte } from "drizzle-orm";
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

export type UntrackedProduct = {
  productId: string;
  productCode: string;
  description: string | null;
  uom: string | null;
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

async function requireOwnerForDelete() {
  const { orgId, userId } = await getSession();
  const [ownerRow] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(
      eq(member.organizationId, orgId),
      eq(member.userId, userId),
      eq(member.role, "owner"),
      isNull(member.deletedAt),
    ))
    .limit(1);
  if (!ownerRow) throw new Error("Only the owner can delete inventory data");
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

// Upsert a stock_lot row and return its id + new quantity
async function applyToLot(opts: {
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

export async function getWarehouseStock(warehouseLabel: string): Promise<{
  productId: string;
  productCode: string;
  description: string | null;
  uom: string | null;
  quantity: number;
}[]> {
  const { orgId } = await requireAccess("inventory:read");
  const rows = await db
    .select({
      productId: stockLevel.productId,
      productCode: product.productCode,
      description: product.description,
      uom: product.uom,
      quantity: stockLevel.quantity,
    })
    .from(stockLevel)
    .innerJoin(product, eq(stockLevel.productId, product.id))
    .where(and(
      eq(stockLevel.organizationId, orgId),
      eq(stockLevel.warehouseLabel, warehouseLabel),
    ))
    .orderBy(asc(product.productCode));
  return rows
    .map(r => ({ ...r, quantity: parseFloat(r.quantity) }))
    .filter(r => r.quantity > 0);
}

export async function getUntrackedProducts(): Promise<UntrackedProduct[]> {
  const { orgId } = await requireAccess("inventory:read");
  const orgIds = await getAllOwnerOrgIds(orgId);

  const trackedSubquery = db
    .selectDistinct({ productId: stockLevel.productId })
    .from(stockLevel)
    .where(eq(stockLevel.organizationId, orgId));

  const tracked = await trackedSubquery;
  const trackedIds = tracked.map(r => r.productId);

  const q = db
    .select({ productId: product.id, productCode: product.productCode, description: product.description, uom: product.uom })
    .from(product)
    .where(inArray(product.organizationId, orgIds))
    .orderBy(asc(product.productCode));

  const rows = await q;
  return trackedIds.length > 0
    ? rows.filter(r => !trackedIds.includes(r.productId))
    : rows;
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
  serialNo?: string;
  lotNo?: string;
  expiryDate?: Date;
}): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:adjust");

  if (data.quantity === 0) throw new Error("Quantity cannot be zero");

  const [prod] = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(eq(product.id, data.productId), inArray(product.organizationId, await getAllOwnerOrgIds(orgId))))
    .limit(1);
  if (!prod) throw new Error("Product not found");

  const isOut = data.movementType === MOVEMENT_TYPE.STOCK_OUT;
  const signed = isOut ? -Math.abs(data.quantity) : Math.abs(data.quantity);

  // Auto-approve if the creator also has approve rights — no extra step needed
  // — unless the org has explicitly disabled self-approval for this key, in
  // which case it must go through proper review by someone else.
  const perms = await getUserPermissions(userId, orgId);
  const canApprove = hasAccess(perms, "inventory:approve") && (await isSelfActionAllowed(orgId, "inventory:approve"));

  const movementId = nanoid();
  await db.insert(stockMovement).values({
    id: movementId,
    organizationId: orgId,
    productId: data.productId,
    productCode: prod.productCode,
    warehouseLabel: data.warehouseLabel,
    warehouseTo: null,
    movementType: data.movementType,
    quantity: signed.toFixed(4),
    balanceAfter: null,
    unitCost: data.unitCost?.trim() || null,
    referenceType: data.referenceType ?? REF_TYPE.MANUAL,
    referenceId: null,
    referenceNo: data.referenceNo?.trim() || null,
    notes: data.notes?.trim() || null,
    serialNo: data.serialNo?.trim() || null,
    lotNo: data.lotNo?.trim() || null,
    expiryDate: data.expiryDate ?? null,
    status: canApprove ? "APPROVED" : "PENDING",
    reviewedBy: canApprove ? userId : null,
    reviewedAt: canApprove ? new Date() : null,
    createdBy: userId,
    createdAt: new Date(),
  });

  if (canApprove) {
    // Apply to stock_lot if lot number provided
    let lotId: string | null = null;
    if (data.lotNo?.trim()) {
      const result = await applyToLot({
        orgId, productId: data.productId, warehouseLabel: data.warehouseLabel,
        lotNo: data.lotNo.trim(), expiryDate: data.expiryDate,
        signed, unitCost: data.unitCost,
      });
      lotId = result.lotId;
    }

    // Apply to aggregate stock_level
    const [existing] = await db
      .select()
      .from(stockLevel)
      .where(and(eq(stockLevel.productId, data.productId), eq(stockLevel.organizationId, orgId), eq(stockLevel.warehouseLabel, data.warehouseLabel)))
      .limit(1);

    const newBalance = existing ? parseFloat(existing.quantity) + signed : signed;
    if (newBalance < 0) throw new Error(`Insufficient stock in ${data.warehouseLabel}`);

    if (existing) {
      await db.update(stockLevel)
        .set({ quantity: newBalance.toFixed(4), updatedAt: new Date() })
        .where(eq(stockLevel.id, existing.id));
    } else {
      await db.insert(stockLevel).values({
        id: nanoid(), organizationId: orgId, productId: data.productId,
        warehouseLabel: data.warehouseLabel, quantity: newBalance.toFixed(4),
        reservedQty: "0", updatedAt: new Date(),
      });
    }

    await db.update(stockMovement)
      .set({ balanceAfter: newBalance.toFixed(4), lotId })
      .where(eq(stockMovement.id, movementId));
  } else {
    await notifyUsersWithPermission(orgId, "inventory:approve", {
      type: "inventory:submitted",
      title: `Stock Movement Pending Approval`,
      body: `A ${data.movementType} of ${Math.abs(data.quantity)} × ${prod.productCode} in ${data.warehouseLabel} needs review`,
      link: `/dashboard/inventory/approvals`,
    });
  }

  revalidatePath("/dashboard/inventory");
}

// Creates a PENDING transfer — does NOT move stock yet
export async function transferStock(data: {
  productId: string;
  fromWarehouse: string;
  toWarehouse: string;
  quantity: number;
  notes?: string;
  referenceNo?: string;
  serialNo?: string;
  lotNo?: string;
  expiryDate?: Date;
}): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:adjust");

  if (data.quantity <= 0) throw new Error("Quantity must be greater than zero");
  if (data.fromWarehouse === data.toWarehouse) throw new Error("Source and destination warehouses must differ");

  const [prod] = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(eq(product.id, data.productId), inArray(product.organizationId, await getAllOwnerOrgIds(orgId))))
    .limit(1);
  if (!prod) throw new Error("Product not found");

  const serialNo = data.serialNo?.trim() || null;
  const lotNo = data.lotNo?.trim() || null;
  const expiryDate = data.expiryDate ?? null;
  const referenceNo = data.referenceNo?.trim() || null;

  const now = new Date();
  await db.insert(stockMovement).values([
    { id: nanoid(), organizationId: orgId, productId: data.productId, productCode: prod.productCode, warehouseLabel: data.fromWarehouse, warehouseTo: data.toWarehouse, movementType: MOVEMENT_TYPE.TRANSFER, quantity: (-data.quantity).toFixed(4), balanceAfter: null, unitCost: null, referenceType: REF_TYPE.MANUAL, referenceId: null, referenceNo, serialNo, lotNo, expiryDate, notes: data.notes?.trim() || null, status: "PENDING", createdBy: userId, createdAt: now },
    { id: nanoid(), organizationId: orgId, productId: data.productId, productCode: prod.productCode, warehouseLabel: data.toWarehouse, warehouseTo: null, movementType: MOVEMENT_TYPE.TRANSFER, quantity: data.quantity.toFixed(4), balanceAfter: null, unitCost: null, referenceType: REF_TYPE.MANUAL, referenceId: null, referenceNo, serialNo, lotNo, expiryDate, notes: data.notes?.trim() || null, status: "PENDING", createdBy: userId, createdAt: now },
  ]);

  await notifyUsersWithPermission(orgId, "inventory:approve", {
    type: "inventory:submitted",
    title: `Stock Transfer Pending Approval`,
    body: `A transfer of ${data.quantity} × ${prod.productCode} from ${data.fromWarehouse} to ${data.toWarehouse} needs review`,
    link: `/dashboard/inventory/approvals`,
  });

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
  await assertSelfActionAllowed(orgId, "inventory:approve", mv.createdBy, userId, "approve");

  const signed = parseFloat(mv.quantity);

  // Apply to stock_lot if movement has a lot number
  let lotId: string | null = mv.lotId ?? null;
  if (mv.lotNo) {
    const result = await applyToLot({
      orgId, productId: mv.productId, warehouseLabel: mv.warehouseLabel,
      lotNo: mv.lotNo, expiryDate: mv.expiryDate,
      signed, unitCost: mv.unitCost,
    });
    lotId = result.lotId;
  }

  // Upsert aggregate stock level
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
    .set({ status: "APPROVED", balanceAfter: newBalance.toFixed(4), lotId, reviewedBy: userId, reviewedAt: new Date(), reviewComment: comment?.trim() || null })
    .where(eq(stockMovement.id, movementId));

  revalidatePath("/dashboard/inventory");
}

export async function rejectStockMovement(movementId: string, reason: string): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:approve");
  if (!reason.trim()) throw new Error("Rejection reason is required");

  const [mv] = await db
    .select({ status: stockMovement.status, createdBy: stockMovement.createdBy })
    .from(stockMovement)
    .where(and(eq(stockMovement.id, movementId), eq(stockMovement.organizationId, orgId)))
    .limit(1);

  if (!mv) throw new Error("Movement not found");
  if (mv.status !== "PENDING") throw new Error("Only pending movements can be rejected");
  await assertSelfActionAllowed(orgId, "inventory:approve", mv.createdBy, userId, "reject");

  await db.update(stockMovement)
    .set({ status: "REJECTED", reviewedBy: userId, reviewedAt: new Date(), reviewComment: reason.trim() })
    .where(eq(stockMovement.id, movementId));

  revalidatePath("/dashboard/inventory");
}

export async function editStockLevel(data: {
  stockLevelId: string;
  targetQty: number;
  reorderPoint: string | null;
  maxStock: string | null;
  unitCost: string | null;
  correctionNotes?: string;
}): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:manage");

  const [sl] = await db
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.id, data.stockLevelId), eq(stockLevel.organizationId, orgId)))
    .limit(1);
  if (!sl) throw new Error("Stock record not found");

  const currentQty = parseFloat(sl.quantity);
  const delta = data.targetQty - currentQty;

  // Update metadata regardless — reorder point / max stock / unit cost carry
  // no risk of silently moving inventory, so they're not subject to review.
  await db.update(stockLevel)
    .set({ reorderPoint: data.reorderPoint, maxStock: data.maxStock, unitCost: data.unitCost, updatedAt: new Date() })
    .where(eq(stockLevel.id, sl.id));

  // If qty changed, record an adjustment movement — same auto-approve rule
  // as adjustStock: only commit immediately if the caller also holds
  // inventory:approve (and self-approval isn't disabled for this org).
  // inventory:manage alone (e.g. the logistic manager role) is not enough
  // to bypass the two-person review the rest of inventory enforces.
  if (Math.abs(delta) > 0.00001) {
    const [prod] = await db.select({ productCode: product.productCode }).from(product).where(eq(product.id, sl.productId)).limit(1);

    const perms = await getUserPermissions(userId, orgId);
    const canApprove = hasAccess(perms, "inventory:approve") && (await isSelfActionAllowed(orgId, "inventory:approve"));

    const movementId = nanoid();
    await db.insert(stockMovement).values({
      id: movementId,
      organizationId: orgId,
      productId: sl.productId,
      productCode: prod?.productCode ?? "",
      warehouseLabel: sl.warehouseLabel,
      warehouseTo: null,
      movementType: MOVEMENT_TYPE.ADJUSTMENT,
      quantity: delta.toFixed(4),
      balanceAfter: canApprove ? data.targetQty.toFixed(4) : null,
      unitCost: data.unitCost,
      referenceType: REF_TYPE.MANUAL,
      referenceId: null,
      referenceNo: null,
      notes: data.correctionNotes?.trim() || "Balance correction",
      lotNo: null,
      expiryDate: null,
      lotId: null,
      status: canApprove ? "APPROVED" : "PENDING",
      reviewedBy: canApprove ? userId : null,
      reviewedAt: canApprove ? new Date() : null,
      createdBy: userId,
      createdAt: new Date(),
    });

    if (canApprove) {
      await db.update(stockLevel)
        .set({ quantity: data.targetQty.toFixed(4), updatedAt: new Date() })
        .where(eq(stockLevel.id, sl.id));
    } else {
      await notifyUsersWithPermission(orgId, "inventory:approve", {
        type: "inventory:submitted",
        title: `Stock Balance Correction Pending Approval`,
        body: `A correction of ${delta > 0 ? "+" : ""}${delta.toFixed(2)} × ${prod?.productCode ?? sl.productId} in ${sl.warehouseLabel} needs review`,
        link: `/dashboard/inventory/approvals`,
      });
    }
  }

  revalidatePath("/dashboard/inventory");
}

export async function assignLotToStock(data: {
  productId: string;
  warehouseLabel: string;
  lotNo: string;
  expiryDate: Date | null;
  quantity: number;
}): Promise<void> {
  const { orgId } = await requireAccess("inventory:manage");

  // Verify product exists in this org
  const [sl] = await db
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, data.productId), eq(stockLevel.organizationId, orgId), eq(stockLevel.warehouseLabel, data.warehouseLabel)))
    .limit(1);
  if (!sl) throw new Error("Stock record not found");

  if (data.quantity <= 0) throw new Error("Quantity must be greater than zero");
  if (data.quantity > parseFloat(sl.quantity)) throw new Error(`Quantity cannot exceed current balance (${parseFloat(sl.quantity)})`);

  const [dup] = await db
    .select({ id: stockLot.id })
    .from(stockLot)
    .where(and(
      eq(stockLot.productId, data.productId),
      eq(stockLot.organizationId, orgId),
      eq(stockLot.warehouseLabel, data.warehouseLabel),
      eq(stockLot.lotNo, data.lotNo),
    ))
    .limit(1);
  if (dup) throw new Error(`Lot "${data.lotNo}" already exists for this product`);

  await db.insert(stockLot).values({
    id: nanoid(),
    organizationId: orgId,
    productId: data.productId,
    warehouseLabel: data.warehouseLabel,
    lotNo: data.lotNo,
    expiryDate: data.expiryDate,
    quantity: data.quantity.toFixed(4),
    reservedQty: "0",
    unitCost: sl.unitCost,
  });

  revalidatePath("/dashboard/inventory");
}

export async function editStockLot(lotId: string, data: { lotNo: string; expiryDate: Date | null }): Promise<void> {
  const { orgId } = await requireAccess("inventory:manage");

  const [lot] = await db
    .select()
    .from(stockLot)
    .where(and(eq(stockLot.id, lotId), eq(stockLot.organizationId, orgId)))
    .limit(1);
  if (!lot) throw new Error("Lot not found");

  // If lot number is changing, check no duplicate exists
  if (data.lotNo !== lot.lotNo) {
    const [dup] = await db
      .select({ id: stockLot.id })
      .from(stockLot)
      .where(and(
        eq(stockLot.productId, lot.productId),
        eq(stockLot.organizationId, orgId),
        eq(stockLot.warehouseLabel, lot.warehouseLabel),
        eq(stockLot.lotNo, data.lotNo),
      ))
      .limit(1);
    if (dup) throw new Error(`Lot number "${data.lotNo}" already exists for this product`);
  }

  await db.update(stockLot)
    .set({ lotNo: data.lotNo, expiryDate: data.expiryDate, updatedAt: new Date() })
    .where(eq(stockLot.id, lotId));

  revalidatePath("/dashboard/inventory");
}

export async function deleteStockLevel(stockLevelId: string): Promise<void> {
  const { orgId } = await requireOwnerForDelete();

  const [sl] = await db
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.id, stockLevelId), eq(stockLevel.organizationId, orgId)))
    .limit(1);
  if (!sl) throw new Error("Stock record not found");

  // Cascade: remove all movement history for this product/warehouse
  await db.delete(stockMovement).where(and(
    eq(stockMovement.productId, sl.productId),
    eq(stockMovement.organizationId, orgId),
    eq(stockMovement.warehouseLabel, sl.warehouseLabel),
  ));

  // Remove lot records for this product/warehouse
  await db.delete(stockLot).where(and(
    eq(stockLot.productId, sl.productId),
    eq(stockLot.organizationId, orgId),
    eq(stockLot.warehouseLabel, sl.warehouseLabel),
  ));

  await db.delete(stockLevel).where(eq(stockLevel.id, stockLevelId));

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/movements");
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

export type StockLotRow = typeof stockLot.$inferSelect;

export async function getProductLots(productId: string, warehouseLabel?: string) {
  const { orgId } = await requireAccess("inventory:read");
  const conditions = [
    eq(stockLot.productId, productId),
    eq(stockLot.organizationId, orgId),
  ];
  if (warehouseLabel) conditions.push(eq(stockLot.warehouseLabel, warehouseLabel));
  return db
    .select()
    .from(stockLot)
    .where(and(...conditions))
    .orderBy(asc(stockLot.expiryDate), asc(stockLot.lotNo));
}

export async function getTransferStockInfo(productId: string, warehouseLabel: string): Promise<{
  onHand: number;
  lots: { id: string; lotNo: string; expiryDate: Date | null; quantity: string }[];
  serialNos: string[];
}> {
  const { orgId } = await requireAccess("inventory:read");

  const [levelRow] = await db
    .select({ quantity: stockLevel.quantity })
    .from(stockLevel)
    .where(and(
      eq(stockLevel.productId, productId),
      eq(stockLevel.organizationId, orgId),
      eq(stockLevel.warehouseLabel, warehouseLabel),
    ))
    .limit(1);

  const lots = await db
    .select({ id: stockLot.id, lotNo: stockLot.lotNo, expiryDate: stockLot.expiryDate, quantity: stockLot.quantity })
    .from(stockLot)
    .where(and(
      eq(stockLot.productId, productId),
      eq(stockLot.organizationId, orgId),
      eq(stockLot.warehouseLabel, warehouseLabel),
    ))
    .orderBy(asc(stockLot.expiryDate), asc(stockLot.lotNo));

  const serialRows = await db
    .selectDistinct({ serialNo: stockMovement.serialNo })
    .from(stockMovement)
    .where(and(
      eq(stockMovement.productId, productId),
      eq(stockMovement.organizationId, orgId),
      eq(stockMovement.warehouseLabel, warehouseLabel),
      eq(stockMovement.status, "APPROVED"),
      isNotNull(stockMovement.serialNo),
    ));

  return {
    onHand: parseFloat(levelRow?.quantity ?? "0"),
    lots,
    serialNos: serialRows.map(r => r.serialNo!).filter(Boolean),
  };
}

// Backfill stock_lot rows from approved movements that recorded lotNo
// but were created before stock_lot table existed.
export async function backfillStockLots(): Promise<{ created: number }> {
  const { orgId } = await requireAccess("inventory:manage");

  const movements = await db
    .select()
    .from(stockMovement)
    .where(and(
      eq(stockMovement.organizationId, orgId),
      eq(stockMovement.status, "APPROVED"),
      isNotNull(stockMovement.lotNo),
    ));

  // Group by product / warehouse / lotNo, summing signed quantities
  type Group = { productId: string; warehouseLabel: string; lotNo: string; expiryDate: Date | null; qty: number; unitCost: string | null };
  const groups = new Map<string, Group>();
  for (const mv of movements) {
    if (!mv.lotNo) continue;
    const key = `${mv.productId}:${mv.warehouseLabel}:${mv.lotNo}`;
    const g = groups.get(key);
    if (g) {
      g.qty += parseFloat(mv.quantity);
    } else {
      groups.set(key, {
        productId: mv.productId,
        warehouseLabel: mv.warehouseLabel,
        lotNo: mv.lotNo,
        expiryDate: mv.expiryDate ?? null,
        qty: parseFloat(mv.quantity),
        unitCost: mv.unitCost,
      });
    }
  }

  let created = 0;
  for (const [, g] of groups) {
    const [existing] = await db
      .select({ id: stockLot.id })
      .from(stockLot)
      .where(and(
        eq(stockLot.productId, g.productId),
        eq(stockLot.organizationId, orgId),
        eq(stockLot.warehouseLabel, g.warehouseLabel),
        eq(stockLot.lotNo, g.lotNo),
      ))
      .limit(1);

    if (!existing) {
      await db.insert(stockLot).values({
        id: nanoid(),
        organizationId: orgId,
        productId: g.productId,
        warehouseLabel: g.warehouseLabel,
        lotNo: g.lotNo,
        expiryDate: g.expiryDate,
        quantity: Math.max(0, g.qty).toFixed(4),
        reservedQty: "0",
        unitCost: g.unitCost,
      });
      created++;
    }
  }

  revalidatePath("/dashboard/inventory");
  return { created };
}

export async function editStockMovement(id: string, data: {
  // Safe fields — editable on any status
  notes: string | null;
  referenceNo: string | null;
  serialNo: string | null;
  lotNo: string | null;
  expiryDate: Date | null;
  // Pending-only fields
  productId?: string;
  warehouseLabel?: string;
  movementType?: string;
  quantity?: number;
  unitCost?: string | null;
}): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:manage");

  const [mv] = await db
    .select()
    .from(stockMovement)
    .where(and(eq(stockMovement.id, id), eq(stockMovement.organizationId, orgId)))
    .limit(1);
  if (!mv) throw new Error("Movement not found");

  const safeFields = {
    notes: data.notes?.trim() || null,
    referenceNo: data.referenceNo?.trim() || null,
    serialNo: data.serialNo?.trim() || null,
    lotNo: data.lotNo?.trim() || null,
    expiryDate: data.expiryDate,
  };

  if (mv.status !== "PENDING") {
    // Approved/rejected: only safe fields
    await db.update(stockMovement).set(safeFields).where(eq(stockMovement.id, id));
    revalidatePath("/dashboard/inventory/movements");
    return;
  }

  // PENDING: full edit allowed
  let productCode = mv.productCode;
  if (data.productId && data.productId !== mv.productId) {
    const orgIds = await getAllOwnerOrgIds(orgId);
    const [prod] = await db
      .select({ productCode: product.productCode })
      .from(product)
      .where(and(inArray(product.organizationId, orgIds), eq(product.id, data.productId)))
      .limit(1);
    if (!prod) throw new Error("Product not found");
    productCode = prod.productCode;
  }

  const qty = data.quantity !== undefined ? data.quantity : parseFloat(mv.quantity);
  const movementType = data.movementType ?? mv.movementType;
  const isOut = ["STOCK_OUT", "TRANSFER_OUT"].includes(movementType);
  const signed = isOut ? -Math.abs(qty) : Math.abs(qty);

  // A pending movement's core fields (what/where/how much) can be
  // corrected by anyone holding inventory:manage before an inventory:approve
  // reviewer signs off — not just the movement's own creator, and there's
  // no dedicated audit-trail column on stock_movement. Leave a textual
  // trail in notes so the reviewer can see it was edited, and by whom.
  const coreFieldsChanged =
    (data.productId !== undefined && data.productId !== mv.productId) ||
    (data.warehouseLabel !== undefined && data.warehouseLabel !== mv.warehouseLabel) ||
    (data.movementType !== undefined && data.movementType !== mv.movementType) ||
    (data.quantity !== undefined && signed.toFixed(4) !== mv.quantity);

  let notes = safeFields.notes;
  if (coreFieldsChanged && mv.createdBy !== userId) {
    const [editor] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
    const auditLine = `[Edited by ${editor?.name ?? userId} before approval]`;
    notes = notes ? `${notes}\n${auditLine}` : auditLine;
  }

  await db.update(stockMovement)
    .set({
      ...safeFields,
      notes,
      productId: data.productId ?? mv.productId,
      productCode,
      warehouseLabel: data.warehouseLabel ?? mv.warehouseLabel,
      movementType,
      quantity: signed.toFixed(4),
      unitCost: data.unitCost !== undefined ? (data.unitCost?.trim() || null) : mv.unitCost,
    })
    .where(eq(stockMovement.id, id));

  revalidatePath("/dashboard/inventory/movements");
}

export async function deleteStockMovement(id: string): Promise<void> {
  const { orgId } = await requireOwnerForDelete();

  const [mv] = await db
    .select()
    .from(stockMovement)
    .where(and(eq(stockMovement.id, id), eq(stockMovement.organizationId, orgId)))
    .limit(1);
  if (!mv) throw new Error("Movement not found");

  await db.delete(stockMovement).where(eq(stockMovement.id, id));
  revalidatePath("/dashboard/inventory/movements");
}

export type ExpiringLot = {
  id: string;
  productId: string;
  productCode: string;
  description: string | null;
  warehouseLabel: string;
  lotNo: string;
  quantity: string;
  expiryDate: Date;
};

export async function getExpiringLots(): Promise<ExpiringLot[]> {
  const { orgId } = await requireAccess("inventory:read");
  const warnCutoff = new Date();
  warnCutoff.setDate(warnCutoff.getDate() + 90);

  const rows = await db
    .select({
      id: stockLot.id,
      productId: stockLot.productId,
      productCode: product.productCode,
      description: product.description,
      warehouseLabel: stockLot.warehouseLabel,
      lotNo: stockLot.lotNo,
      quantity: stockLot.quantity,
      expiryDate: stockLot.expiryDate,
    })
    .from(stockLot)
    .leftJoin(product, eq(stockLot.productId, product.id))
    .where(and(
      eq(stockLot.organizationId, orgId),
      isNotNull(stockLot.expiryDate),
      lte(stockLot.expiryDate, warnCutoff),
    ))
    .orderBy(asc(stockLot.expiryDate));

  return rows
    .filter(r => r.expiryDate && parseFloat(r.quantity) > 0 && r.productCode)
    .map(r => ({
      id: r.id,
      productId: r.productId,
      productCode: r.productCode!,
      description: r.description ?? null,
      warehouseLabel: r.warehouseLabel,
      lotNo: r.lotNo,
      quantity: r.quantity,
      expiryDate: r.expiryDate!,
    }));
}
