"use server";

import { db } from "@/db";
import {
  salesOrder,
  salesOrderItem,
  salesOrderCounter,
  purchaseOrder,
  deliveryOrder,
  customer,
  customerCompany,
  quotation,
  organization,
  organizationProfile,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { revalidatePath } from "next/cache";
import { adjustReservation } from "@/lib/inventory/create-movement";
import { Resend } from "resend";
import { createNotification, getSoApprovers } from "@/server/notifications";
import SoNotificationEmail from "@/components/emails/so-notification";

const resend = new Resend(process.env.RESEND_API_KEY as string);
const baseUrl = process.env.NODE_ENV === "production"
  ? process.env.APP_DOMAIN!
  : (process.env.BETTER_AUTH_URL ?? "http://localhost:3000");

// ── R2 supplier-quotation bucket ───────────────────────────────────────────
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const SUPPLIER_QUOTATION_BUCKET = process.env.R2_SUPPLIER_QUOTATION_BUCKET!;

export async function getSupplierQuotationUploadUrl(
  filename: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("sales-order:create");
  const key = `supplier-quotations/so/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({
    Bucket: SUPPLIER_QUOTATION_BUCKET,
    Key: key,
    ContentType: "application/pdf",
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

export async function getSupplierQuotationDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: SUPPLIER_QUOTATION_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

async function deleteSupplierQuotationFile(key: string | null | undefined) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: SUPPLIER_QUOTATION_BUCKET, Key: key }));
}

// ── Auth helpers ───────────────────────────────────────────────────────────

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

// ── Running number ─────────────────────────────────────────────────────────

async function generateSoNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "so");
  const year = new Date().getFullYear();

  const existing = await db
    .select()
    .from(salesOrderCounter)
    .where(eq(salesOrderCounter.organizationId, orgId))
    .limit(1);

  let nextNo: number;

  if (existing.length === 0) {
    await db.insert(salesOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db
      .update(salesOrderCounter)
      .set({ year, lastNumber: nextNo })
      .where(eq(salesOrderCounter.organizationId, orgId));
  }

  return buildDocumentNo(cfg, year, nextNo);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type SalesOrderRow = typeof salesOrder.$inferSelect;
export type SalesOrderItem = typeof salesOrderItem.$inferSelect;

export type SalesOrderMeta = {
  createdByName: string | null;
  submittedByName: string | null;
  approvedByName: string | null;
};

export type SalesOrderListRow = SalesOrderRow & { createdByName: string | null };

export interface SalesOrderItemInput {
  rowNo: number;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  unitPrice?: string;
  discountPct?: string;
  discountAmt?: string;
  totalPrice?: string;
}

export interface CreateSalesOrderInput {
  customerId?: string;
  customerCompanyId?: string;
  quotationId?: string;
  quotationNo?: string;
  linkedQuotations?: { id: string; quotationNo: string }[];
  salesPersonId?: string;
  salesPersonName?: string;
  associateSalesPersons?: { id: string; name: string }[];
  subtotal?: string;
  overallDiscountPct?: string;
  overallDiscountAmt?: string;
  sst?: string;
  sstPct?: string;
  grandTotal?: string;
  notes?: string;
  deliveryDate?: Date;
  deliveryAddress?: string;
  supplierQuotationKey?: string;
  items: SalesOrderItemInput[];
}

export interface UpdateSalesOrderInput extends Omit<CreateSalesOrderInput, "items"> {
  id: string;
  status?: string;
  items: SalesOrderItemInput[];
}

export type SalesOrderWithItems = SalesOrderRow & SalesOrderMeta & { items: SalesOrderItem[] };

// ── Queries ────────────────────────────────────────────────────────────────

export async function getExistingDraftSo(): Promise<{ id: string; soNo: string } | null> {
  const { orgId } = await requireAccess("sales-order:read");
  const [row] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo })
    .from(salesOrder)
    .where(and(eq(salesOrder.organizationId, orgId), eq(salesOrder.status, "draft")))
    .limit(1);
  return row ?? null;
}

export async function getSalesOrders(): Promise<SalesOrderListRow[]> {
  const { orgId } = await requireAccess("sales-order:read");

  const rows = await db
    .select()
    .from(salesOrder)
    .where(eq(salesOrder.organizationId, orgId))
    .orderBy(desc(salesOrder.createdAt));

  if (rows.length === 0) return [];

  const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
  const users = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, creatorIds));

  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  return rows.map((r) => ({ ...r, createdByName: nameOf(r.createdBy) }));
}

export async function getSalesOrderDetail(id: string): Promise<SalesOrderWithItems | null> {
  const { orgId } = await requireAccess("sales-order:read");

  const [so] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) return null;

  const [items, users] = await Promise.all([
    db
      .select()
      .from(salesOrderItem)
      .where(eq(salesOrderItem.salesOrderId, id))
      .orderBy(asc(salesOrderItem.rowNo)),
    db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(
        inArray(
          user.id,
          [so.createdBy, so.submittedBy, so.approvedBy].filter((x): x is string => !!x),
        ),
      ),
  ]);

  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;

  return {
    ...so,
    createdByName: nameOf(so.createdBy),
    submittedByName: nameOf(so.submittedBy ?? null),
    approvedByName: nameOf(so.approvedBy ?? null),
    items,
  };
}

export async function getSalesOrderForPrint(id: string) {
  const { orgId } = await requireAccess("sales-order:read");

  const [so] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) return null;

  const [items, userRows, orgRows] = await Promise.all([
    db.select().from(salesOrderItem).where(eq(salesOrderItem.salesOrderId, id)).orderBy(asc(salesOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(
      inArray(user.id, [so.createdBy, so.submittedBy, so.approvedBy].filter((x): x is string => !!x)),
    ),
    db.select({
      name: organization.name,
      logo: organization.logo,
      logoKey: organizationProfile.logoKey,
      brandColor: organizationProfile.brandColor,
      companyName: organizationProfile.companyName,
      companyAddress: organizationProfile.companyAddress,
      taxNo: organizationProfile.taxNo,
      phone: organizationProfile.phone,
      email: organizationProfile.email,
      website: organizationProfile.website,
      oldSsmNo: organizationProfile.oldSsmNo,
      newSsmNo: organizationProfile.newSsmNo,
      mdaEstablishmentNo: organizationProfile.mdaEstablishmentNo,
      bankingInfo: organizationProfile.bankingInfo,
    })
    .from(organization)
    .leftJoin(organizationProfile, eq(organizationProfile.organizationId, organization.id))
    .where(eq(organization.id, orgId))
    .limit(1),
  ]);

  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const org = orgRows[0];
  const orgLogoUrl = org?.logoKey ? `${r2Public}/${org.logoKey}` : (org?.logo ?? null);
  const nameOf = (uid: string | null) => userRows.find((u) => u.id === uid)?.name ?? null;

  return {
    order: so,
    items,
    createdByName: nameOf(so.createdBy),
    submittedByName: nameOf(so.submittedBy ?? null),
    approvedByName: nameOf(so.approvedBy ?? null),
    orgName: org?.name ?? "",
    orgLogoUrl,
    orgBrandColor: org?.brandColor ?? null,
    orgCompanyName: org?.companyName ?? null,
    orgCompanyAddress: org?.companyAddress ?? null,
    orgTaxNo: org?.taxNo ?? null,
    orgPhone: org?.phone ?? null,
    orgEmail: org?.email ?? null,
    orgWebsite: org?.website ?? null,
    orgOldSsmNo: org?.oldSsmNo ?? null,
    orgNewSsmNo: org?.newSsmNo ?? null,
    orgMdaEstablishmentNo: org?.mdaEstablishmentNo ?? null,
    orgBankingInfo: (org?.bankingInfo ?? []) as any[],
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function createSalesOrder(input: CreateSalesOrderInput): Promise<SalesOrderRow> {
  const { orgId, userId, session } = await requireAccess("sales-order:create");

  // Build customer snapshot
  let customerSnapshot: SalesOrderRow["customerSnapshot"] = null;
  if (input.customerId) {
    const [cust] = await db
      .select()
      .from(customer)
      .where(eq(customer.id, input.customerId));

    if (cust) {
      let company: typeof customerCompany.$inferSelect | undefined;

      if (input.customerCompanyId) {
        const [c] = await db
          .select()
          .from(customerCompany)
          .where(eq(customerCompany.id, input.customerCompanyId));
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
        position: company?.position ?? undefined,
        department: company?.department ?? undefined,
      };
    }
  }

  const soNo = await generateSoNo(orgId);

  const [row] = await db
    .insert(salesOrder)
    .values({
      id: nanoid(),
      organizationId: orgId,
      soNo,
      quotationId: input.linkedQuotations?.[0]?.id ?? input.quotationId ?? null,
      quotationNo: input.linkedQuotations?.[0]?.quotationNo ?? input.quotationNo ?? null,
      linkedQuotations: input.linkedQuotations ?? null,
      customerId: input.customerId ?? null,
      customerSnapshot: customerSnapshot ?? null,
      supplierQuotationKey: input.supplierQuotationKey ?? null,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      associateSalesPersons: input.associateSalesPersons ?? null,
      subtotal: input.subtotal ?? "0",
      overallDiscountPct: input.overallDiscountPct ?? "0",
      overallDiscountAmt: input.overallDiscountAmt ?? "0",
      sst: input.sst ?? "0",
      sstPct: input.sstPct ?? "0",
      grandTotal: input.grandTotal ?? "0",
      notes: input.notes ?? null,
      deliveryDate: input.deliveryDate ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      status: "draft",
      createdBy: userId,
    })
    .returning();

  if (input.items.length > 0) {
    await db.insert(salesOrderItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        salesOrderId: row.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        discountPct: item.discountPct ?? "0",
        discountAmt: item.discountAmt ?? "0",
        totalPrice: item.totalPrice ?? "0",
      })),
    );
  }

  revalidatePath("/dashboard/sales/order");
  return row;
}

export async function updateSalesOrder(input: UpdateSalesOrderInput): Promise<SalesOrderRow> {
  const { orgId, userId } = await requireAccess("sales-order:update");

  const [existing] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, input.id), eq(salesOrder.organizationId, orgId)));

  if (!existing) throw new Error("Sales order not found");
  if (existing.createdBy !== userId) throw new Error("Only the creator can edit this sales order");
  if (existing.status === "submitted" || existing.status === "confirmed")
    throw new Error("Cannot edit a submitted or confirmed sales order");

  // Delete old R2 file if key changed
  if (
    input.supplierQuotationKey !== undefined &&
    existing.supplierQuotationKey &&
    existing.supplierQuotationKey !== input.supplierQuotationKey
  ) {
    await deleteSupplierQuotationFile(existing.supplierQuotationKey);
  }

  // Rebuild customer snapshot if customer changed
  let customerSnapshot: SalesOrderRow["customerSnapshot"] = existing.customerSnapshot;
  if (input.customerId !== undefined) {
    if (!input.customerId) {
      customerSnapshot = null;
    } else {
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
          position: company?.position ?? undefined,
          department: company?.department ?? undefined,
        };
      }
    }
  }

  const [row] = await db
    .update(salesOrder)
    .set({
      customerId: input.customerId ?? existing.customerId,
      customerSnapshot,
      quotationId: input.linkedQuotations !== undefined
        ? (input.linkedQuotations[0]?.id ?? null)
        : (input.quotationId !== undefined ? (input.quotationId ?? null) : existing.quotationId),
      quotationNo: input.linkedQuotations !== undefined
        ? (input.linkedQuotations[0]?.quotationNo ?? null)
        : (input.quotationNo !== undefined ? (input.quotationNo ?? null) : existing.quotationNo),
      linkedQuotations: input.linkedQuotations !== undefined ? (input.linkedQuotations ?? null) : existing.linkedQuotations,
      supplierQuotationKey: input.supplierQuotationKey !== undefined
        ? input.supplierQuotationKey
        : existing.supplierQuotationKey,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      associateSalesPersons: input.associateSalesPersons !== undefined ? (input.associateSalesPersons ?? null) : existing.associateSalesPersons,
      subtotal: input.subtotal ?? existing.subtotal,
      overallDiscountPct: input.overallDiscountPct ?? existing.overallDiscountPct,
      overallDiscountAmt: input.overallDiscountAmt ?? existing.overallDiscountAmt,
      sst: input.sst ?? existing.sst,
      sstPct: input.sstPct ?? existing.sstPct,
      grandTotal: input.grandTotal ?? existing.grandTotal,
      notes: input.notes !== undefined ? (input.notes ?? null) : existing.notes,
      deliveryDate: input.deliveryDate !== undefined ? (input.deliveryDate ?? null) : existing.deliveryDate,
      deliveryAddress: input.deliveryAddress !== undefined ? (input.deliveryAddress ?? null) : existing.deliveryAddress,
      status: input.status ?? existing.status,
    })
    .where(eq(salesOrder.id, input.id))
    .returning();

  // Replace items
  await db.delete(salesOrderItem).where(eq(salesOrderItem.salesOrderId, input.id));

  if (input.items.length > 0) {
    await db.insert(salesOrderItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        salesOrderId: input.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        discountPct: item.discountPct ?? "0",
        discountAmt: item.discountAmt ?? "0",
        totalPrice: item.totalPrice ?? "0",
      })),
    );
  }

  revalidatePath("/dashboard/sales/order");
  return row;
}

export async function deleteSalesOrder(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("sales-order:delete");

  const [existing] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!existing) throw new Error("Sales order not found");
  if (existing.createdBy !== userId) throw new Error("Only the creator can delete this sales order");
  if (existing.status === "submitted" || existing.status === "confirmed" || existing.status === "fulfilled")
    throw new Error("Only draft or cancelled orders can be deleted");

  // Delete R2 supplier quotation file if present
  if (existing.supplierQuotationKey) {
    await deleteSupplierQuotationFile(existing.supplierQuotationKey);
  }

  // Unlink any POs that reference this SO (set salesOrderId → null)
  await db
    .update(purchaseOrder)
    .set({ salesOrderId: null })
    .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.salesOrderId, id)));

  // Unlink any DOs that reference this SO
  await db
    .update(deliveryOrder)
    .set({ salesOrderId: null, salesOrderNo: null })
    .where(and(eq(deliveryOrder.organizationId, orgId), eq(deliveryOrder.salesOrderId, id)));

  // Delete the SO (items cascade)
  await db.delete(salesOrder).where(eq(salesOrder.id, id));

  // Release the running number: decrement the counter if this was the latest number for the year
  const soYear = parseInt(existing.soNo.match(/\d{4}/)?.[0] ?? "0", 10);
  const soNum  = parseInt(existing.soNo.split("-").pop() ?? "0", 10);

  if (soYear > 0 && soNum > 0) {
    const [counter] = await db
      .select()
      .from(salesOrderCounter)
      .where(eq(salesOrderCounter.organizationId, orgId))
      .limit(1);

    if (counter && counter.year === soYear && counter.lastNumber === soNum && soNum > 1) {
      await db
        .update(salesOrderCounter)
        .set({ lastNumber: soNum - 1 })
        .where(eq(salesOrderCounter.organizationId, orgId));
    }
  }

  revalidatePath("/dashboard/sales/order");
}

export async function updateSalesOrderStatus(id: string, status: string): Promise<void> {
  const { orgId } = await requireAccess("sales-order:update");

  const [existing] = await db
    .select({ status: salesOrder.status })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!existing) throw new Error("Sales order not found");

  await db
    .update(salesOrder)
    .set({ status })
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  // Release reservation when cancelling a confirmed order
  if (existing.status === "confirmed" && status === "cancelled") {
    const soItems = await db
      .select({ productId: salesOrderItem.productId, qty: salesOrderItem.qty })
      .from(salesOrderItem)
      .where(eq(salesOrderItem.salesOrderId, id));

    await Promise.all(
      soItems
        .filter((i) => i.productId)
        .map((i) =>
          adjustReservation({
            orgId,
            productId: i.productId!,
            warehouseLabel: "Default",
            delta: -parseFloat(i.qty ?? "1"),
          }),
        ),
    );
  }
}

// ── Notification helper ────────────────────────────────────────────────────

async function notifyAndEmail(params: {
  orgId: string;
  recipientUserIds: string[];
  type: "so:submitted" | "so:approved" | "so:rejected" | "so:recalled";
  emailType: "submitted" | "approved" | "rejected" | "recalled";
  title: string;
  body: string;
  soNo: string;
  soId: string;
  customerName?: string;
  grandTotal?: string;
  actorName?: string;
}) {
  const link = `${baseUrl}/dashboard/sales/order/${params.soId}`;

  // Fetch recipient emails in parallel with notification creation
  const recipients = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(inArray(user.id, params.recipientUserIds));

  await Promise.all([
    // In-app notifications
    ...params.recipientUserIds.map((userId) =>
      createNotification({
        organizationId: params.orgId,
        userId,
        type: params.type,
        title: params.title,
        body: params.body,
        link: `/dashboard/sales/order/${params.soId}`,
      }),
    ),
    // Emails
    ...recipients.map((r) =>
      resend.emails.send({
        from: `${process.env.EMAIL_SENDER_NAME} <${process.env.EMAIL_SENDER_ADDRESS}>`,
        to: r.email,
        subject: params.title,
        react: SoNotificationEmail({
          type: params.emailType,
          soNo: params.soNo,
          customerName: params.customerName,
          grandTotal: params.grandTotal,
          recipientName: r.name,
          actorName: params.actorName,
          link,
        }),
      }),
    ),
  ]);
}

// ── Submit (draft → submitted) ─────────────────────────────────────────────

export async function submitSalesOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("sales-order:update");

  const [so] = await db
    .select({
      id: salesOrder.id,
      soNo: salesOrder.soNo,
      status: salesOrder.status,
      customerSnapshot: salesOrder.customerSnapshot,
      grandTotal: salesOrder.grandTotal,
      createdBy: salesOrder.createdBy,
    })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) throw new Error("Sales order not found");
  if (so.status !== "draft") throw new Error("Only draft orders can be submitted");

  await db
    .update(salesOrder)
    .set({ status: "submitted", submittedBy: userId, submittedAt: new Date() })
    .where(eq(salesOrder.id, id));

  revalidatePath(`/dashboard/sales/order/${id}`);
  revalidatePath("/dashboard/sales/order");

  // Notify approvers (fire-and-forget — don't block the response)
  const snap = so.customerSnapshot as any;
  const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : undefined;
  const actorName = session.user.name;

  getSoApprovers(orgId).then((approverIds) => {
    // Don't notify the submitter if they are also an approver
    const targets = approverIds.filter((uid) => uid !== userId);
    if (targets.length === 0) return;
    notifyAndEmail({
      orgId,
      recipientUserIds: targets,
      type: "so:submitted",
      emailType: "submitted",
      title: `SO ${so.soNo} pending approval`,
      body: `${actorName} submitted ${so.soNo} for approval.`,
      soNo: so.soNo,
      soId: so.id,
      customerName,
      grandTotal: so.grandTotal ?? undefined,
      actorName,
    });
  }).catch(console.error);
}

// ── Approve (submitted → confirmed) ───────────────────────────────────────

export async function approveSalesOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("sales-order:approve");

  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, customerSnapshot: salesOrder.customerSnapshot, grandTotal: salesOrder.grandTotal, createdBy: salesOrder.createdBy })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) throw new Error("Sales order not found");
  if (so.status !== "submitted") throw new Error("Only submitted orders can be approved");

  await db.update(salesOrder).set({ status: "confirmed", approvedBy: userId, approvedAt: new Date() }).where(eq(salesOrder.id, id));

  // Reserve stock for all items with a linked productId
  const soItems = await db
    .select({ productId: salesOrderItem.productId, qty: salesOrderItem.qty })
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, id));

  await Promise.all(
    soItems
      .filter((i) => i.productId)
      .map((i) =>
        adjustReservation({
          orgId,
          productId: i.productId!,
          warehouseLabel: "Default",
          delta: parseFloat(i.qty ?? "1"),
        }),
      ),
  );

  revalidatePath(`/dashboard/sales/order/${id}`);
  revalidatePath("/dashboard/sales/order");

  const snap = so.customerSnapshot as any;
  const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : undefined;
  const actorName = session.user.name;

  notifyAndEmail({
    orgId,
    recipientUserIds: [so.createdBy],
    type: "so:approved",
    emailType: "approved",
    title: `SO ${so.soNo} approved`,
    body: `Your sales order ${so.soNo} has been approved by ${actorName}.`,
    soNo: so.soNo,
    soId: so.id,
    customerName,
    grandTotal: so.grandTotal ?? undefined,
    actorName,
  }).catch(console.error);
}

// ── Reject (submitted → draft) ────────────────────────────────────────────

export async function rejectSalesOrder(id: string): Promise<void> {
  const { orgId, session } = await requireAccess("sales-order:approve");

  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, customerSnapshot: salesOrder.customerSnapshot, grandTotal: salesOrder.grandTotal, createdBy: salesOrder.createdBy })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) throw new Error("Sales order not found");
  if (so.status !== "submitted") throw new Error("Only submitted orders can be rejected");

  await db.update(salesOrder).set({ status: "draft" }).where(eq(salesOrder.id, id));

  revalidatePath(`/dashboard/sales/order/${id}`);
  revalidatePath("/dashboard/sales/order");

  const snap = so.customerSnapshot as any;
  const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : undefined;
  const actorName = session.user.name;

  notifyAndEmail({
    orgId,
    recipientUserIds: [so.createdBy],
    type: "so:rejected",
    emailType: "rejected",
    title: `SO ${so.soNo} returned for revision`,
    body: `Your sales order ${so.soNo} was returned for revision by ${actorName}.`,
    soNo: so.soNo,
    soId: so.id,
    customerName,
    grandTotal: so.grandTotal ?? undefined,
    actorName,
  }).catch(console.error);
}

// ── Recall (confirmed → draft) ────────────────────────────────────────────

export async function recallSalesOrder(id: string): Promise<void> {
  const { orgId, session } = await requireAccess("sales-order:approve");

  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status, customerSnapshot: salesOrder.customerSnapshot, grandTotal: salesOrder.grandTotal, createdBy: salesOrder.createdBy })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, orgId)));

  if (!so) throw new Error("Sales order not found");
  if (so.status !== "confirmed") throw new Error("Only confirmed orders can be recalled");

  await db.update(salesOrder).set({ status: "draft", approvedBy: null, approvedAt: null }).where(eq(salesOrder.id, id));

  // Release reserved stock
  const soItems = await db
    .select({ productId: salesOrderItem.productId, qty: salesOrderItem.qty })
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, id));

  await Promise.all(
    soItems
      .filter((i) => i.productId)
      .map((i) =>
        adjustReservation({
          orgId,
          productId: i.productId!,
          warehouseLabel: "Default",
          delta: -parseFloat(i.qty ?? "1"),
        }),
      ),
  );

  revalidatePath(`/dashboard/sales/order/${id}`);
  revalidatePath("/dashboard/sales/order");

  const snap = so.customerSnapshot as any;
  const customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : undefined;
  const actorName = session.user.name;

  notifyAndEmail({
    orgId,
    recipientUserIds: [so.createdBy],
    type: "so:recalled",
    emailType: "recalled",
    title: `SO ${so.soNo} recalled`,
    body: `Sales order ${so.soNo} has been recalled by ${actorName}.`,
    soNo: so.soNo,
    soId: so.id,
    customerName,
    grandTotal: so.grandTotal ?? undefined,
    actorName,
  }).catch(console.error);
}
