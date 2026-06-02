"use server";

import { db } from "@/db";
import {
  stockRequest,
  staffStockLimit,
  stockLevel,
  organizationProfile,
  product,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { createApprovedMovement } from "@/lib/inventory/create-movement";
import { MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";
import { nanoid } from "nanoid";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// ── Auth ──────────────────────────────────────────────────────────────────

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Forbidden");
  return { session, orgId, userId };
}

// ── Types ─────────────────────────────────────────────────────────────────

export type StockRequestRow = typeof stockRequest.$inferSelect;
export type StaffStockLimitRow = typeof staffStockLimit.$inferSelect;

export type StockRequestWithMeta = StockRequestRow & {
  requestedByName: string | null;
  approvedByName: string | null;
};

export type StaffAllocation = {
  userId: string;
  userName: string | null;
  warehouseLabel: string;
  productId: string;
  productCode: string;
  description: string | null;
  uom: string | null;
  onHand: number;
  maxQty: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function staffWarehouseLabel(userName: string) {
  return `Field - ${userName}`;
}

async function ensureStaffWarehouse(orgId: string, warehouseLabel: string) {
  const [profile] = await db
    .select({ warehouseAddresses: organizationProfile.warehouseAddresses })
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId))
    .limit(1);

  const existing = (profile?.warehouseAddresses as { label: string; address: string }[] | null) ?? [];
  if (existing.some((w) => w.label === warehouseLabel)) return;

  await db
    .update(organizationProfile)
    .set({ warehouseAddresses: [...existing, { label: warehouseLabel, address: "Field Stock" }] })
    .where(eq(organizationProfile.organizationId, orgId));
}

async function getStaffCurrentHolding(orgId: string, userId: string, productId: string): Promise<number> {
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  if (!u?.name) return 0;
  const wh = staffWarehouseLabel(u.name);
  const [sl] = await db
    .select({ quantity: stockLevel.quantity })
    .from(stockLevel)
    .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.productId, productId), eq(stockLevel.warehouseLabel, wh)))
    .limit(1);
  return sl ? parseFloat(sl.quantity) : 0;
}

// ── Queries ───────────────────────────────────────────────────────────────

export async function getStockRequests(): Promise<StockRequestWithMeta[]> {
  const { orgId, userId } = await requireAccess("inventory:read");
  const perms = await getUserPermissions(userId, orgId);
  const isManager = hasAccess(perms, "inventory:approve") || hasAccess(perms, "*");

  const rows = isManager
    ? await db.select().from(stockRequest).where(eq(stockRequest.organizationId, orgId)).orderBy(desc(stockRequest.createdAt))
    : await db.select().from(stockRequest).where(and(eq(stockRequest.organizationId, orgId), eq(stockRequest.requestedBy, userId))).orderBy(desc(stockRequest.createdAt));

  if (rows.length === 0) return [];

  const userIds = [...new Set([...rows.map((r) => r.requestedBy), ...rows.map((r) => r.approvedBy).filter(Boolean) as string[]])];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, userIds[0]));
  const allUsers = userIds.length > 1
    ? await db.select({ id: user.id, name: user.name }).from(user)
    : users;
  const nameOf = (id: string | null) => id ? (allUsers.find((u) => u.id === id)?.name ?? null) : null;

  return rows.map((r) => ({
    ...r,
    requestedByName: nameOf(r.requestedBy),
    approvedByName: nameOf(r.approvedBy ?? null),
  }));
}

