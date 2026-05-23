"use server";

import { db } from "@/db";
import {
  customerPurchaseOrder,
  customer,
  customerCompany,
  salesOrder,
  member,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, ilike, inArray } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
const BUCKET = process.env.R2_CUSTOMER_PURCHASE_ORDER_BUCKET!;

export async function getCustomerPoDocumentUploadUrl(
  filename: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("customer-po:create");
  const key = `customer-pos/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: "application/pdf" });
  return { key, uploadUrl: await getSignedUrl(s3, cmd, { expiresIn: 3600 }) };
}

export async function getCustomerPoDocumentDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

async function deleteDocument(key: string | null | undefined) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

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

export type CustomerPo = typeof customerPurchaseOrder.$inferSelect;

export interface CreateCustomerPoInput {
  customerPoNo: string;
  customerId?: string;
  customerCompanyId?: string;
  quotationId?: string;
  quotationNo?: string;
  salesOrderId?: string;
  salesOrderNo?: string;
  amount?: string;
  currency?: string;
  documentKey?: string;
  notes?: string;
  receivedDate?: Date;
  status?: string;
}

export interface UpdateCustomerPoInput extends CreateCustomerPoInput {
  id: string;
}

export async function getCustomerPos(): Promise<CustomerPo[]> {
  const { orgId, userId } = await requireAccess("customer-po:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  return db
    .select()
    .from(customerPurchaseOrder)
    .where(eq(customerPurchaseOrder.organizationId, ownerOrgId))
    .orderBy(desc(customerPurchaseOrder.createdAt));
}

export async function getCustomerPoDetail(id: string): Promise<CustomerPo | null> {
  const { orgId, userId } = await requireAccess("customer-po:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [row] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), eq(customerPurchaseOrder.organizationId, ownerOrgId)));
  return row ?? null;
}

export async function getCustomerPosByCustomer(customerId: string): Promise<CustomerPo[]> {
  const { orgId, userId } = await requireAccess("customer-po:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  return db
    .select()
    .from(customerPurchaseOrder)
    .where(
      and(
        eq(customerPurchaseOrder.organizationId, ownerOrgId),
        eq(customerPurchaseOrder.customerId, customerId),
      ),
    )
    .orderBy(desc(customerPurchaseOrder.createdAt));
}

export async function createCustomerPo(input: CreateCustomerPoInput): Promise<CustomerPo> {
  const { orgId, userId } = await requireAccess("customer-po:create");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  let customerSnapshot: CustomerPo["customerSnapshot"] = null;
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

  const [row] = await db
    .insert(customerPurchaseOrder)
    .values({
      id: nanoid(),
      organizationId: ownerOrgId,
      customerPoNo: input.customerPoNo,
      customerId: input.customerId ?? null,
      customerSnapshot,
      quotationId: input.quotationId ?? null,
      quotationNo: input.quotationNo ?? null,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      amount: input.amount ?? "0",
      currency: input.currency ?? "MYR",
      documentKey: input.documentKey ?? null,
      notes: input.notes ?? null,
      receivedDate: input.receivedDate ?? null,
      status: input.status ?? "received",
      createdBy: userId,
    })
    .returning();
  return row;
}

export async function updateCustomerPo(input: UpdateCustomerPoInput): Promise<CustomerPo> {
  const { orgId, userId } = await requireAccess("customer-po:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [existing] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, input.id), eq(customerPurchaseOrder.organizationId, ownerOrgId)));
  if (!existing) throw new Error("Customer PO not found");

  if (input.documentKey !== undefined && existing.documentKey && existing.documentKey !== input.documentKey) {
    await deleteDocument(existing.documentKey);
  }

  const [row] = await db
    .update(customerPurchaseOrder)
    .set({
      customerPoNo: input.customerPoNo,
      quotationId: input.quotationId ?? null,
      quotationNo: input.quotationNo ?? null,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      amount: input.amount ?? existing.amount,
      currency: input.currency ?? existing.currency,
      documentKey: input.documentKey !== undefined ? input.documentKey : existing.documentKey,
      notes: input.notes ?? null,
      receivedDate: input.receivedDate ?? null,
      status: input.status ?? existing.status,
    })
    .where(eq(customerPurchaseOrder.id, input.id))
    .returning();
  return row;
}

export async function deleteCustomerPo(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("customer-po:delete");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [existing] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), eq(customerPurchaseOrder.organizationId, ownerOrgId)));
  if (existing?.documentKey) await deleteDocument(existing.documentKey);
  await db.delete(customerPurchaseOrder).where(eq(customerPurchaseOrder.id, id));
}
