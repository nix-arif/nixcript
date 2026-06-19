"use server";

import { db } from "@/db";
import {
  deliveryOrder,
  deliveryOrderItem,
  deliveryOrderCounter,
  customer,
  user,
  salesOrder,
  salesOrderItem,
  customerPurchaseOrder,
  invoice,
  quotation,
  purchaseOrder,
  purchaseOrderItem,
} from "@/db/schema";
import { buildCustomerSnapshot } from "@/server/customer";
import { getCachedSession } from "@/lib/auth/cached-session";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, isNotNull, isNull, notExists, ne, sql, or, count } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { createApprovedMovement, adjustReservation } from "@/lib/inventory/create-movement";
import { MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { session, orgId, userId };
}


async function generateDoNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "do");
  const year = new Date().getFullYear();
  const existing = await db
    .select()
    .from(deliveryOrderCounter)
    .where(eq(deliveryOrderCounter.organizationId, orgId))
    .limit(1);
  let nextNo: number;
  if (existing.length === 0) {
    await db.insert(deliveryOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db.update(deliveryOrderCounter).set({ year, lastNumber: nextNo }).where(eq(deliveryOrderCounter.organizationId, orgId));
  }
  return buildDocumentNo(cfg, year, nextNo);
}

export type DeliveryOrderRow = typeof deliveryOrder.$inferSelect;
export type DeliveryOrderItem = typeof deliveryOrderItem.$inferSelect;
export type DeliveryOrderWithItems = DeliveryOrderRow & { items: DeliveryOrderItem[]; createdByName: string | null; invoiceId: string | null; invoiceNo: string | null };
export type DeliveryOrderListRow = DeliveryOrderRow & { createdByName: string | null; invoiceId: string | null; invoiceNo: string | null };

export type DoForInvoice = {
  id: string;
  doNo: string;
  salesOrderId: string | null;
  salesOrderNo: string | null;
  customerPoId: string | null;
  customerPoNo: string | null;
  customerId: string | null;
  customerSnapshot: { title?: string; name: string; organizationName?: string; organizationAddress?: string; email?: string; contactNo?: string } | null;
  // From linked SO (when available)
  salesPersonId: string | null;
  salesPersonName: string | null;
  associateSalesPersons: { id: string; name: string }[] | null;
  quotationId: string | null;
  quotationNo: string | null;
  // From linked quotation (via SO)
  paymentTerm: string | null;
  paymentTermDays: number | null;
  dueDate: Date | null;
  // From linked purchase order (via SO)
  supplierId: string | null;
  deliveryDate: Date | null;
  deliveryAddress: string | null;
  items: Array<{
    rowNo: number;
    productId: string | null;
    productCode: string | null;
    description: string | null;
    qty: string | null;
    uom: string | null;
    unitPrice: string | null;
    discountPct: string | null;
    costUnitPrice: string | null;
    lineType: string | null;
    rentalDuration: string | null;
    rentalUnit: string | null;
    setGroupId: string | null;
    setGroupLabel: string | null;
    setQty: string | null;
  }>;
};

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft"]);

// ── Fulfillment helpers ────────────────────────────────────────────────────

export type SoItemRemaining = {
  soItemId: string;
  rowNo: number;
  productId: string | null;
  productCode: string | null;
  description: string | null;
  uom: string | null;
  sourceCustomerPoId: string | null;
  originalQty: string;
  deliveredQty: string;
  remainingQty: string;
};

