"use server";

import { db } from "@/db";
import {
  deliveryOrder,
  deliveryOrderItem,
  deliveryOrderCounter,
  customer,
  customerCompany,
  member,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc } from "drizzle-orm";
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
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerMember) return currentOrgId;
  const [primaryOrg] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);
  return primaryOrg?.organizationId ?? currentOrgId;
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
export type DeliveryOrderWithItems = DeliveryOrderRow & { items: DeliveryOrderItem[] };

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

export async function getDeliveryOrders(): Promise<DeliveryOrderRow[]> {
  const { orgId, userId } = await requireAccess("delivery-order:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  return db
    .select()
    .from(deliveryOrder)
    .where(eq(deliveryOrder.organizationId, ownerOrgId))
    .orderBy(desc(deliveryOrder.createdAt));
}

export async function getDeliveryOrderDetail(id: string): Promise<DeliveryOrderWithItems | null> {
  const { orgId, userId } = await requireAccess("delivery-order:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [do_] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, ownerOrgId)));
  if (!do_) return null;
  const items = await db
    .select()
    .from(deliveryOrderItem)
    .where(eq(deliveryOrderItem.deliveryOrderId, id))
    .orderBy(asc(deliveryOrderItem.rowNo));
  return { ...do_, items };
}

export async function createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<DeliveryOrderRow> {
  const { orgId, userId } = await requireAccess("delivery-order:create");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

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

  const doNo = await generateDoNo(ownerOrgId);
  const [row] = await db
    .insert(deliveryOrder)
    .values({
      id: nanoid(),
      organizationId: ownerOrgId,
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
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [existing] = await db
    .select()
    .from(deliveryOrder)
    .where(and(eq(deliveryOrder.id, input.id), eq(deliveryOrder.organizationId, ownerOrgId)));
  if (!existing) throw new Error("Delivery order not found");

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
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  await db.delete(deliveryOrder).where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, ownerOrgId)));
}

export async function updateDeliveryOrderStatus(id: string, status: string): Promise<void> {
  const { orgId, userId } = await requireAccess("delivery-order:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  await db
    .update(deliveryOrder)
    .set({ status })
    .where(and(eq(deliveryOrder.id, id), eq(deliveryOrder.organizationId, ownerOrgId)));
}
