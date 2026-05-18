"use server";

import { db } from "@/db";
import {
  quotation,
  quotationItem,
  quotationCounter,
  customer,
  user,
  member,
  product,
  organization, // ← add organization here
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

// ── Helpers ────────────────────────────────────────────────────────────────
async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
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

async function getOwnerOrgId(
  userId: string,
  currentOrgId: string,
): Promise<string> {
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")),
    )
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

// ── Generate quotation number ──────────────────────────────────────────────
export async function generateQuotationNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();

  const [org] = await db
    .select({ slug: organization.slug, name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  const prefix = (org?.slug ?? "ORG").slice(0, 3).toUpperCase();

  const [existing] = await db
    .select()
    .from(quotationCounter)
    .where(eq(quotationCounter.organizationId, orgId))
    .limit(1);

  let nextNum: number;

  if (!existing || existing.year !== year) {
    await db
      .insert(quotationCounter)
      .values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 })
      .onConflictDoUpdate({
        target: quotationCounter.organizationId,
        set: { year, lastNumber: 1, updatedAt: new Date() },
      });
    nextNum = 1;
  } else {
    nextNum = existing.lastNumber + 1;
    await db
      .update(quotationCounter)
      .set({ lastNumber: nextNum, updatedAt: new Date() })
      .where(eq(quotationCounter.organizationId, orgId));
  }

  return `${prefix}-QT-${year}-${String(nextNum).padStart(4, "0")}`;
}

// ── Get org members for sales person picker ────────────────────────────────
export async function getOrgMembersForQuotation() {
  const { orgId } = await requireAccess("quotation:create");

  const rows = await db
    .select({
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId))
    .orderBy(user.name);

  return rows;
}

// ── Match spreadsheet rows to product DB ──────────────────────────────────
export type SpreadsheetRow = {
  rowNo: number;
  sku?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  unitPrice?: string;
  totalPrice?: string;
};

export type ReviewItem = SpreadsheetRow & {
  productId?: string;
  productName?: string;
  mdaRegNo?: string;
  mdaValidity?: string;
  hasCert: boolean;
  hasPrice: boolean;
  descriptionSource: "db" | "sheet";
  priceSource: "db" | "sheet";
  uomSource: "db" | "sheet";
  discountPct: string;
  discountAmt: string;
  computedTotal: string;
  status: "ok" | "no_price" | "no_cert" | "no_price_no_cert" | "not_found";
};

export async function matchSpreadsheetToProducts(
  rows: SpreadsheetRow[],
): Promise<ReviewItem[]> {
  const { orgId, userId } = await requireAccess("quotation:create");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const productCodes = rows
    .map((r) => r.productCode)
    .filter(Boolean) as string[];

  const products =
    productCodes.length > 0
      ? await db
          .select()
          .from(product)
          .where(
            and(
              eq(product.organizationId, ownerOrgId),
              inArray(product.productCode, productCodes),
            ),
          )
      : [];

  const productMap = new Map(products.map((p) => [p.productCode, p]));

  return rows.map((row) => {
    const dbProduct = row.productCode
      ? productMap.get(row.productCode)
      : undefined;

    // Merge: spreadsheet value wins if present, else use DB
    const description = row.description?.trim()
      ? { value: row.description, source: "sheet" as const }
      : { value: dbProduct?.description ?? "", source: "db" as const };

    const uom = row.uom?.trim()
      ? { value: row.uom, source: "sheet" as const }
      : { value: dbProduct?.uom ?? "", source: "db" as const };

    // For price: spreadsheet wins, else db unitPrice, else 0
    const sheetPrice = row.unitPrice?.replace(/[^0-9.]/g, "");
    const dbPrice = dbProduct?.unitPrice ?? "";
    const unitPrice =
      sheetPrice && Number(sheetPrice) > 0
        ? { value: sheetPrice, source: "sheet" as const }
        : dbPrice && Number(dbPrice) > 0
          ? { value: dbPrice, source: "db" as const }
          : { value: "0", source: "db" as const };

    const qty = Number(row.qty ?? 1);
    const price = Number(unitPrice.value);
    const total = (qty * price).toFixed(2);
    const hasPrice = Number(unitPrice.value) > 0;

    // Cert check — has MDA reg no that hasn't expired
    const mdaRegNo = dbProduct?.mdaRegistrationNo ?? "";

    const mdaValidity = dbProduct?.mdaExpiredOn ?? "";

    const hasCert = !!(
      mdaRegNo &&
      mdaValidity &&
      new Date(mdaValidity) > new Date()
    );
    console.log("new Date()", new Date());
    console.log(new Date(mdaValidity));
    console.log(new Date(mdaValidity) > new Date());

    let status: ReviewItem["status"] = "ok";
    if (!dbProduct) status = "not_found";
    else if (!hasPrice && !hasCert) status = "no_price_no_cert";
    else if (!hasPrice) status = "no_price";
    else if (!hasCert) status = "no_cert";

    return {
      ...row,
      productId: dbProduct?.id,
      productName: dbProduct?.description ?? "",
      mdaRegNo,
      mdaValidity,
      hasCert,
      hasPrice,
      description: description.value,
      descriptionSource: description.source,
      uom: uom.value,
      uomSource: uom.source,
      unitPrice: unitPrice.value,
      priceSource: unitPrice.source,
      discountPct: "0",
      discountAmt: "0",
      computedTotal: total,
      status,
    };
  });
}