// Called after creating a DO — if every SO item is fully covered, closes the SO.
async function checkAndFulfillSo(soId: string, orgId: string): Promise<void> {
  const soItems = await db
    .select({ id: salesOrderItem.id, qty: salesOrderItem.qty })
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, soId));

  if (soItems.length === 0) return;

  const itemIds = soItems.map((i) => i.id);

  const deliveredRows = await db
    .select({
      soItemId: deliveryOrderItem.soItemId,
      total: sql<string>`coalesce(sum(${deliveryOrderItem.qty}::numeric), 0)::text`,
    })
    .from(deliveryOrderItem)
    .innerJoin(deliveryOrder, eq(deliveryOrderItem.deliveryOrderId, deliveryOrder.id))
    .where(and(
      eq(deliveryOrder.salesOrderId, soId),
      eq(deliveryOrder.organizationId, orgId),
      ne(deliveryOrder.status, "cancelled"),
      inArray(deliveryOrderItem.soItemId as any, itemIds),
    ))
    .groupBy(deliveryOrderItem.soItemId);

  const deliveredMap = new Map(deliveredRows.map((r) => [r.soItemId as string, parseFloat(r.total)]));

  const allFulfilled = soItems.every((item) => {
    const delivered = deliveredMap.get(item.id) ?? 0;
    return delivered >= parseFloat(item.qty ?? "0");
  });

  if (allFulfilled) {
    await db
      .update(salesOrder)
      .set({ status: "fulfilled", updatedAt: new Date() })
      .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  }
}

// Returns per-item remaining quantities for the create-DO form.
export async function getSoRemainingItems(soId: string): Promise<SoItemRemaining[]> {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;

  const items = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, soId))
    .orderBy(asc(salesOrderItem.rowNo));

  if (items.length === 0) return [];

  const itemIds = items.map((i) => i.id);

  const deliveredRows = await db
    .select({
      soItemId: deliveryOrderItem.soItemId,
      total: sql<string>`coalesce(sum(${deliveryOrderItem.qty}::numeric), 0)::text`,
    })
    .from(deliveryOrderItem)
    .innerJoin(deliveryOrder, eq(deliveryOrderItem.deliveryOrderId, deliveryOrder.id))
    .where(and(
      eq(deliveryOrder.salesOrderId, soId),
      eq(deliveryOrder.organizationId, orgId),
      ne(deliveryOrder.status, "cancelled"),
      inArray(deliveryOrderItem.soItemId as any, itemIds),
    ))
    .groupBy(deliveryOrderItem.soItemId);

  const deliveredMap = new Map(deliveredRows.map((r) => [r.soItemId as string, parseFloat(r.total)]));

  return items.map((item) => {
    const originalQty = parseFloat(item.qty ?? "0");
    const deliveredQty = deliveredMap.get(item.id) ?? 0;
    const remainingQty = Math.max(0, originalQty - deliveredQty);
    return {
      soItemId: item.id,
      rowNo: item.rowNo,
      productId: item.productId,
      productCode: item.productCode,
      description: item.description,
      uom: item.uom,
      sourceCustomerPoId: item.sourceCustomerPoId,
      originalQty: originalQty.toFixed(item.qty?.includes(".") ? 2 : 0),
      deliveredQty: deliveredQty.toFixed(item.qty?.includes(".") ? 2 : 0),
      remainingQty: remainingQty.toFixed(item.qty?.includes(".") ? 2 : 0),
    };
  });
}

// Returns a map of soItemId → delivered qty, used in the SO detail page.
export async function getSoItemDeliveredQtys(soId: string): Promise<Record<string, number>> {
  const { orgId } = await requireAccess("delivery-order:read");

  const rows = await db
    .select({
      soItemId: deliveryOrderItem.soItemId,
      total: sql<string>`coalesce(sum(${deliveryOrderItem.qty}::numeric), 0)::text`,
    })
    .from(deliveryOrderItem)
    .innerJoin(deliveryOrder, eq(deliveryOrderItem.deliveryOrderId, deliveryOrder.id))
    .where(and(
      eq(deliveryOrder.salesOrderId, soId),
      eq(deliveryOrder.organizationId, orgId),
      ne(deliveryOrder.status, "cancelled"),
      isNotNull(deliveryOrderItem.soItemId),
    ))
    .groupBy(deliveryOrderItem.soItemId);

  return Object.fromEntries(rows.map((r) => [r.soItemId as string, parseFloat(r.total)]));
}

export interface DeliveryOrderItemInput {
  rowNo: number;
  soItemId?: string;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
}

