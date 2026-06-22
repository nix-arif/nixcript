"use server";

import { db } from "@/db";
import { stockLevel, stockMovement, member, user, product } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { MOVEMENT_TYPE, REF_TYPE, fieldWarehouseLabel } from "@/lib/inventory/constants";
import { revalidatePath } from "next/cache";

async function getSession() {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("No active organization");
  return { orgId: session.session.activeOrganizationId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Access denied");
  return { orgId, userId };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RepStockItem {
  productId: string;
  productCode: string;
  description: string;
  uom: string | null;
  qty: number;
  unitCost: string | null;
}

export interface RepSummary {
  repId: string;
  repName: string;
  warehouseLabel: string;
  items: RepStockItem[];
  totalItems: number;
}

export interface OrgMember {
  id: string;
  name: string;
  role: string;
}

export interface FieldTransferItem {
  productId: string;
  qty: number;
}

export interface FieldTransferInput {
  repId: string;
  repName: string;
  items: FieldTransferItem[];
  notes?: string;
}

export interface FieldMovementRow {
  id: string;
  productId: string;
  productCode: string;
  warehouseLabel: string;
  warehouseTo: string | null;
  movementType: string;
  quantity: string;
  referenceNo: string;
  notes: string | null;
  createdAt: Date;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getFieldReps(): Promise<OrgMember[]> {
  const { orgId } = await requireAccess("inventory:read");
  const rows = await db
    .select({ id: member.userId, name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId))
    .orderBy(user.name);
  return rows.map((r) => ({ id: r.id, name: r.name ?? r.id, role: r.role }));
}

export async function getRepFieldStock(repId: string): Promise<RepStockItem[]> {
  const { orgId } = await requireAccess("inventory:read");
  const label = fieldWarehouseLabel(repId);
  const rows = await db
    .select({
      productId: stockLevel.productId,
      qty: stockLevel.quantity,
      unitCost: stockLevel.unitCost,
      productCode: product.productCode,
      description: product.description,
      uom: product.uom,
    })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.warehouseLabel, label)));

  return rows
    .map((r) => ({
      productId: r.productId,
      productCode: r.productCode,
      description: r.description ?? "",
      uom: r.uom ?? null,
      qty: parseFloat(r.qty),
      unitCost: r.unitCost,
    }))
    .filter((r) => r.qty > 0);
}

export async function getWarehouseStockQty(productId: string, warehouseLabel: string): Promise<number> {
  const { orgId } = await requireAccess("inventory:read");
  const [row] = await db
    .select({ quantity: stockLevel.quantity })
    .from(stockLevel)
    .where(and(
      eq(stockLevel.organizationId, orgId),
      eq(stockLevel.productId, productId),
      eq(stockLevel.warehouseLabel, warehouseLabel),
    ))
    .limit(1);
  return row ? parseFloat(row.quantity) : 0;
}

export async function getAllRepFieldStock(): Promise<RepSummary[]> {
  const { orgId } = await requireAccess("inventory:read");

  const rows = await db
    .select({
      productId: stockLevel.productId,
      qty: stockLevel.quantity,
      unitCost: stockLevel.unitCost,
      warehouseLabel: stockLevel.warehouseLabel,
      productCode: product.productCode,
      description: product.description,
      uom: product.uom,
    })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(
      eq(stockLevel.organizationId, orgId),
      sql`${stockLevel.warehouseLabel} LIKE 'Field:%'`,
    ));

  const repIds = [...new Set(rows.map((r) => r.warehouseLabel.replace("Field:", "")))];
  const repUsers = repIds.length > 0
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, repIds))
    : [];
  const userMap = Object.fromEntries(repUsers.map((u) => [u.id, u.name ?? u.id]));

  const repMap = new Map<string, RepSummary>();
  for (const row of rows) {
    const repId = row.warehouseLabel.replace("Field:", "");
    const qty = parseFloat(row.qty);
    if (qty <= 0) continue;
    if (!repMap.has(repId)) {
      repMap.set(repId, {
        repId,
        repName: userMap[repId] ?? repId,
        warehouseLabel: row.warehouseLabel,
        items: [],
        totalItems: 0,
      });
    }
    const rep = repMap.get(repId)!;
    rep.items.push({
      productId: row.productId,
      productCode: row.productCode,
      description: row.description ?? "",
      uom: row.uom ?? null,
      qty,
      unitCost: row.unitCost,
    });
    rep.totalItems += qty;
  }

  return [...repMap.values()].sort((a, b) => a.repName.localeCompare(b.repName));
}

export async function getFieldMovements(repId?: string): Promise<FieldMovementRow[]> {
  const { orgId } = await requireAccess("inventory:read");
  const rows = await db
    .select({
      id: stockMovement.id,
      productId: stockMovement.productId,
      productCode: stockMovement.productCode,
      warehouseLabel: stockMovement.warehouseLabel,
      warehouseTo: stockMovement.warehouseTo,
      movementType: stockMovement.movementType,
      quantity: stockMovement.quantity,
      referenceNo: stockMovement.referenceNo,
      notes: stockMovement.notes,
      createdAt: stockMovement.createdAt,
    })
    .from(stockMovement)
    .where(and(
      eq(stockMovement.organizationId, orgId),
      sql`${stockMovement.movementType} IN ('FIELD_OUT','FIELD_RETURN','CASE_USE')`,
      repId ? sql`(${stockMovement.warehouseLabel} = ${fieldWarehouseLabel(repId)} OR ${stockMovement.warehouseTo} = ${fieldWarehouseLabel(repId)})` : sql`1=1`,
    ))
    .orderBy(desc(stockMovement.createdAt))
    .limit(200);
  return rows as FieldMovementRow[];
}

