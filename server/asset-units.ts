"use server";

import { db } from "@/db";
import { assetUnit, member, product, stockMovement, user, customer, stockLevel } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { ASSET_UNIT_STATUS, INTENDED_USE } from "@/lib/inventory/constants";
import { nanoid } from "nanoid";
import { isOrgMember } from "@/lib/inventory/field-holder";
import { eq, and, desc, inArray, isNull, ilike, or, sql, asc, ne } from "drizzle-orm";
import { getWarehouses } from "@/server/inventory";
import { getFieldLocations } from "@/server/field-stock";
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
  intendedUse: string; // INTENDED_USE.* — fixed here, not chosen later at Case DO time
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
  // A unit held in the field is with one of this company's own people
  if (input.repId && !(await isOrgMember(orgId, input.repId))) throw new Error("That person isn't a member of this company — field stock can only be with your own people");

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
  if (!input.intendedUse) throw new Error("Sale or rental designation is required");

  const [row] = await db
    .insert(assetUnit)
    .values({
      id: nanoid(),
      organizationId: orgId,
      productId: input.productId,
      serialNo,
      status: input.status,
      intendedUse: input.intendedUse,
      currentOrgId: orgId,
      // Held by a specialist (or lent from them): in their field stock, where the
      // Field Stock list, Stock Overview and stock-out serial pick look for it
      currentWarehouseLabel: isFieldHeld ? (input.repId ? `Field:${input.repId}` : null) : (input.warehouseLabel ?? "Default"),
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

// Corrects a unit's Sale/Rental designation (e.g. it was registered wrong).
// Blocked once the unit has left inventory for good (SOLD/DISPOSED) — at
// that point the designation already played out and shouldn't retroactively
// change what already happened on a Case DO.
export async function updateAssetUnitIntendedUse(unitId: string, intendedUse: string): Promise<void> {
  const { orgId } = await requireAccess("inventory:manage");
  const ownerOrgIds = await getOwnerOrgIds(orgId);
  const [unitRow] = await db
    .select({ status: assetUnit.status })
    .from(assetUnit)
    .where(and(eq(assetUnit.id, unitId), inArray(assetUnit.organizationId, ownerOrgIds)))
    .limit(1);
  if (!unitRow) throw new Error("Unit not found");
  if (unitRow.status === ASSET_UNIT_STATUS.SOLD || unitRow.status === ASSET_UNIT_STATUS.DISPOSED) {
    throw new Error("Can't change the designation of a unit that's already sold or disposed");
  }
  if (!Object.values(INTENDED_USE).includes(intendedUse as (typeof INTENDED_USE)[keyof typeof INTENDED_USE])) throw new Error("Choose for sale, rental, loan or demo");
  if (unitRow.status === ASSET_UNIT_STATUS.ON_LOAN) throw new Error("This machine is out on a case — return it first");
  await db.update(assetUnit).set({ intendedUse }).where(eq(assetUnit.id, unitId));
  revalidatePath("/dashboard/inventory/serialized-units");
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

// ── Register serial numbers for machines already held somewhere ─────────────
// Starts from a location: the items held there, how many of each already have
// a serial number, and serial numbers for the rest. Quantities and Movement
// History don't change — this only gives the machines already counted their
// identity (serial number + use). Never more serial numbers than stock there.

const HELD = ["IN_STOCK", "WITH_REP"];

/** The company's warehouses and its own people's field stock. */
export async function getRegisterLocations(): Promise<{ label: string; name: string; field: boolean }[]> {
  await requireAccess("inventory:read");
  const [warehouses, field] = await Promise.all([getWarehouses(), getFieldLocations()]);
  return [
    ...warehouses.map((w) => ({ label: w.label, name: w.label === "Default" ? "Main warehouse (not set up)" : w.label, field: false })),
    ...field.filter((f) => !f.notMember).map((f) => ({ label: f.label, name: f.address, field: true })),
  ];
}

export type HeldItem = { productId: string; productCode: string; description: string | null; qty: number; withSerial: number; missing: number;
  machine: boolean; // set up for serial tracking, a rental item, or already has serial numbers — listed first
};

/** Items held at a location, with how many still need a serial number. */
export async function getHeldItemsAt(label: string): Promise<HeldItem[]> {
  const { orgId } = await requireAccess("inventory:manage");
  const levels = await db.select({ productId: stockLevel.productId, qty: stockLevel.quantity, code: product.productCode, description: product.description,
    serial: product.requiresSerialTracking, rental: product.isRental })
    .from(stockLevel).innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.warehouseLabel, label), sql`${stockLevel.quantity}::numeric > 0`))
    .orderBy(asc(product.productCode));
  if (!levels.length) return [];
  const units = await db.select({ productId: assetUnit.productId, n: sql<number>`count(*)::int` }).from(assetUnit)
    .where(and(inArray(assetUnit.productId, levels.map((l) => l.productId)), eq(assetUnit.currentWarehouseLabel, label), inArray(assetUnit.status, HELD),
      or(eq(assetUnit.currentOrgId, orgId), and(isNull(assetUnit.currentOrgId), eq(assetUnit.organizationId, orgId)))))
    .groupBy(assetUnit.productId);
  return levels.map((l) => {
    const qty = parseFloat(l.qty), withSerial = units.find((u) => u.productId === l.productId)?.n ?? 0;
    return { productId: l.productId, productCode: l.code, description: l.description, qty, withSerial, missing: Math.max(0, Math.floor(qty) - withSerial),
      machine: !!l.serial || !!l.rental || withSerial > 0 };
  });
}