export interface CreateDeliveryOrderInput {
  customerId?: string;
  customerOrgMemberId?: string;
  salesOrderId?: string;
  salesOrderNo?: string;
  customerPoId?: string;
  customerPoNo?: string;
  deliveredTo?: string;
  deliveryAddress?: string;
  deliveryDate?: Date;
  notes?: string;
  items: DeliveryOrderItemInput[];
}

export interface UpdateDeliveryOrderInput extends Omit<CreateDeliveryOrderInput, "items"> {
  id: string;
  status?: string;
  items: DeliveryOrderItemInput[];
}

export async function getDeliveryOrdersBySoId(
  soId: string,
): Promise<{ id: string; doNo: string; customerPoId: string | null; customerPoNo: string | null; status: string }[]> {
  const { orgId } = await requireAccess("delivery-order:read");
  return db
    .select({
      id: deliveryOrder.id,
      doNo: deliveryOrder.doNo,
      customerPoId: deliveryOrder.customerPoId,
      customerPoNo: deliveryOrder.customerPoNo,
      status: deliveryOrder.status,
    })
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.salesOrderId, soId), eq(deliveryOrder.organizationId, orgId)))
    .orderBy(asc(deliveryOrder.createdAt));
}

export const DO_PAGE_SIZE = 50;

