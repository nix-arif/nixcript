"use server";

import { db } from "@/db";
import {
  consignment,
  consignmentCounter,
  consignmentItem,
  consignmentUsage,
  salesOrder,
  customer,
  stockMovement,
  product,
  stockLevel,
  user,
} from "@/db/schema";
import { buildCustomerSnapshot } from "@/server/customer";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { nanoid } from "nanoid";
import {
  eq, and, desc, inArray, sql, asc,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";

async function getSession() {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("No active organization");
  return { session, orgId: session.session.activeOrganizationId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Access denied");
  return { session, orgId, userId };
}

// ── Number generation ─────────────────────────────────────────────────────────

async function generateConsignmentNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "co");
  const year = new Date().getFullYear();

  const existing = await db
    .select()
    .from(consignmentCounter)
    .where(eq(consignmentCounter.organizationId, orgId))
    .limit(1);

  let nextNo: number;
  if (existing.length === 0) {
    await db.insert(consignmentCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db
      .update(consignmentCounter)
      .set({ year, lastNumber: nextNo })
      .where(eq(consignmentCounter.organizationId, orgId));
  }

  return buildDocumentNo(cfg, year, nextNo);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConsignmentRow = typeof consignment.$inferSelect;
export type ConsignmentItemRow = typeof consignmentItem.$inferSelect;
export type ConsignmentUsageRow = typeof consignmentUsage.$inferSelect;

export interface CreateConsignmentInput {
  soId: string;
  soNo: string;
  customerId?: string | null;
  sentDate?: Date;
  expiryDate?: Date;
  notes?: string;
  items: {
    productId?: string | null;
    productCode?: string;
    description: string;
    uom?: string;
    unitPrice: string;
    qtySent: string;
  }[];
}

export interface RecordUsageInput {
  consignmentId: string;
  type: "used" | "returned";
  usageDate: Date;
  notes?: string;
  items: { consignmentItemId: string; qty: string }[];
}

export type ConsignmentDetail = ConsignmentRow & {
  items: ConsignmentItemRow[];
  usages: (ConsignmentUsageRow & { recordedByName: string | null })[];
  soStatus: string | null;
};

export type ConsignmentSummary = ConsignmentRow & {
  itemCount: number;
  totalValue: string;
  customerName: string | null;
  customerOrg: string | null;
};

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getConsignments(): Promise<ConsignmentSummary[]> {
  const { orgId } = await requireAccess("sales-order:read");

  const rows = await db
    .select()
    .from(consignment)
    .where(eq(consignment.organizationId, orgId))
    .orderBy(desc(consignment.createdAt));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const items = await db
    .select()
    .from(consignmentItem)
    .where(inArray(consignmentItem.consignmentId, ids));

  const itemsByConsignment: Record<string, ConsignmentItemRow[]> = {};
  for (const item of items) {
    if (!itemsByConsignment[item.consignmentId]) itemsByConsignment[item.consignmentId] = [];
    itemsByConsignment[item.consignmentId].push(item);
  }

  return rows.map((row) => {
    const snap = row.customerSnapshot as any;
    const its = itemsByConsignment[row.id] ?? [];
    const totalValue = its.reduce((s, i) => {
      const remaining = parseFloat(i.qtySent) - parseFloat(i.qtyUsed) - parseFloat(i.qtyReturned);
      return s + remaining * parseFloat(i.unitPrice);
    }, 0).toFixed(2);

    return {
      ...row,
      itemCount: its.length,
      totalValue,
      customerName: snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null,
      customerOrg: snap?.organizationName ?? null,
    };
  });
}

export async function getConsignmentDetail(id: string): Promise<ConsignmentDetail | null> {
  const { orgId } = await requireAccess("sales-order:read");

  const [row] = await db
    .select()
    .from(consignment)
    .where(and(eq(consignment.id, id), eq(consignment.organizationId, orgId)));
  if (!row) return null;

  const [items, usageRows, soRow] = await Promise.all([
    db.select().from(consignmentItem).where(eq(consignmentItem.consignmentId, id)).orderBy(asc(consignmentItem.id)),
    db.select().from(consignmentUsage).where(eq(consignmentUsage.consignmentId, id)).orderBy(desc(consignmentUsage.createdAt)),
    db.select({ status: salesOrder.status }).from(salesOrder).where(and(eq(salesOrder.id, row.soId), eq(salesOrder.organizationId, orgId))).limit(1),
  ]);

  const recorderIds = [...new Set(usageRows.map((u) => u.recordedBy))];
  const recorders = recorderIds.length > 0
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, recorderIds))
    : [];
  const recorderMap = Object.fromEntries(recorders.map((r) => [r.id, r.name]));

  return {
    ...row,
    items,
    usages: usageRows.map((u) => ({ ...u, recordedByName: recorderMap[u.recordedBy] ?? null })),
    soStatus: soRow[0]?.status ?? null,
  };
}