export async function registerUnitsAt(input: { label: string; productId: string; units: { serialNo: string; intendedUse: string }[]; notes?: string }): Promise<{ ok: true; count: number } | { ok: false; title: string }> {
  try {
    const { orgId, userId } = await requireAccess("inventory:manage");
    const locations = await getRegisterLocations();
    const loc = locations.find((l) => l.label === input.label);
    if (!loc) return { ok: false, title: "Choose one of your warehouses or your own people's field stock" };
    const item = (await getHeldItemsAt(input.label)).find((i) => i.productId === input.productId);
    if (!item) return { ok: false, title: "That item isn't held at this location" };
    const units = input.units.map((u) => ({ serialNo: u.serialNo.trim(), intendedUse: u.intendedUse }));
    if (!units.length) return { ok: false, title: "Enter at least one serial number" };
    if (units.some((u) => !u.serialNo)) return { ok: false, title: "Every machine needs a serial number" };
    if (units.length > item.missing) return { ok: false, title: `Only ${item.missing} of the ${item.qty} here still need a serial number` };
    if (units.some((u) => !Object.values(INTENDED_USE).includes(u.intendedUse as (typeof INTENDED_USE)[keyof typeof INTENDED_USE]))) return { ok: false, title: "Choose for sale, rental, loan or demo for each machine" };
    const lower = units.map((u) => u.serialNo.toLowerCase());
    const dup = units.find((u, i) => lower.indexOf(u.serialNo.toLowerCase()) !== i);
    if (dup) return { ok: false, title: `Serial number ${dup.serialNo} is entered twice` };
    const ownerOrgIds = await getOwnerOrgIds(orgId);
    const taken = await db.select({ serialNo: assetUnit.serialNo }).from(assetUnit)
      .where(and(eq(assetUnit.productId, input.productId), inArray(assetUnit.organizationId, ownerOrgIds), inArray(sql`lower(${assetUnit.serialNo})`, lower)));
    if (taken.length) return { ok: false, title: `Already registered: ${taken.map((t) => t.serialNo).join(", ")}` };

    const repId = loc.field ? input.label.slice("Field:".length) : null;
    await db.insert(assetUnit).values(units.map((u) => ({
      id: nanoid(), organizationId: orgId, productId: input.productId, serialNo: u.serialNo,
      status: repId ? ASSET_UNIT_STATUS.WITH_REP : ASSET_UNIT_STATUS.IN_STOCK, intendedUse: u.intendedUse,
      currentOrgId: orgId, currentWarehouseLabel: input.label, currentHolderUserId: repId,
      referenceType: "MANUAL", notes: input.notes?.trim() || "Serial number registered for a machine already in stock", registeredBy: userId,
    })));
    revalidatePath("/dashboard/inventory/serialized-units");
    revalidatePath("/dashboard/inventory");
    return { ok: true, count: units.length };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't register the serial numbers" };
  }
}

