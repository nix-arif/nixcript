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
} from "@/db/schema";
import { buildCustomerSnapshot } from "@/server/customer";
import { getCachedSession } from "@/lib/auth/cached-session";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, isNotNull, isNull, notExists } from "drizzle-orm";
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
  deliveryDate: Date | null;
  deliveryAddress: string | null;
  items: Array<{ rowNo: number; productId: string | null; productCode: string | null; description: string | null; qty: string | null; uom: string | null }>;
};

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft"]);

export interface DeliveryOrderItemInput {
  rowNo: number;
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

export async function getDeliveryOrders(): Promise<DeliveryOrderListRow[]> {
  const { orgId } = await requireAccess("delivery-order:read");
  const rows = await db
    .select()
    .from(deliveryOrder)
    .where(eq(deliveryOrder.organizationId, orgId))
    .orderBy(desc(deliveryOrder.createdAt));

  if (rows.length === 0) return [];

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

  return rows.map((r) => ({
    ...r,
    createdByName: nameOf(r.createdBy),
    invoiceId: invByDo.get(r.id)?.id ?? null,
    invoiceNo: invByDo.get(r.id)?.no ?? null,
  }));
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
  return {
    id: do_.id,
    doNo: do_.doNo,
    salesOrderId: do_.salesOrderId,
    salesOrderNo: do_.salesOrderNo,
    customerPoId: do_.customerPoId,
    customerPoNo: do_.customerPoNo,
    customerId: do_.customerId,
    customerSnapshot: do_.customerSnapshot as DoForInvoice["customerSnapshot"],
    deliveryDate: do_.deliveryDate,
    deliveryAddress: do_.deliveryAddress,
    items: items.map((i) => ({
      rowNo: i.rowNo,
      productId: i.productId ?? null,
      productCode: i.productCode ?? null,
      description: i.description ?? null,
      qty: i.qty ?? null,
      uom: i.uom ?? null,
    })),
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
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
      })),
    );
  }
  revalidatePath("/dashboard/fulfillment/delivery");
  revalidatePath("/dashboard");
  if (input.salesOrderId) {
    revalidatePath(`/dashboard/sales/order/${input.salesOrderId}`);
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

  // Confirmed+reserved SOs that have no DO linked yet.
  // Uses NOT EXISTS to avoid nullable-column LEFT JOIN issues in Drizzle ORM.
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
      notExists(
        db.select({ _: deliveryOrder.id }).from(deliveryOrder)
          .where(and(
            eq(deliveryOrder.salesOrderId, salesOrder.id),
            eq(deliveryOrder.organizationId, orgId),
          )),
      ),
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
    .orderBy(desc(deliveryOrder.createdAt));

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