export async function getConsignmentsBySo(soId: string): Promise<ConsignmentRow[]> {
  const { orgId } = await requireAccess("sales-order:read");
  return db
    .select()
    .from(consignment)
    .where(and(eq(consignment.soId, soId), eq(consignment.organizationId, orgId)))
    .orderBy(desc(consignment.createdAt));
}

// For inventory dashboard consignment section
export async function getActiveConsignmentItems(): Promise<{
  consignmentId: string;
  consignmentNo: string;
  customerName: string | null;
  customerOrg: string | null;
  sentDate: Date | null;
  item: ConsignmentItemRow;
}[]> {
  const { orgId } = await requireAccess("inventory:read");

  const rows = await db
    .select()
    .from(consignment)
    .where(and(eq(consignment.organizationId, orgId), eq(consignment.status, "active")));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const items = await db
    .select()
    .from(consignmentItem)
    .where(inArray(consignmentItem.consignmentId, ids));

  const result: {
    consignmentId: string;
    consignmentNo: string;
    customerName: string | null;
    customerOrg: string | null;
    sentDate: Date | null;
    item: ConsignmentItemRow;
  }[] = [];

  for (const row of rows) {
    const snap = row.customerSnapshot as any;
    const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
    const customerOrg = snap?.organizationName ?? null;
    const rowItems = items.filter((i) => i.consignmentId === row.id);
    for (const item of rowItems) {
      const remaining = parseFloat(item.qtySent) - parseFloat(item.qtyUsed) - parseFloat(item.qtyReturned);
      if (remaining > 0) {
        result.push({ consignmentId: row.id, consignmentNo: row.consignmentNo, customerName, customerOrg, sentDate: row.sentDate, item });
      }
    }
  }

  return result;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createConsignment(input: CreateConsignmentInput): Promise<ConsignmentRow> {
  const { orgId, userId } = await requireAccess("sales-order:update");

  // soId is client-supplied — confirm it belongs to the caller's org before
  // storing it on the consignment.
  const [so] = await db
    .select({ id: salesOrder.id })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, input.soId), eq(salesOrder.organizationId, orgId)))
    .limit(1);
  if (!so) throw new Error("Sales order not found");

  // Build customer snapshot
  const customerSnapshot: ConsignmentRow["customerSnapshot"] = input.customerId
    ? await buildCustomerSnapshot(input.customerId, orgId)
    : null;

  const consignmentNo = await generateConsignmentNo(orgId);

  const [row] = await db
    .insert(consignment)
    .values({
      id: nanoid(),
      organizationId: orgId,
      consignmentNo,
      soId: input.soId,
      soNo: input.soNo,
      customerId: input.customerId ?? null,
      customerSnapshot,
      sentDate: input.sentDate ?? null,
      expiryDate: input.expiryDate ?? null,
      notes: input.notes ?? null,
      status: "active",
      createdBy: userId,
    })
    .returning();

  // Insert items
  if (input.items.length > 0) {
    await db.insert(consignmentItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        consignmentId: row.id,
        organizationId: orgId,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description,
        uom: item.uom ?? null,
        unitPrice: item.unitPrice,
        qtySent: item.qtySent,
        qtyUsed: "0",
        qtyReturned: "0",
      })),
    );

    // Create CONSIGN_OUT stock movements for catalog-linked items
    for (const item of input.items) {
      if (!item.productId) continue;
      const qty = parseFloat(item.qtySent);
      if (qty <= 0) continue;

      const [prod] = await db.select({ productCode: product.productCode }).from(product).where(eq(product.id, item.productId)).limit(1);
      if (!prod) continue;

      await db.insert(stockMovement).values({
        id: nanoid(),
        organizationId: orgId,
        productId: item.productId,
        productCode: prod.productCode,
        warehouseLabel: "Default",
        movementType: MOVEMENT_TYPE.CONSIGN_OUT,
        quantity: String(-qty),
        referenceType: REF_TYPE.CONSIGNMENT,
        referenceId: row.id,
        referenceNo: consignmentNo,
        notes: `Consignment out to ${customerSnapshot?.name ?? "customer"}`,
        status: "APPROVED",
        createdBy: userId,
      });

      // Deduct from stock level
      await db
        .insert(stockLevel)
        .values({ id: nanoid(), organizationId: orgId, productId: item.productId, warehouseLabel: "Default", quantity: String(-qty) })
        .onConflictDoUpdate({
          target: [stockLevel.organizationId, stockLevel.productId, stockLevel.warehouseLabel],
          set: { quantity: sql`${stockLevel.quantity} + ${String(-qty)}` },
        });
    }
  }

  revalidatePath("/dashboard/sales/consignment");
  revalidatePath(`/dashboard/sales/order/${input.soId}`);
  revalidatePath("/dashboard/inventory");

  return row;
}

