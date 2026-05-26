"use server";

import { db } from "@/db";
import {
  deliveryOrder,
  deliveryOrderItem,
  deliveryOrderCounter,
  customer,
  customerCompany,
  member,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, isNull, } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";

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

async function getOwnerOrgId(userId: string, currentOrgId: string): Promise<string> {
  const [primary] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .orderBy(asc(member.createdAt))
    .limit(1);
  return primary?.organizationId ?? currentOrgId;
}

async function getOwnerOrgIds(userId: string, currentOrgId: string): Promise<string[]> {
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "owner"), isNull(member.deletedAt)));
  const ids = owned.map((m) => m.organizationId);
  return ids.length > 0 ? ids : [currentOrgId];
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
export type DeliveryOrderWithItems = DeliveryOrderRow & { items: DeliveryOrderItem[]; createdByName: string | null };
export type DeliveryOrderListRow = DeliveryOrderRow & { createdByName: string | null };

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft"]);

export interface DeliveryOrderItemInput {
  rowNo: number;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
}

export interface CreateDeliveryOrderInput {
  customerId?: string;
  customerCompanyId?: string;
  salesOrderId?: string;
  salesOrderNo?: string;
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

export async function getDeliveryOrders(): Promise<DeliveryOrderListRow[]> {
  const { orgId, userId } = await requireAccess("delivery-order:read");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  const rows = await db
    .select()
    .from(deliveryOrder)
    .where(inArray(deliveryOrder.organizationId, ownerOrgIds))
    .orderBy(desc(deliveryOrder.createdAt));

  if (rows.length === 0) return [];

  const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, creatorIds));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  return rows.map((r) => ({ ...r, createdByName: nameOf(r.createdBy) }));
}

export async function getDeliveryOrderDetail(id: string): Promise<DeliveryOrderWithItems | null> {
  const { orgId, userId } = await requireAccess("delivery-order:read");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  const [do_] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, id), inArray(deliveryOrder.organizationId, ownerOrgIds)));
  if (!do_) return null;
  const [items, users] = await Promise.all([
    db.select().from(deliveryOrderItem).where(eq(deliveryOrderItem.deliveryOrderId, id)).orderBy(asc(deliveryOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [do_.createdBy])),
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;
  return { ...do_, items, createdByName: nameOf(do_.createdBy) };
}

export async function createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<DeliveryOrderRow> {
  const { orgId, userId } = await requireAccess("delivery-order:create");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);

  let customerSnapshot: DeliveryOrderRow["customerSnapshot"] = null;
  if (input.customerId) {
    const [cust] = await db.select().from(customer).where(eq(customer.id, input.customerId));
    if (cust) {
      let company: typeof customerCompany.$inferSelect | undefined;
      if (input.customerCompanyId) {
        const [c] = await db.select().from(customerCompany).where(eq(customerCompany.id, input.customerCompanyId));
        company = c;
      }
      if (!company) {
        const companies = await db
          .select()
          .from(customerCompany)
          .where(eq(customerCompany.customerId, cust.id))
          .orderBy(desc(customerCompany.isPrimary), asc(customerCompany.createdAt))
          .limit(1);
        company = companies[0];
      }
      customerSnapshot = {
        title: cust.title ?? undefined,
        name: cust.name,
        email: cust.email ?? undefined,
        contactNo: cust.contactNo ?? undefined,
        organizationName: company?.organizationName ?? undefined,
        organizationAddress: company?.organizationAddress ?? undefined,
      };
    }
  }

  const doNo = await generateDoNo(ownerOrgIds[0]);
  const [row] = await db
    .insert(deliveryOrder)
    .values({
      id: nanoid(),
      organizationId: ownerOrgIds[0],
      doNo,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
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
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
      })),
    );
  }
  return row;
}

export async function updateDeliveryOrder(input: UpdateDeliveryOrderInput): Promise<DeliveryOrderRow> {
  const { orgId, userId } = await requireAccess("delivery-order:update");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  const [existing] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, input.id), inArray(deliveryOrder.organizationId, ownerOrgIds)));
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
  const { orgId, userId } = await requireAccess("delivery-order:delete");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  const [existing] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, id), inArray(deliveryOrder.organizationId, ownerOrgIds)));
  if (!existing) throw new Error("Delivery order not found");
  if (!DELETABLE_STATUSES.has(existing.status)) throw new Error("Only draft delivery orders can be deleted");
  await db.delete(deliveryOrder).where(and(eq(deliveryOrder.id, id), inArray(deliveryOrder.organizationId, ownerOrgIds)));
}

export async function updateDeliveryOrderStatus(id: string, status: string): Promise<void> {
  const { orgId, userId } = await requireAccess("delivery-order:update");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  await db
    .update(deliveryOrder)
    .set({ status })
    .where(and(eq(deliveryOrder.id, id), inArray(deliveryOrder.organizationId, ownerOrgIds)));
}

export async function deliverDeliveryOrder(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("delivery-order:update");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  const [existing] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, id), inArray(deliveryOrder.organizationId, ownerOrgIds)));
  if (!existing) throw new Error("Delivery order not found");
  if (existing.status !== "draft") throw new Error("Only draft delivery orders can be marked as delivered");
  await db.update(deliveryOrder).set({ status: "delivered" }).where(eq(deliveryOrder.id, id));
}

export async function returnDeliveryOrder(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("delivery-order:update");
  const ownerOrgIds = await getOwnerOrgIds(userId, orgId);
  const [existing] = await db.select().from(deliveryOrder).where(and(eq(deliveryOrder.id, id), inArray(deliveryOrder.organizationId, ownerOrgIds)));
  if (!existing) throw new Error("Delivery order not found");
  if (existing.status !== "delivered") throw new Error("Only delivered orders can be marked as returned");
  await db.update(deliveryOrder).set({ status: "returned" }).where(eq(deliveryOrder.id, id));
}