export type DeliveryOrderListResult = {
  rows: DeliveryOrderListRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function getDeliveryOrders(opts: {
  page?: number;
  search?: string;
  status?: string;
} = {}): Promise<DeliveryOrderListResult> {
  const { orgId } = await requireAccess("delivery-order:read");
  const page     = Math.max(1, opts.page ?? 1);
  const pageSize = DO_PAGE_SIZE;
  const offset   = (page - 1) * pageSize;

  const conditions: any[] = [eq(deliveryOrder.organizationId, orgId)];
  if (opts.status) conditions.push(eq(deliveryOrder.status, opts.status));
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    conditions.push(or(
      sql`${deliveryOrder.doNo} ILIKE ${q}`,
      sql`${deliveryOrder.salesOrderNo} ILIKE ${q}`,
      sql`${deliveryOrder.customerPoNo} ILIKE ${q}`,
      sql`${deliveryOrder.deliveredTo} ILIKE ${q}`,
      sql`${deliveryOrder.status} ILIKE ${q}`,
      sql`(${deliveryOrder.customerSnapshot}->>'name') ILIKE ${q}`,
      sql`(${deliveryOrder.customerSnapshot}->>'organizationName') ILIKE ${q}`,
    ));
  }

  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(deliveryOrder).where(where)
      .orderBy(desc(deliveryOrder.doNo))
      .limit(pageSize).offset(offset),
    db.select({ total: count() }).from(deliveryOrder).where(where),
  ]);

  if (rows.length === 0) return { rows: [], total: Number(total), page, pageSize };

  const deliveredIds = rows.filter((r) => r.status === "delivered").map((r) => r.id);
  const [users, invoiceRows] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(rows.map((r) => r.createdBy))])),
    deliveredIds.length > 0
      ? db.select({ deliveryOrderId: invoice.deliveryOrderId, id: invoice.id, invoiceNo: invoice.invoiceNo })
          .from(invoice)
          .where(and(inArray(invoice.deliveryOrderId as any, deliveredIds), eq(invoice.organizationId, orgId)))
      : Promise.resolve([]),
  ]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;
  const invByDo = new Map(invoiceRows.map((i) => [i.deliveryOrderId, { id: i.id, no: i.invoiceNo }]));

  return {
    rows: rows.map((r) => ({
      ...r,
      createdByName: nameOf(r.createdBy),
      invoiceId: invByDo.get(r.id)?.id ?? null,
      invoiceNo: invByDo.get(r.id)?.no ?? null,
    })),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function getDeliveryOrderDetail(id: string): Promise<DeliveryOrderWithItems | null> {
  const { orgId } = await requireAccess("delivery-order:read");
  const [do_] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  if (!do_) return null;
  const [items, users, invoiceRows] = await Promise.all([
    db.select().from(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, id)).orderBy(asc(deliveryOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [do_.createdBy])),
    do_.status === "delivered"
      ? db.select({ id: invoice.id, invoiceNo: invoice.invoiceNo })
          .from(invoice)
          .where(and(eq(invoice.deliveryOrderId, id), eq(invoice.organizationId, orgId)))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;
  return {
    ...do_,
    items,
    createdByName: nameOf(do_.createdBy),
    invoiceId: invoiceRows[0]?.id ?? null,
    invoiceNo: invoiceRows[0]?.invoiceNo ?? null,
  };
}

export async function getDoForInvoice(id: string): Promise<DoForInvoice | null> {
  const { orgId } = await requireAccess("invoice:create");
  const [do_] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  if (!do_ || do_.status !== "delivered") return null;

  const items = await db
    .select()
    .from(deliveryOrderItem)
    .where(eq(deliveryOrderItem.deliveryOrderId, id))
    .orderBy(asc(deliveryOrderItem.rowNo));

  // Walk the chain: DO → SO → CPO → Quotation to inherit all document links
  let salesPersonId: string | null = null;
  let salesPersonName: string | null = null;
  let associateSalesPersons: { id: string; name: string }[] | null = null;
  let quotationId: string | null = null;
  let quotationNo: string | null = null;
  let paymentTerm: string | null = null;
  let paymentTermDays: number | null = null;
  let dueDate: Date | null = null;
  let supplierId: string | null = null;
  // Effective CPO: DO may not store it, fall back to SO's CPO
  let effectiveCpoId: string | null = do_.customerPoId ?? null;
  let effectiveCpoNo: string | null = do_.customerPoNo ?? null;
  const soItemPriceMap = new Map<string, { unitPrice: string; discountPct: string; lineType: string; rentalDuration: string | null; rentalUnit: string | null; setGroupId: string | null; setGroupLabel: string | null; setQty: string | null }>();
  const poItemCostMap = new Map<string, string>(); // productCode → costUnitPrice

  if (do_.salesOrderId) {
    const [so] = await db
      .select({
        salesPersonId: salesOrder.salesPersonId,
        salesPersonName: salesOrder.salesPersonName,
        associateSalesPersons: salesOrder.associateSalesPersons,
        quotationId: salesOrder.quotationId,
        quotationNo: salesOrder.quotationNo,
        customerPoId: salesOrder.customerPoId,
        customerPoNo: salesOrder.customerPoNo,
      })
      .from(salesOrder)
      .where(and(eq(salesOrder.id, do_.salesOrderId), eq(salesOrder.organizationId, orgId)));
    if (so) {
      salesPersonId = so.salesPersonId;
      salesPersonName = so.salesPersonName;
      associateSalesPersons = (so.associateSalesPersons as { id: string; name: string }[] | null) ?? null;
      quotationId = so.quotationId;
      quotationNo = so.quotationNo;
      // Fall back to SO's CPO if the DO didn't store it
      if (!effectiveCpoId && so.customerPoId) {
        effectiveCpoId = so.customerPoId;
        effectiveCpoNo = so.customerPoNo ?? null;
      }
    }

    // If SO has no direct quotation link, check via the effective CPO
    if (!quotationId && effectiveCpoId) {
      const [cpo] = await db
        .select({ quotationId: customerPurchaseOrder.quotationId, quotationNo: customerPurchaseOrder.quotationNo })
        .from(customerPurchaseOrder)
        .where(eq(customerPurchaseOrder.id, effectiveCpoId));
      if (cpo?.quotationId) {
        quotationId = cpo.quotationId;
        quotationNo = cpo.quotationNo ?? null;
      }
    }

    // Fetch quotation's paymentTerm; also use its salesperson if SO didn't set one
    if (quotationId) {
      const [q] = await db
        .select({
          paymentTerm: quotation.paymentTerm,
          qSalesPersonId: quotation.salesPersonId,
          qSalesPersonName: quotation.salesPersonName,
        })
        .from(quotation)
        .where(eq(quotation.id, quotationId));
      if (q) {
        paymentTerm = q.paymentTerm;
        if (!salesPersonId && q.qSalesPersonId) {
          salesPersonId = q.qSalesPersonId;
          salesPersonName = q.qSalesPersonName;
        }
        // Parse payment term days (e.g. "30 days", "Net 30", "30 DAYS")
        const match = q.paymentTerm?.match(/\b(\d+)\b/);
        if (match) {
          paymentTermDays = parseInt(match[1], 10);
          const d = new Date();
          d.setDate(d.getDate() + paymentTermDays);
          dueDate = d;
        }
      }
    }

    // Fetch first linked PO for supplierId + cost pricing per productCode
    const [po] = await db
      .select({ id: purchaseOrder.id, supplierId: purchaseOrder.supplierId })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.salesOrderId, do_.salesOrderId), eq(purchaseOrder.organizationId, orgId)))
      .limit(1);
    if (po) {
      supplierId = po.supplierId;
      // Fetch PO items to get cost unit prices keyed by productCode
      const poItems = await db
        .select({ productCode: purchaseOrderItem.productCode, unitPrice: purchaseOrderItem.unitPrice })
        .from(purchaseOrderItem)
        .where(eq(purchaseOrderItem.purchaseOrderId, po.id));
      for (const pi of poItems) {
        if (pi.productCode) poItemCostMap.set(pi.productCode, pi.unitPrice ?? "0");
      }
    }

    // Fetch SO items — pricing + tags; build multiple lookup maps for fallback matching
    const soItems = await db
      .select({
        id: salesOrderItem.id,
        rowNo: salesOrderItem.rowNo,
        productCode: salesOrderItem.productCode,
        unitPrice: salesOrderItem.unitPrice,
        discountPct: salesOrderItem.discountPct,
        lineType: salesOrderItem.lineType,
        rentalDuration: salesOrderItem.rentalDuration,
        rentalUnit: salesOrderItem.rentalUnit,
        setGroupId: salesOrderItem.setGroupId,
        setGroupLabel: salesOrderItem.setGroupLabel,
        setQty: salesOrderItem.setQty,
      })
      .from(salesOrderItem)
      .where(eq(salesOrderItem.salesOrderId, do_.salesOrderId))
      .orderBy(asc(salesOrderItem.rowNo));
    for (const si of soItems) {
      const data = {
        unitPrice: si.unitPrice ?? "0",
        discountPct: si.discountPct ?? "0",
        lineType: si.lineType ?? "sell",
        rentalDuration: si.rentalDuration ?? null,
        rentalUnit: si.rentalUnit ?? null,
        setGroupId: si.setGroupId ?? null,
        setGroupLabel: si.setGroupLabel ?? null,
        setQty: si.setQty ?? null,
      };
      soItemPriceMap.set(si.id, data);
      if (si.productCode) soItemPriceMap.set(`pc:${si.productCode}`, data);
      soItemPriceMap.set(`row:${si.rowNo}`, data);
    }
  }

  return {
    id: do_.id,
    doNo: do_.doNo,
    salesOrderId: do_.salesOrderId,
    salesOrderNo: do_.salesOrderNo,
    customerPoId: effectiveCpoId,
    customerPoNo: effectiveCpoNo,
    customerId: do_.customerId,
    customerSnapshot: do_.customerSnapshot as DoForInvoice["customerSnapshot"],
    salesPersonId,
    salesPersonName,
    associateSalesPersons,
    quotationId,
    quotationNo,
    paymentTerm,
    paymentTermDays,
    dueDate,
    supplierId,
    deliveryDate: do_.deliveryDate,
    deliveryAddress: do_.deliveryAddress,
    items: items.map((i) => {
      // Look up SO item data: by soItemId first, then productCode, then rowNo
      const soData =
        (i.soItemId ? soItemPriceMap.get(i.soItemId) : undefined) ??
        (i.productCode ? soItemPriceMap.get(`pc:${i.productCode}`) : undefined) ??
        soItemPriceMap.get(`row:${i.rowNo}`);
      return {
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? null,
        uom: i.uom ?? null,
        unitPrice: soData?.unitPrice ?? null,
        discountPct: soData?.discountPct ?? null,
        costUnitPrice: i.productCode ? (poItemCostMap.get(i.productCode) ?? null) : null,
        lineType: soData?.lineType ?? null,
        rentalDuration: soData?.rentalDuration ?? null,
        rentalUnit: soData?.rentalUnit ?? null,
        setGroupId: soData?.setGroupId ?? null,
        setGroupLabel: soData?.setGroupLabel ?? null,
        setQty: soData?.setQty ?? null,
      };
    }),
  };
}