export async function getStaffAllocations(): Promise<StaffAllocation[]> {
  const { orgId } = await requireAccess("inventory:read");

  // Find all "Field - " warehouses in stockLevel
  const rows = await db
    .select({
      sl: stockLevel,
      productCode: product.productCode,
      description: product.description,
      uom: product.uom,
    })
    .from(stockLevel)
    .innerJoin(product, eq(stockLevel.productId, product.id))
    .where(eq(stockLevel.organizationId, orgId));

  const fieldRows = rows.filter((r) => r.sl.warehouseLabel.startsWith("Field - "));
  if (fieldRows.length === 0) return [];

  // Map warehouse label → user
  const limits = await db.select().from(staffStockLimit).where(eq(staffStockLimit.organizationId, orgId));
  const users = await db.select({ id: user.id, name: user.name }).from(user);

  return fieldRows
    .filter((r) => parseFloat(r.sl.quantity) > 0)
    .map((r) => {
      const staffName = r.sl.warehouseLabel.replace("Field - ", "");
      const staffUser = users.find((u) => u.name === staffName);
      const limit = staffUser
        ? limits.find((l) => l.userId === staffUser.id && l.productId === r.sl.productId)
        : null;
      return {
        userId: staffUser?.id ?? "",
        userName: staffName,
        warehouseLabel: r.sl.warehouseLabel,
        productId: r.sl.productId,
        productCode: r.productCode,
        description: r.description,
        uom: r.uom,
        onHand: parseFloat(r.sl.quantity),
        maxQty: limit ? parseFloat(limit.maxQty) : null,
      };
    });
}

export async function getStaffStockLimits(): Promise<(StaffStockLimitRow & { userName: string | null; productCode: string | null })[]> {
  const { orgId } = await requireAccess("inventory:manage");

  const rows = await db.select().from(staffStockLimit).where(eq(staffStockLimit.organizationId, orgId));
  if (rows.length === 0) return [];

  const users = await db.select({ id: user.id, name: user.name }).from(user);
  const products = await db.select({ id: product.id, productCode: product.productCode }).from(product).where(eq(product.organizationId, orgId));

  return rows.map((r) => ({
    ...r,
    userName: users.find((u) => u.id === r.userId)?.name ?? null,
    productCode: products.find((p) => p.id === r.productId)?.productCode ?? null,
  }));
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function createStockRequest(data: {
  productId: string;
  qty: number;
  warehouseFrom?: string;
  notes?: string;
}): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:request");

  if (data.qty <= 0) throw new Error("Quantity must be greater than zero");

  const [prod] = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(eq(product.id, data.productId), eq(product.organizationId, orgId)))
    .limit(1);
  if (!prod) throw new Error("Product not found");

  // Check against limit if one exists
  const [limit] = await db
    .select()
    .from(staffStockLimit)
    .where(and(eq(staffStockLimit.organizationId, orgId), eq(staffStockLimit.userId, userId), eq(staffStockLimit.productId, data.productId)))
    .limit(1);

  if (limit) {
    const current = await getStaffCurrentHolding(orgId, userId, data.productId);
    if (current + data.qty > parseFloat(limit.maxQty)) {
      throw new Error(`Request would exceed your holding limit of ${limit.maxQty} units for ${prod.productCode}. You currently hold ${current} units.`);
    }
  }

  await db.insert(stockRequest).values({
    id: nanoid(),
    organizationId: orgId,
    requestedBy: userId,
    productId: data.productId,
    productCode: prod.productCode,
    warehouseFrom: data.warehouseFrom ?? "Default",
    qty: data.qty.toFixed(4),
    notes: data.notes?.trim() || null,
    status: "pending",
    createdAt: new Date(),
  });

  revalidatePath("/dashboard/inventory/requests");
}