export async function recordConsignmentUsage(input: RecordUsageInput): Promise<void> {
  const { orgId, userId } = await requireAccess("sales-order:update");

  const [con] = await db
    .select()
    .from(consignment)
    .where(and(eq(consignment.id, input.consignmentId), eq(consignment.organizationId, orgId)));
  if (!con) throw new Error("Consignment not found");
  if (con.status !== "active") throw new Error("Consignment is not active");

  // Validate quantities and fetch items
  const itemIds = input.items.map((i) => i.consignmentItemId);
  const items = await db
    .select()
    .from(consignmentItem)
    .where(and(eq(consignmentItem.consignmentId, input.consignmentId), inArray(consignmentItem.id, itemIds)));

  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));

  for (const entry of input.items) {
    const item = itemMap[entry.consignmentItemId];
    if (!item) throw new Error(`Item ${entry.consignmentItemId} not found`);
    const qty = parseFloat(entry.qty);
    if (qty <= 0) continue;
    const remaining = parseFloat(item.qtySent) - parseFloat(item.qtyUsed) - parseFloat(item.qtyReturned);
    if (qty > remaining) throw new Error(`Qty exceeds remaining for ${item.description} (remaining: ${remaining})`);
  }

  // Insert usage record
  await db.insert(consignmentUsage).values({
    id: nanoid(),
    consignmentId: input.consignmentId,
    organizationId: orgId,
    usageDate: input.usageDate,
    type: input.type,
    notes: input.notes ?? null,
    recordedBy: userId,
    items: input.items,
  });

  // Update item quantities
  for (const entry of input.items) {
    const qty = parseFloat(entry.qty);
    if (qty <= 0) continue;
    const item = itemMap[entry.consignmentItemId];
    if (!item) continue;

    if (input.type === "used") {
      await db
        .update(consignmentItem)
        .set({ qtyUsed: String(parseFloat(item.qtyUsed) + qty) })
        .where(eq(consignmentItem.id, entry.consignmentItemId));
    } else {
      await db
        .update(consignmentItem)
        .set({ qtyReturned: String(parseFloat(item.qtyReturned) + qty) })
        .where(eq(consignmentItem.id, entry.consignmentItemId));

      // CONSIGN_RETURN movement — stock comes back to warehouse
      if (item.productId) {
        const [prod] = await db.select({ productCode: product.productCode }).from(product).where(eq(product.id, item.productId)).limit(1);
        if (prod) {
          await db.insert(stockMovement).values({
            id: nanoid(),
            organizationId: orgId,
            productId: item.productId,
            productCode: prod.productCode,
            warehouseLabel: "Default",
            movementType: MOVEMENT_TYPE.CONSIGN_RETURN,
            quantity: String(qty),
            referenceType: REF_TYPE.CONSIGNMENT,
            referenceId: input.consignmentId,
            referenceNo: con.consignmentNo,
            notes: `Consignment return`,
            status: "APPROVED",
            createdBy: userId,
          });

          await db
            .insert(stockLevel)
            .values({ id: nanoid(), organizationId: orgId, productId: item.productId, warehouseLabel: "Default", quantity: String(qty) })
            .onConflictDoUpdate({
              target: [stockLevel.organizationId, stockLevel.productId, stockLevel.warehouseLabel],
              set: { quantity: sql`${stockLevel.quantity} + ${String(qty)}` },
            });
        }
      }
    }
  }

  revalidatePath(`/dashboard/sales/consignment/${input.consignmentId}`);
  revalidatePath("/dashboard/inventory");
}

export async function closeConsignment(id: string): Promise<void> {
  const { orgId } = await requireAccess("sales-order:update");
  await db
    .update(consignment)
    .set({ status: "closed" })
    .where(and(eq(consignment.id, id), eq(consignment.organizationId, orgId)));
  revalidatePath(`/dashboard/sales/consignment/${id}`);
  revalidatePath("/dashboard/sales/consignment");
}