export async function createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<DeliveryOrderRow> {
  const { orgId, userId } = await requireAccess("delivery-order:create");

  const customerSnapshot: DeliveryOrderRow["customerSnapshot"] = input.customerId
    ? await buildCustomerSnapshot(input.customerId, input.customerOrgMemberId)
    : null;

  const doNo = await generateDoNo(orgId);
  const [row] = await db
    .insert(deliveryOrder)
    .values({
      id: nanoid(),
      organizationId: orgId,
      doNo,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      customerPoId: input.customerPoId ?? null,
      customerPoNo: input.customerPoNo ?? null,
      customerId: input.customerId ?? null,
      customerSnapshot,
      deliveredTo: input.deliveredTo ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      deliveryDate: input.deliveryDate ?? null,
      notes: input.notes ?? null,
      status: "draft",
      createdBy: userId,
    })
    .returning();

  if (input.items.length > 0) {
    await db.insert(deliveryOrderItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        deliveryOrderId: row.id,
        soItemId: i.soItemId ?? null,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
      })),
    );
  }
  if (input.salesOrderId) {
    await checkAndFulfillSo(input.salesOrderId, orgId);
  }
  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath("/dashboard");
  if (input.salesOrderId) {
    revalidatePath(`/dashboard/sales/order/${input.salesOrderId}`);
    revalidatePath("/dashboard/sales/order");
  }
  return row;
}