export async function approveStockRequest(id: string, approvedQty: number, notes?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:approve");

  const [req] = await db
    .select()
    .from(stockRequest)
    .where(and(eq(stockRequest.id, id), eq(stockRequest.organizationId, orgId)))
    .limit(1);

  if (!req) throw new Error("Request not found");
  if (req.status !== "pending") throw new Error("Only pending requests can be approved");
  if (approvedQty <= 0) throw new Error("Approved quantity must be greater than zero");

  // Check limit
  const [limit] = await db
    .select()
    .from(staffStockLimit)
    .where(and(eq(staffStockLimit.organizationId, orgId), eq(staffStockLimit.userId, req.requestedBy), eq(staffStockLimit.productId, req.productId)))
    .limit(1);

  if (limit) {
    const current = await getStaffCurrentHolding(orgId, req.requestedBy, req.productId);
    if (current + approvedQty > parseFloat(limit.maxQty)) {
      throw new Error(`Approval would exceed staff holding limit of ${limit.maxQty} units. Staff currently holds ${current} units.`);
    }
  }

  // Get staff name to derive warehouse label
  const [staffUser] = await db.select({ name: user.name }).from(user).where(eq(user.id, req.requestedBy)).limit(1);
  if (!staffUser?.name) throw new Error("Staff user not found");

  const destWarehouse = staffWarehouseLabel(staffUser.name);

  // Ensure the staff warehouse exists in the org profile
  await ensureStaffWarehouse(orgId, destWarehouse);

  // Mark approved
  await db.update(stockRequest)
    .set({ status: "approved", approvedBy: userId, approvedQty: approvedQty.toFixed(4), approvedAt: new Date(), approvedNotes: notes?.trim() || null })
    .where(eq(stockRequest.id, id));

  // Transfer stock: source warehouse → staff warehouse (STOCK_OUT + STOCK_IN pair via TRANSFER type)
  await createApprovedMovement({
    orgId,
    userId,
    productId: req.productId,
    warehouseLabel: req.warehouseFrom,
    movementType: MOVEMENT_TYPE.STOCK_OUT,
    quantity: approvedQty,
    referenceType: REF_TYPE.MANUAL,
    referenceId: id,
    referenceNo: `SR-${id.slice(0, 8).toUpperCase()}`,
    notes: `Stock allocated to ${staffUser.name}`,
  });

  await createApprovedMovement({
    orgId,
    userId,
    productId: req.productId,
    warehouseLabel: destWarehouse,
    movementType: MOVEMENT_TYPE.STOCK_IN,
    quantity: approvedQty,
    referenceType: REF_TYPE.MANUAL,
    referenceId: id,
    referenceNo: `SR-${id.slice(0, 8).toUpperCase()}`,
    notes: `Stock allocated from ${req.warehouseFrom}`,
  });

  // Mark fulfilled
  await db.update(stockRequest)
    .set({ status: "fulfilled", fulfilledAt: new Date() })
    .where(eq(stockRequest.id, id));

  revalidatePath("/dashboard/inventory/requests");
  revalidatePath("/dashboard/inventory");
}

export async function rejectStockRequest(id: string, reason: string): Promise<void> {
  const { orgId } = await requireAccess("inventory:approve");

  if (!reason.trim()) throw new Error("Rejection reason is required");

  const [req] = await db
    .select({ status: stockRequest.status })
    .from(stockRequest)
    .where(and(eq(stockRequest.id, id), eq(stockRequest.organizationId, orgId)))
    .limit(1);

  if (!req) throw new Error("Request not found");
  if (req.status !== "pending") throw new Error("Only pending requests can be rejected");

  await db.update(stockRequest)
    .set({ status: "rejected", approvedNotes: reason.trim() })
    .where(eq(stockRequest.id, id));

  revalidatePath("/dashboard/inventory/requests");
}

export async function setStaffStockLimit(data: {
  userId: string;
  productId: string;
  maxQty: number;
}): Promise<void> {
  const { orgId, userId: managerId } = await requireAccess("inventory:manage");

  if (data.maxQty < 0) throw new Error("Max quantity cannot be negative");

  const [prod] = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(eq(product.id, data.productId), eq(product.organizationId, orgId)))
    .limit(1);
  if (!prod) throw new Error("Product not found");

  const existing = await db
    .select({ id: staffStockLimit.id })
    .from(staffStockLimit)
    .where(and(eq(staffStockLimit.organizationId, orgId), eq(staffStockLimit.userId, data.userId), eq(staffStockLimit.productId, data.productId)))
    .limit(1);

  if (existing.length > 0) {
    await db.update(staffStockLimit)
      .set({ maxQty: data.maxQty.toFixed(4), setBy: managerId, updatedAt: new Date() })
      .where(eq(staffStockLimit.id, existing[0].id));
  } else {
    await db.insert(staffStockLimit).values({
      id: nanoid(),
      organizationId: orgId,
      userId: data.userId,
      productId: data.productId,
      maxQty: data.maxQty.toFixed(4),
      setBy: managerId,
      updatedAt: new Date(),
    });
  }

  revalidatePath("/dashboard/inventory/requests");
}

export async function deleteStaffStockLimit(id: string): Promise<void> {
  const { orgId } = await requireAccess("inventory:manage");
  await db.delete(staffStockLimit).where(and(eq(staffStockLimit.id, id), eq(staffStockLimit.organizationId, orgId)));
  revalidatePath("/dashboard/inventory/requests");
}