// ── Corrections (Serialized Units) ──────────────────────────────────────────
// A mistyped serial number, or a serial number entered for a machine that was
// never there. Quantities don't change. A held unit only (in a warehouse or
// with a specialist) — one that has been on a Case DO or consignment keeps its
// record (fix it instead of removing it).

async function heldUnit(unitId: string, orgId: string) {
  const [u] = await db.select().from(assetUnit).where(and(
    eq(assetUnit.id, unitId), inArray(assetUnit.status, HELD),
    or(eq(assetUnit.currentOrgId, orgId), and(isNull(assetUnit.currentOrgId), eq(assetUnit.organizationId, orgId))),
  )).limit(1);
  return u ?? null;
}

async function stampFor(userId: string) {
  const [me] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return `${new Date().toLocaleDateString("en-MY")} by ${me?.name ?? "—"}`;
}

export async function fixUnitSerial(unitId: string, serialNoInput: string, reason: string): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId, userId } = await requireAccess("inventory:manage");
    const serialNo = serialNoInput.trim();
    if (!serialNo) return { ok: false, title: "Enter the correct serial number" };
    if (reason.trim().length < 3) return { ok: false, title: "Give the reason for the correction" };
    const u = await heldUnit(unitId, orgId);
    if (!u) return { ok: false, title: "Only a machine held in a warehouse or by a specialist can be corrected here" };
    if (serialNo === u.serialNo) return { ok: false, title: "That is already its serial number" };
    const ownerOrgIds = await getOwnerOrgIds(orgId);
    const [dup] = await db.select({ id: assetUnit.id }).from(assetUnit).where(and(
      eq(assetUnit.productId, u.productId), inArray(assetUnit.organizationId, ownerOrgIds), ne(assetUnit.id, u.id),
      sql`lower(${assetUnit.serialNo}) = ${serialNo.toLowerCase()}`,
    )).limit(1);
    if (dup) return { ok: false, title: `Serial number ${serialNo} is already registered for this product` };
    await db.update(assetUnit).set({
      serialNo, updatedAt: new Date(),
      notes: [u.notes, `Serial corrected ${u.serialNo} → ${serialNo}: ${reason.trim()} (${await stampFor(userId)})`].filter(Boolean).join("\n"),
    }).where(eq(assetUnit.id, u.id));
    // the serial number is copied onto its history — keep it consistent
    const { consignLine } = await import("@/db/schema");
    await db.update(stockMovement).set({ serialNo }).where(eq(stockMovement.unitId, u.id));
    await db.update(consignLine).set({ serialNo }).where(eq(consignLine.unitId, u.id));
    revalidatePath("/dashboard/inventory/serialized-units");
    revalidatePath("/dashboard/inventory");
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't correct the serial number" };
  }
}

export async function removeUnitSerial(unitId: string, reason: string): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId } = await requireAccess("inventory:manage");
    if (reason.trim().length < 3) return { ok: false, title: "Give the reason for removing it" };
    const u = await heldUnit(unitId, orgId);
    if (!u) return { ok: false, title: "Only a machine held in a warehouse or by a specialist can be removed here" };
    const { consignLine, deliveryOrderItem } = await import("@/db/schema");
    const [cl] = await db.select({ id: consignLine.id }).from(consignLine).where(eq(consignLine.unitId, u.id)).limit(1);
    const [di] = await db.select({ id: deliveryOrderItem.id }).from(deliveryOrderItem).where(eq(deliveryOrderItem.unitId, u.id)).limit(1);
    if (cl || di) return { ok: false, title: `SN ${u.serialNo} has been on a ${cl ? "consignment" : "Case DO"} — correct its serial number instead of removing it` };
    // entered by mistake: the unit record goes; its movements stay (without the link)
    await db.update(stockMovement).set({ unitId: null }).where(eq(stockMovement.unitId, u.id));
    await db.delete(assetUnit).where(eq(assetUnit.id, u.id));
    revalidatePath("/dashboard/inventory/serialized-units");
    revalidatePath("/dashboard/inventory");
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't remove the serial number" };
  }
}