export async function updateDeliveryOrder(input: UpdateDeliveryOrderInput): Promise<DeliveryOrderRow> {
  const { orgId } = await requireAccess("delivery-order:update");
  const [existing] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, input.id), eq(deliveryOrder.organizationId, orgId)));
  if (!existing) throw new Error("Delivery order not found");
  if (!EDITABLE_STATUSES.has(existing.status)) throw new Error("Only draft delivery orders can be edited");

  const [row] = await db
    .update(deliveryOrder)
    .set({
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      customerId: input.customerId ?? null,
      deliveredTo: input.deliveredTo ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      deliveryDate: input.deliveryDate ?? null,
      notes: input.notes ?? null,
      status: input.status ?? existing.status,
    })
    .where(eq(deliveryOrder.id, input.id))
    .returning();

  await db.delete(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, input.id));
  if (input.items.length > 0) {
    await db.insert(deliveryOrderItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        deliveryOrderId: input.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
      })),
    );
  }
  return row;
}

export async function deleteDeliveryOrder(id: string): Promise<void> {
  const { orgId } = await requireAccess("delivery-order:delete");
  const [existing] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  if (!existing) throw new Error("Delivery order not found");
  if (!DELETABLE_STATUSES.has(existing.status)) throw new Error("Only draft delivery orders can be deleted");
  await db.delete(deliveryOrder).where(eq(deliveryOrder.id, id));
  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath("/dashboard");
}

export async function updateDeliveryOrderStatus(id: string, status: string): Promise<void> {
  const { orgId } = await requireAccess("delivery-order:update");
  await db
    .update(deliveryOrder)
    .set({ status })
    .where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
}