// ── Mutations ─────────────────────────────────────────────────────────────────

async function updateStockLevel(orgId: string, productId: string, warehouseLabel: string, delta: number, unitCost: string | null, now: Date) {
  const [existing] = await db.select().from(stockLevel)
    .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.productId, productId), eq(stockLevel.warehouseLabel, warehouseLabel)))
    .limit(1);

  const newQty = parseFloat(existing?.quantity ?? "0") + delta;
  if (newQty < 0) throw new Error(`Insufficient stock for ${productId} in ${warehouseLabel} (available: ${parseFloat(existing?.quantity ?? "0")})`);

  if (existing) {
    await db.update(stockLevel).set({ quantity: newQty.toFixed(4), updatedAt: now }).where(eq(stockLevel.id, existing.id));
  } else {
    if (delta < 0) throw new Error(`No stock found for ${productId} in ${warehouseLabel}`);
    await db.insert(stockLevel).values({
      id: nanoid(), organizationId: orgId, productId, warehouseLabel,
      quantity: newQty.toFixed(4), reservedQty: "0", unitCost, updatedAt: now,
    });
  }
  return newQty;
}

export async function transferToRep(input: FieldTransferInput): Promise<string> {
  const { orgId, userId } = await requireAccess("inventory:create");
  const transferId = nanoid();
  const year = new Date().getFullYear();
  const referenceNo = `FT-${year}-${transferId.slice(0, 6).toUpperCase()}`;
  const fieldLabel = fieldWarehouseLabel(input.repId);
  const now = new Date();

  for (const item of input.items) {
    if (item.qty <= 0) continue;

    const [prod] = await db.select({ productCode: product.productCode, unitCost: stockLevel.unitCost })
      .from(product)
      .leftJoin(stockLevel, and(
        eq(stockLevel.productId, product.id),
        eq(stockLevel.organizationId, orgId),
        eq(stockLevel.warehouseLabel, "Default"),
      ))
      .where(and(eq(product.id, item.productId), eq(product.organizationId, orgId)))
      .limit(1);
    if (!prod) continue;

    const srcBalance = await updateStockLevel(orgId, item.productId, "Default", -item.qty, null, now);
    await updateStockLevel(orgId, item.productId, fieldLabel, item.qty, prod.unitCost, now);

    await db.insert(stockMovement).values({
      id: nanoid(), organizationId: orgId, productId: item.productId,
      productCode: prod.productCode, warehouseLabel: "Default", warehouseTo: fieldLabel,
      movementType: MOVEMENT_TYPE.FIELD_OUT,
      quantity: (-item.qty).toFixed(4), balanceAfter: srcBalance.toFixed(4),
      referenceType: REF_TYPE.FIELD_TRANSFER, referenceId: transferId, referenceNo,
      notes: `Field transfer to ${input.repName}${input.notes ? ` — ${input.notes}` : ""}`,
      status: "APPROVED", reviewedBy: userId, reviewedAt: now, createdBy: userId, createdAt: now,
    });
  }

  revalidatePath("/dashboard/inventory/field-stock");
  revalidatePath("/dashboard/inventory");
  return referenceNo;
}

export async function returnFromRep(input: FieldTransferInput): Promise<string> {
  const { orgId, userId } = await requireAccess("inventory:create");
  const transferId = nanoid();
  const year = new Date().getFullYear();
  const referenceNo = `FR-${year}-${transferId.slice(0, 6).toUpperCase()}`;
  const fieldLabel = fieldWarehouseLabel(input.repId);
  const now = new Date();

  for (const item of input.items) {
    if (item.qty <= 0) continue;

    const [prod] = await db.select({ productCode: product.productCode })
      .from(product)
      .where(and(eq(product.id, item.productId), eq(product.organizationId, orgId)))
      .limit(1);
    if (!prod) continue;

    const [fieldLevel] = await db.select({ unitCost: stockLevel.unitCost })
      .from(stockLevel)
      .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.productId, item.productId), eq(stockLevel.warehouseLabel, fieldLabel)))
      .limit(1);

    const fieldBalance = await updateStockLevel(orgId, item.productId, fieldLabel, -item.qty, null, now);
    await updateStockLevel(orgId, item.productId, "Default", item.qty, fieldLevel?.unitCost ?? null, now);

    await db.insert(stockMovement).values({
      id: nanoid(), organizationId: orgId, productId: item.productId,
      productCode: prod.productCode, warehouseLabel: fieldLabel, warehouseTo: "Default",
      movementType: MOVEMENT_TYPE.FIELD_RETURN,
      quantity: (-item.qty).toFixed(4), balanceAfter: fieldBalance.toFixed(4),
      referenceType: REF_TYPE.FIELD_TRANSFER, referenceId: transferId, referenceNo,
      notes: `Field return from ${input.repName}${input.notes ? ` — ${input.notes}` : ""}`,
      status: "APPROVED", reviewedBy: userId, reviewedAt: now, createdBy: userId, createdAt: now,
    });
  }

  revalidatePath("/dashboard/inventory/field-stock");
  revalidatePath("/dashboard/inventory");
  return referenceNo;
}