// ── Create quotation ────────────────────────────────────────────────────────
export type CreateQuotationInput = {
  mode: "single" | "comparison";
  customerId?: string;
  salesPersonId?: string;
  salesPersonName?: string;
  validDays?: number;
  notes?: string;
  items: ReviewItem[];
  overallDiscountPct: string;
  sstPct: string;
  includeCatalogue: boolean;
  includeMdaCerts: boolean;
  showUnitPrice: boolean;
  showTotalPrice: boolean;
};

export async function createQuotation(input: CreateQuotationInput) {
  const { orgId, userId } = await requireAccess("quotation:create");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  // Get current user name
  const [me] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  // Get customer snapshot
  let customerSnapshot = null;
  if (input.customerId) {
    const [cust] = await db
      .select()
      .from(customer)
      .where(eq(customer.id, input.customerId))
      .limit(1);
    if (cust) {
      customerSnapshot = {
        title: cust.title ?? undefined,
        name: cust.name,
        position: cust.position ?? undefined,
        department: cust.department ?? undefined,
        email: cust.email ?? undefined,
        contactNo: cust.contactNo ?? undefined,
        organizationName: cust.organizationName ?? undefined,
        organizationAddress: cust.organizationAddress ?? undefined,
      };
    }
  }

  // Generate quotation number
  const quotationNo = await generateQuotationNo(ownerOrgId);

  // Calculate totals
  const subtotal = input.items.reduce((s, item) => {
    const qty = Number(item.qty ?? 1);
    const price = Number(item.unitPrice ?? 0);
    const disc = Number(item.discountPct ?? 0);
    return s + qty * price * (1 - disc / 100);
  }, 0);

  const overallDisc = Number(input.overallDiscountPct ?? 0);
  const afterDiscount = subtotal * (1 - overallDisc / 100);
  const sstAmt = afterDiscount * (Number(input.sstPct ?? 0) / 100);
  const grandTotal = afterDiscount + sstAmt;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (input.validDays ?? 30));

  // Insert quotation
  const [q] = await db
    .insert(quotation)
    .values({
      id: nanoid(),
      organizationId: ownerOrgId,
      quotationNo,
      mode: input.mode,
      customerId: input.customerId,
      customerSnapshot,
      salesPersonId: input.salesPersonId,
      salesPersonName: input.salesPersonName,
      preparedById: userId,
      preparedByName: me?.name ?? "",
      validUntil,
      notes: input.notes,
      subtotal: subtotal.toFixed(2),
      overallDiscountPct: input.overallDiscountPct,
      overallDiscountAmt: ((subtotal * overallDisc) / 100).toFixed(2),
      sst: sstAmt.toFixed(2),
      sstPct: input.sstPct,
      grandTotal: grandTotal.toFixed(2),
      includeCatalogue: input.includeCatalogue ? 1 : 0,
      includeMdaCerts: input.includeMdaCerts ? 1 : 0,
      showUnitPrice: input.showUnitPrice ? 1 : 0,
      showTotalPrice: input.showTotalPrice ? 1 : 0,
      status: "draft",
      createdBy: userId,
    })
    .returning();

  // Insert items
  await db.insert(quotationItem).values(
    input.items.map((item) => {
      const qty = Number(item.qty ?? 1);
      const price = Number(item.unitPrice ?? 0);
      const disc = Number(item.discountPct ?? 0);
      const total = qty * price * (1 - disc / 100);

      return {
        id: nanoid(),
        quotationId: q.id,
        rowNo: item.rowNo,
        sku: item.sku,
        productCode: item.productCode,
        description: item.description,
        qty: String(item.qty ?? 1),
        uom: item.uom,
        unitPrice: item.unitPrice ?? "0",
        discountPct: item.discountPct ?? "0",
        discountAmt: ((qty * price * disc) / 100).toFixed(2),
        totalPrice: total.toFixed(2),
        productId: item.productId,
        productName: item.productName,
        mdaRegNo: item.mdaRegNo,
        mdaValidity: item.mdaValidity,
        hasCert: item.hasCert ? 1 : 0,
        hasPrice: item.hasPrice ? 1 : 0,
        descriptionSource: item.descriptionSource,
        priceSource: item.priceSource,
        uomSource: item.uomSource,
      };
    }),
  );

  return q;
}

// ── Get quotations list ────────────────────────────────────────────────────
export async function getQuotations() {
  const { orgId, userId } = await requireAccess("quotation:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const rows = await db
    .select({
      id: quotation.id,
      quotationNo: quotation.quotationNo,
      mode: quotation.mode,
      customerSnapshot: quotation.customerSnapshot,
      salesPersonName: quotation.salesPersonName,
      preparedByName: quotation.preparedByName,
      grandTotal: quotation.grandTotal,
      status: quotation.status,
      validUntil: quotation.validUntil,
      createdAt: quotation.createdAt,
    })
    .from(quotation)
    .where(eq(quotation.organizationId, ownerOrgId))
    .orderBy(desc(quotation.createdAt));

  return rows;
}

// ── Get single quotation with items ───────────────────────────────────────
export async function getQuotationDetail(id: string) {
  const { orgId, userId } = await requireAccess("quotation:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [q] = await db
    .select()
    .from(quotation)
    .where(and(eq(quotation.id, id), eq(quotation.organizationId, ownerOrgId)))
    .limit(1);

  if (!q) return null;

  const items = await db
    .select()
    .from(quotationItem)
    .where(eq(quotationItem.quotationId, id))
    .orderBy(asc(quotationItem.rowNo));

  return { quotation: q, items };
}

// ── Delete quotation ───────────────────────────────────────────────────────
export async function deleteQuotation(id: string) {
  const { orgId, userId } = await requireAccess("quotation:delete");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  await db
    .delete(quotation)
    .where(and(eq(quotation.id, id), eq(quotation.organizationId, ownerOrgId)));
}