export async function deliverDeliveryOrder(id: string, warehouseLabel = "Default"): Promise<void> {
  const { orgId, userId } = await requireAccess("delivery-order:update");
  const [existing] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  if (!existing) throw new Error("Delivery order not found");
  if (existing.status !== "draft") throw new Error("Only draft delivery orders can be marked as delivered");

  await db.update(deliveryOrder).set({ status: "delivered" }).where(eq(deliveryOrder.id, id));

  const items = await db
    .select()
    .from(deliveryOrderItem)
    .where(eq(deliveryOrderItem.deliveryOrderId, id));

  const itemsWithProduct = items.filter((i) => i.productId);

  // STOCK_OUT for each item that has a productId
  await Promise.all(
    itemsWithProduct.map((i) =>
      createApprovedMovement({
        orgId,
        userId,
        productId: i.productId!,
        warehouseLabel,
        movementType: MOVEMENT_TYPE.STOCK_OUT,
        quantity: parseFloat(i.qty ?? "1"),
        referenceType: REF_TYPE.DELIVERY_ORDER,
        referenceId: id,
        referenceNo: existing.doNo,
        notes: `DO delivery: ${i.productCode ?? ""}`.trim(),
      }),
    ),
  );

  // Release SO reservation and close the SO
  if (existing.salesOrderId) {
    await Promise.all([
      ...itemsWithProduct.map((i) =>
        adjustReservation({
          orgId,
          productId: i.productId!,
          warehouseLabel,
          delta: -parseFloat(i.qty ?? "1"),
        }),
      ),
      db
        .update(salesOrder)
        .set({ status: "fulfilled" })
        .where(and(eq(salesOrder.id, existing.salesOrderId), eq(salesOrder.organizationId, orgId))),
    ]);
    revalidatePath(`/dashboard/sales/order/${existing.salesOrderId}`);
    revalidatePath("/dashboard/sales/order");
  }
  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath("/dashboard/fulfillment/invoice");
  revalidatePath("/dashboard");
}

export async function returnDeliveryOrder(id: string, warehouseLabel = "Default"): Promise<void> {
  const { orgId, userId } = await requireAccess("delivery-order:update");
  const [existing] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, orgId)));
  if (!existing) throw new Error("Delivery order not found");
  if (existing.status !== "delivered") throw new Error("Only delivered orders can be marked as returned");

  await db.update(deliveryOrder).set({ status: "returned" }).where(eq(deliveryOrder.id, id));

  // RETURN movement — stock comes back in
  const items = await db
    .select()
    .from(deliveryOrderItem)
    .where(eq(deliveryOrderItem.deliveryOrderId, id));

  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath("/dashboard");

  await Promise.all(
    items
      .filter((i) => i.productId)
      .map((i) =>
        createApprovedMovement({
          orgId,
          userId,
          productId: i.productId!,
          warehouseLabel,
          movementType: MOVEMENT_TYPE.RETURN,
          quantity: parseFloat(i.qty ?? "1"),
          referenceType: REF_TYPE.DELIVERY_ORDER,
          referenceId: id,
          referenceNo: existing.doNo,
          notes: `DO return: ${i.productCode ?? ""}`.trim(),
        }),
      ),
  );
}

export type PendingSoForDoRow = {
  id: string;
  soNo: string;
  customers: { name: string; organizationName: string | null }[];
  customerPoNos: string[];
  grandTotal: string;
  createdAt: Date;
};

export async function getPendingSosForDo(): Promise<PendingSoForDoRow[]> {
  const { orgId } = await requireAccess("delivery-order:read");

  // Confirmed+reserved SOs that are not yet fulfilled.
  // 'fulfilled' status is set automatically when all item quantities are delivered.
  // Partially-delivered SOs remain 'confirmed' and continue to show here.
  const rows = await db
    .select({
      id: salesOrder.id,
      soNo: salesOrder.soNo,
      customerPoId: salesOrder.customerPoId,
      customerPoNo: salesOrder.customerPoNo,
      customerPoLinks: salesOrder.customerPoLinks,
      grandTotal: salesOrder.grandTotal,
      createdAt: salesOrder.createdAt,
    })
    .from(salesOrder)
    .where(and(
      eq(salesOrder.organizationId, orgId),
      eq(salesOrder.status, "confirmed"),
      eq(salesOrder.stockReservationStatus, "reserved"),
    ))
    .orderBy(desc(salesOrder.createdAt));

  const pendingRows = rows;
  if (pendingRows.length === 0) return [];

  // Fetch CPO customer snapshots for display
  type CpoLink = { customerPoId: string; customerPoNo: string };
  const allCpoIds = [
    ...new Set(
      pendingRows.flatMap((r) => {
        const links = (r.customerPoLinks as CpoLink[] | null) ?? [];
        return links.length > 0
          ? links.map((l) => l.customerPoId)
          : r.customerPoId ? [r.customerPoId] : [];
      }),
    ),
  ];

  const cpoSnapshotMap = new Map<string, { name?: string; organizationName?: string }>();
  if (allCpoIds.length > 0) {
    const cpos = await db
      .select({ id: customerPurchaseOrder.id, customerSnapshot: customerPurchaseOrder.customerSnapshot })
      .from(customerPurchaseOrder)
      .where(inArray(customerPurchaseOrder.id, allCpoIds));
    for (const cpo of cpos) {
      if (cpo.customerSnapshot) cpoSnapshotMap.set(cpo.id, cpo.customerSnapshot as { name?: string; organizationName?: string });
    }
  }

  return pendingRows.map((r) => {
    const links = (r.customerPoLinks as CpoLink[] | null) ?? [];
    const cpoIds = links.length > 0
      ? links.map((l) => l.customerPoId)
      : r.customerPoId ? [r.customerPoId] : [];

    const customerPoNos = links.length > 0
      ? [...new Set(links.map((l) => l.customerPoNo).filter(Boolean))]
      : r.customerPoNo ? [r.customerPoNo] : [];

    const seen = new Set<string>();
    const customers: { name: string; organizationName: string | null }[] = [];
    for (const cpoId of cpoIds) {
      const s = cpoSnapshotMap.get(cpoId);
      const name = s?.name?.trim();
      if (!name) continue;
      const orgName = s?.organizationName?.trim() || null;
      const key = `${name}||${orgName ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      customers.push({ name, organizationName: orgName });
    }

    return { id: r.id, soNo: r.soNo, customers, customerPoNos, grandTotal: r.grandTotal, createdAt: r.createdAt };
  });
}

export type PendingDoForInvoiceRow = {
  id: string;
  doNo: string;
  salesOrderNo: string | null;
  customerPoNo: string | null;
  customerName: string | null;
  customerOrg: string | null;
  createdAt: Date;
};

export async function getPendingDosForInvoice(): Promise<PendingDoForInvoiceRow[]> {
  const { orgId } = await requireAccess("invoice:read");

  // Delivered DOs with no invoice linked (NOT EXISTS avoids nullable-column issues).
  const rows = await db
    .select({
      id: deliveryOrder.id,
      doNo: deliveryOrder.doNo,
      salesOrderNo: deliveryOrder.salesOrderNo,
      customerPoNo: deliveryOrder.customerPoNo,
      customerSnapshot: deliveryOrder.customerSnapshot,
      createdAt: deliveryOrder.createdAt,
    })
    .from(deliveryOrder)
    .where(and(
      eq(deliveryOrder.organizationId, orgId),
      eq(deliveryOrder.status, "delivered"),
      notExists(
        db.select({ _: invoice.id }).from(invoice)
          .where(and(
            eq(invoice.organizationId, orgId),
            eq(invoice.deliveryOrderId, deliveryOrder.id),
          )),
      ),
    ))
    .orderBy(desc(deliveryOrder.doNo));

  return rows.map((r) => {
    const snap = r.customerSnapshot as any;
    const name = snap ? [snap.title, snap.name].filter(Boolean).join(" ") || null : null;
    const org = snap?.organizationName ?? null;
    return {
      id: r.id,
      doNo: r.doNo,
      salesOrderNo: r.salesOrderNo,
      customerPoNo: r.customerPoNo,
      customerName: name,
      customerOrg: org,
      createdAt: r.createdAt,
    };
  });
}
