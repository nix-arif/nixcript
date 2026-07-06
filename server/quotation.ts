"use server";

import { db } from "@/db";
import {
  quotation,
  quotationItem,
  quotationCounter,
  customerPurchaseOrder,
  customer,
  customerOrganization,
  customerCompany,
  user,
  member,
  product,
  organization,
  organizationProfile,
  profile,
} from "@/db/schema";
import { buildCustomerSnapshot } from "@/server/customer";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, asc, desc, inArray, sql, ilike, count, or, not } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ── R2 private bucket client (for presigned cert URLs) ─────────────────────
const s3Cert = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

async function presignCertKey(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const cmd = new GetObjectCommand({ Bucket: process.env.R2_CERTIFICATES_BUCKET!, Key: key });
  return getSignedUrl(s3Cert, cmd, { expiresIn: 3600 });
}

async function presignMdaKey(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const cmd = new GetObjectCommand({ Bucket: process.env.R2_MDA_CERTIFICATES_BUCKET!, Key: key });
  return getSignedUrl(s3Cert, cmd, { expiresIn: 3600 });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function subtractWeekdays(from: Date, days: number): Date {
  const d = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}

function randomWeekdaysBack(from: Date, min: number, max: number): Date {
  const days = Math.floor(Math.random() * (max - min + 1)) + min;
  return subtractWeekdays(from, days);
}

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

// Returns all organizations owned by the same owner as the current active org
async function getAllOwnerOrgs(
  userId: string,
  currentOrgId: string,
): Promise<{ id: string; name: string; slug: string }[]> {
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")),
    )
    .limit(1);

  if (!ownerMember) return [];

  const ownedMemberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt));

  if (ownedMemberships.length === 0) return [];

  const orgIds = [...new Set(ownedMemberships.map((m) => m.organizationId))];

  const orgs = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(organization)
    .where(inArray(organization.id, orgIds));

  // Preserve creation order
  return orgIds.map((id) => orgs.find((o) => o.id === id)).filter(Boolean) as {
    id: string;
    name: string;
    slug: string;
  }[];
}

// ── Get owner's organizations (for comparison mode UI) ────────────────────
export async function getOwnerOrganizations() {
  const { orgId, userId } = await requireAccess("quotation:create");
  return getAllOwnerOrgs(userId, orgId);
}

// ── Generate quotation number ──────────────────────────────────────────────
// Format read from organizationProfile.quotationNoFormat (A | B | C)
function formatQuotationNo(
  num: number,
  org: { slug: string | null; name: string | null; quotationNoFormat: string | null } | undefined,
): string {
  const now = new Date();
  const year = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(year).slice(-2);
  const format = org?.quotationNoFormat ?? "A";

  if (format === "B") {
    const cleaned = (org?.name ?? "ORG")
      .replace(/\s*\(M\)\s*/gi, " ")
      .replace(/\bsdn\.?\s*bhd\.?\b/gi, "")
      .replace(/\bbhd\.?\b/gi, "")
      .replace(/\bsdn\.?\b/gi, "")
      .trim();
    const chars = cleaned.slice(0, 3).toUpperCase();
    return `Q${chars}-${mm}${yy}-${String(num).padStart(5, "0")}`;
  }

  if (format === "C") {
    const initials = (org?.name ?? "ORG")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    return `QT-${initials}-${year}-${String(num).padStart(6, "0")}`;
  }

  const prefix = (org?.slug ?? "ORG").slice(0, 3).toUpperCase();
  return `${prefix}-QT-${year}-${String(num).padStart(4, "0")}`;
}

export async function generateQuotationNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();

  const [org] = await db
    .select({
      slug: organization.slug,
      name: organization.name,
      quotationNoFormat: organizationProfile.quotationNoFormat,
    })
    .from(organization)
    .leftJoin(
      organizationProfile,
      eq(organizationProfile.organizationId, organization.id),
    )
    .where(eq(organization.id, orgId))
    .limit(1);

  // Atomic upsert: single round-trip, no read-then-write race.
  // • First quotation for org  → insert lastNumber=1
  // • Same year                → increment lastNumber by 1
  // • New year                 → reset lastNumber to 1
  const [counter] = await db
    .insert(quotationCounter)
    .values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: quotationCounter.organizationId,
      set: {
        lastNumber: sql`CASE WHEN ${quotationCounter.year} = ${year} THEN ${quotationCounter.lastNumber} + 1 ELSE 1 END`,
        year: sql`${year}`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastNumber: quotationCounter.lastNumber });

  return formatQuotationNo(counter.lastNumber, org);
}

// Read-only preview — does NOT increment the counter.
export async function peekNextQuotationNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();

  const [[org], [existing]] = await Promise.all([
    db
      .select({
        slug: organization.slug,
        name: organization.name,
        quotationNoFormat: organizationProfile.quotationNoFormat,
      })
      .from(organization)
      .leftJoin(
        organizationProfile,
        eq(organizationProfile.organizationId, organization.id),
      )
      .where(eq(organization.id, orgId))
      .limit(1),
    db
      .select({ lastNumber: quotationCounter.lastNumber, year: quotationCounter.year })
      .from(quotationCounter)
      .where(eq(quotationCounter.organizationId, orgId))
      .limit(1),
  ]);

  const nextNum = existing && existing.year === year ? existing.lastNumber + 1 : 1;
  return formatQuotationNo(nextNum, org);
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

  return rows.map((r) => ({ ...r, name: r.name?.toLowerCase() ?? r.name }));
}

// ── Match spreadsheet rows to product DB ──────────────────────────────────
export type SpreadsheetRow = {
  rowNo: string;
  sku?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  unitPrice?: string;
  discountPct?: string;
  totalPrice?: string;
  // sell / rent
  lineType?: "sell" | "rent";
  rentalDuration?: string;
  rentalUnit?: string;
  // set grouping
  setGroupId?: string;
  setGroupLabel?: string;
  setQty?: string;
};

export type ReviewItem = SpreadsheetRow & {
  productId?: string;
  productName?: string;
  imageKey?: string; // R2 key for catalogue image
  mdaRegNo?: string;
  mdaValidity?: string;
  hasCert: boolean;
  hasPrice: boolean;
  descriptionSource: "db" | "sheet" | "user";
  priceSource: "db" | "sheet" | "user";
  uomSource: "db" | "sheet";
  discountSource?: "user";
  setQtySource?: "user";
  discountPct: string;
  discountAmt: string;
  computedTotal: string;
  status: "ok" | "no_price" | "no_cert" | "no_price_no_cert" | "not_found";
};

export async function matchSpreadsheetToProducts(
  rows: SpreadsheetRow[],
): Promise<ReviewItem[]> {
  const { orgId, userId } = await requireAccess("quotation:create");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds = ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

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
              inArray(product.organizationId, ownerOrgIds),
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

    // For price: spreadsheet wins, else db sellingUnitPrice, else 0
    const sheetPrice = row.unitPrice?.replace(/[^0-9.]/g, "");
    const dbPrice = dbProduct?.sellingUnitPrice ?? "";
    const unitPrice =
      sheetPrice && Number(sheetPrice) > 0
        ? { value: sheetPrice, source: "sheet" as const }
        : dbPrice && Number(dbPrice) > 0
          ? { value: dbPrice, source: "db" as const }
          : { value: "0", source: "db" as const };

    const discountPct = row.discountPct?.trim() && Number(row.discountPct) > 0
      ? row.discountPct.trim()
      : "0";

    const qty = Number(row.qty ?? 1);
    const price = Number(unitPrice.value);
    const disc = Number(discountPct) / 100;
    const total = (qty * price * (1 - disc)).toFixed(2);
    const hasPrice = Number(unitPrice.value) > 0;

    const mdaRegNo = dbProduct?.mdaRegistrationNo ?? "";
    const mdaValidity = dbProduct?.mdaExpiredOn ?? "";

    // Cert check — product has an MDA PDF cert file (matches MDA generator logic)
    const hasCert = !!(dbProduct?.mdaPdfFile);

    let status: ReviewItem["status"] = "ok";
    if (!dbProduct) status = "not_found";
    else if (!hasPrice && !hasCert) status = "no_price_no_cert";
    else if (!hasPrice) status = "no_price";
    else if (!hasCert) status = "no_cert";

    return {
      ...row,
      productId: dbProduct?.id,
      productName: dbProduct?.description ?? "",
      imageKey: dbProduct?.imageKey ?? undefined,
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
      discountPct,
      discountAmt: (qty * price * disc).toFixed(2),
      computedTotal: total,
      status,
    };
  });
}

// ── Create quotation ────────────────────────────────────────────────────────
export type CreateQuotationInput = {
  mode: "single" | "comparison";
  title?: string;
  sets?: number;
  customerId?: string;
  customerOrgMemberId?: string;
  salesPersonId?: string;
  salesPersonName?: string;
  associateSalesPersons?: { id: string; name: string }[] | null;
  validDays?: number;
  notes?: string;
  deliveryTerm?: string;
  paymentTerm?: string;
  returnPolicy?: string;
  warranty?: string;
  items: ReviewItem[];
  overallDiscountPct: string;
  overallDiscountAmt?: string;
  sstPct: string;
  includeCatalogue: boolean;
  includeMdaCerts: boolean;
  showTotalPrice: boolean;
  showItemizeDiscount: boolean;
  showProductCode: boolean;
  inclMof: boolean;
  inclSsm: boolean;
  inclTcc: boolean;
  inclBankStatement: boolean;
  inclMdaEstablishment: boolean;
  inclLampiran12: boolean;
  inclLampiran13: boolean;
  categoryIds?: string[];
};

function calcItemTotal(item: Pick<ReviewItem, "qty" | "unitPrice" | "discountPct" | "lineType" | "rentalDuration" | "setGroupId" | "setQty">): number {
  const qty = Number(item.qty ?? 1);
  const price = Number(item.unitPrice ?? 0);
  const disc = Number(item.discountPct ?? 0) / 100;
  const setMultiplier = item.setGroupId ? Number(item.setQty ?? 1) : 1;
  const duration = item.lineType === "rent" ? Number(item.rentalDuration ?? 1) : 1;
  return qty * setMultiplier * duration * price * (1 - disc);
}

function buildItemRows(quotationId: string, items: ReviewItem[]) {
  return items.map((item, i) => {
    const qty = Number(item.qty ?? 1);
    const price = Number(item.unitPrice ?? 0);
    const disc = Number(item.discountPct ?? 0) / 100;
    const total = calcItemTotal(item);

    return {
      id: nanoid(),
      quotationId,
      sortOrder: i,
      rowNo: item.rowNo,
      sku: item.sku,
      productCode: item.productCode,
      description: item.description,
      qty: String(item.qty ?? 1),
      uom: item.uom,
      unitPrice: item.unitPrice ?? "0",
      discountPct: item.discountPct ?? "0",
      discountAmt: (qty * price * disc).toFixed(2),
      totalPrice: total.toFixed(2),
      productId: item.productId,
      productName: item.productName,
      imageKey: item.imageKey ?? null,
      mdaRegNo: item.mdaRegNo,
      mdaValidity: item.mdaValidity,
      hasCert: item.hasCert ? 1 : 0,
      hasPrice: item.hasPrice ? 1 : 0,
      descriptionSource: item.descriptionSource,
      priceSource: item.priceSource,
      uomSource: item.uomSource,
      discountSource: item.discountSource ?? null,
      setQtySource: item.setQtySource ?? null,
      lineType: item.lineType ?? "sell",
      rentalDuration: item.rentalDuration ?? null,
      rentalUnit: item.rentalUnit ?? null,
      setGroupId: item.setGroupId ?? null,
      setGroupLabel: item.setGroupLabel ?? null,
      setQty: item.setQty ?? null,
    };
  });
}

export async function createQuotation(input: CreateQuotationInput) {
  const { orgId, userId } = await requireAccess("quotation:create");

  // Get current user name
  const [me] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  // Get customer snapshot using the shared helper
  const customerSnapshot = input.customerId
    ? await buildCustomerSnapshot(input.customerId, input.customerOrgMemberId)
    : null;

  // Calculate shared pricing — set items use setQty multiplier; global sets multiplies the rest
  const setsCount = Math.max(1, input.sets ?? 1);
  const perSetSubtotal = input.items.reduce((s, item) => s + calcItemTotal(item), 0);
  const subtotal = perSetSubtotal * setsCount;

  const overallDiscPct = Number(input.overallDiscountPct ?? 0);
  const overallDiscAmt = overallDiscPct > 0
    ? subtotal * (overallDiscPct / 100)
    : Number(input.overallDiscountAmt ?? 0);
  const afterDiscount = subtotal - overallDiscAmt;
  const sstAmt = afterDiscount * (Number(input.sstPct ?? 0) / 100);
  const grandTotal = afterDiscount + sstAmt;

  const validDaysNum = input.validDays ?? 30;

  const sharedValues = {
    mode: input.mode,
    customerId: input.customerId,
    customerSnapshot,
    salesPersonId: input.salesPersonId,
    salesPersonName: input.salesPersonName?.toLowerCase() ?? null,
    associateSalesPersons: input.associateSalesPersons ?? null,
    preparedById: userId,
    preparedByName: me?.name?.toLowerCase() ?? "",
    notes: input.notes,
    deliveryTerm: input.deliveryTerm ?? null,
    paymentTerm: input.paymentTerm ?? null,
    returnPolicy: input.returnPolicy ?? null,
    warranty: input.warranty ?? null,
    subtotal: subtotal.toFixed(2),
    overallDiscountPct: input.overallDiscountPct,
    overallDiscountAmt: overallDiscAmt.toFixed(2),
    sst: sstAmt.toFixed(2),
    sstPct: input.sstPct,
    grandTotal: grandTotal.toFixed(2),
    title: input.title ?? "Loose Items",
    sets: setsCount,
    includeCatalogue: input.includeCatalogue ? 1 : 0,
    includeMdaCerts: input.includeMdaCerts ? 1 : 0,
    showUnitPrice: 1,
    showTotalPrice: input.showTotalPrice ? 1 : 0,
    showItemizeDiscount: input.showItemizeDiscount ? 1 : 0,
    showProductCode: input.showProductCode ? 1 : 0,
    inclMof: input.inclMof ? 1 : 0,
    inclSsm: input.inclSsm ? 1 : 0,
    inclTcc: input.inclTcc ? 1 : 0,
    inclBankStatement: input.inclBankStatement ? 1 : 0,
    inclMdaEstablishment: input.inclMdaEstablishment ? 1 : 0,
    inclLampiran12: input.inclLampiran12 ? 1 : 0,
    inclLampiran13: input.inclLampiran13 ? 1 : 0,
    status: "draft" as const,
    categoryIds: input.categoryIds ?? [],
    createdBy: userId,
  };

  if (input.mode === "single") {
    const baseDate = new Date();
    const validUntil = new Date(baseDate);
    validUntil.setDate(validUntil.getDate() + validDaysNum);

    const qId = nanoid();
    const [q] = await db
      .insert(quotation)
      .values({
        id: qId,
        organizationId: orgId,
        quotationNo: `PENDING-${qId}`,
        isDummy: 0,
        validUntil,
        ...sharedValues,
      })
      .returning();

    await db.insert(quotationItem).values(buildItemRows(q.id, input.items));

    return q;
  }

  // ── Comparison mode ────────────────────────────────────────────────────────
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);

  // Fall back to single if only one org
  const targetOrgs =
    ownerOrgs.length > 0 ? ownerOrgs : [{ id: orgId, name: "", slug: "" }];

  const primaryOrgId = orgId;

  const groupId = nanoid();
  let originalQuotation: typeof quotation.$inferSelect | null = null;

  const originalDate = new Date();

  // Pre-generate ascending random markups for each dummy org
  const dummyOrgIds = targetOrgs.filter((o) => o.id !== primaryOrgId).map((o) => o.id);
  let markupMin = 5;
  const orgMarkupMap = new Map<string, number>();
  for (const orgId of dummyOrgIds) {
    const markupMax = Math.min(markupMin + 15, 50);
    const markupPct = Math.floor(Math.random() * (markupMax - markupMin + 1)) + markupMin;
    orgMarkupMap.set(orgId, markupPct);
    markupMin = markupPct + 3;
  }

  for (const org of targetOrgs) {
    const isDummy = org.id !== primaryOrgId ? 1 : 0;
    const dummyDate = isDummy ? randomWeekdaysBack(new Date(), 1, 14) : undefined;
    const qDate = dummyDate ?? originalDate;
    const validUntil = new Date(qDate);
    validUntil.setDate(validUntil.getDate() + validDaysNum);

    const markupFactor = isDummy ? 1 + (orgMarkupMap.get(org.id) ?? 0) / 100 : 1;

    // Compute per-quotation totals (dummy totals differ due to markup)
    let qSubtotal = 0;
    const markedUpItems = input.items.map((item) => {
      const qty = Number(item.qty ?? 1);
      const rawPrice = Number(item.unitPrice ?? 0);
      const markedPrice = Math.ceil(rawPrice * markupFactor);
      const disc = Number(item.discountPct ?? 0) / 100;
      qSubtotal += qty * markedPrice * (1 - disc);
      return { ...item, unitPrice: markedPrice.toFixed(2) };
    });
    qSubtotal = qSubtotal * setsCount;
    const qOverallDiscAmt = overallDiscPct > 0
      ? qSubtotal * (overallDiscPct / 100)
      : Number(input.overallDiscountAmt ?? 0) * markupFactor;
    const qAfterDiscount = qSubtotal - qOverallDiscAmt;
    const qSstAmt = qAfterDiscount * (Number(input.sstPct ?? 0) / 100);
    const qGrandTotal = qAfterDiscount + qSstAmt;

    const qId = nanoid();
    const [q] = await db
      .insert(quotation)
      .values({
        id: qId,
        organizationId: org.id,
        quotationNo: `PENDING-${qId}`,
        groupId,
        isDummy,
        ...(dummyDate ? { createdAt: dummyDate } : {}),
        validUntil,
        ...sharedValues,
        subtotal: qSubtotal.toFixed(2),
        overallDiscountAmt: qOverallDiscAmt.toFixed(2),
        sst: qSstAmt.toFixed(2),
        grandTotal: qGrandTotal.toFixed(2),
      })
      .returning();

    await db.insert(quotationItem).values(buildItemRows(q.id, markedUpItems as any));

    if (isDummy === 0) originalQuotation = q;
  }

  // originalQuotation is always set when orgId is in ownerOrgs
  return (
    originalQuotation ??
    (await db
      .select()
      .from(quotation)
      .where(eq(quotation.groupId, groupId))
      .limit(1)
      .then(([r]) => r))
  );
}

// ── Get quotations list (grouped) ─────────────────────────────────────────
// Returns all quotations (originals + dummies) as structured groups.
// Comparison groups surface all members; singles are 1-member groups.
export async function getQuotationsList() {
  const { orgId, userId } = await requireAccess("quotation:read");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds =
    ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  // Order originals first so they become the group header
  const rows = await db
    .select({
      id: quotation.id,
      quotationNo: quotation.quotationNo,
      mode: quotation.mode,
      groupId: quotation.groupId,
      isDummy: quotation.isDummy,
      customerSnapshot: quotation.customerSnapshot,
      salesPersonName: quotation.salesPersonName,
      preparedByName: quotation.preparedByName,
      grandTotal: quotation.grandTotal,
      status: quotation.status,
      validUntil: quotation.validUntil,
      createdAt: quotation.createdAt,
      title: quotation.title,
      orgName: organization.name,
      revisionNo: quotation.revisionNo,
      originalQuotationId: quotation.originalQuotationId,
      govBatchId: quotation.govBatchId,
    })
    .from(quotation)
    .innerJoin(organization, eq(organization.id, quotation.organizationId))
    .where(inArray(quotation.organizationId, ownerOrgIds))
    .orderBy(asc(quotation.isDummy), desc(quotation.createdAt));

  type Row = (typeof rows)[number];

  const groupMap = new Map<string, { header: Row; members: Row[] }>();
  for (const row of rows) {
    const key = row.groupId ?? row.id;
    if (!groupMap.has(key)) {
      groupMap.set(key, { header: row, members: [] });
    }
    groupMap.get(key)!.members.push(row);
  }

  const groups = Array.from(groupMap.values()).map(({ header, members }) => {
    const allFinal = members.every((m) => m.status === "final");
    return {
      groupId: header.groupId,
      govBatchId: header.govBatchId ?? null,
      mode: header.mode,
      primaryId: header.id,
      customerSnapshot: header.customerSnapshot,
      salesPersonName: header.salesPersonName,
      preparedByName: header.preparedByName ?? "",
      createdAt: header.createdAt,
      validUntil: header.validUntil,
      status: header.groupId ? (allFinal ? "final" : "draft") : header.status,
      title: header.title,
      members: members.map((m) => ({
        id: m.id,
        quotationNo: m.quotationNo,
        orgName: m.orgName ?? "",
        grandTotal: m.grandTotal,
        isDummy: m.isDummy,
        status: m.status,
        createdAt: m.createdAt,
        revisionNo: m.revisionNo ?? 0,
        originalQuotationId: m.originalQuotationId ?? null,
      })),
    };
  });

  groups.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return groups;
}

export type QuotationListGroup = Awaited<
  ReturnType<typeof getQuotationsList>
>[number];

// ── Get quotations list (legacy — originals only) ──────────────────────────
export async function getQuotations() {
  const { orgId, userId } = await requireAccess("quotation:read");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds =
    ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  const rows = await db
    .select({
      id: quotation.id,
      quotationNo: quotation.quotationNo,
      mode: quotation.mode,
      groupId: quotation.groupId,
      isDummy: quotation.isDummy,
      customerSnapshot: quotation.customerSnapshot,
      salesPersonName: quotation.salesPersonName,
      preparedByName: quotation.preparedByName,
      grandTotal: quotation.grandTotal,
      status: quotation.status,
      validUntil: quotation.validUntil,
      createdAt: quotation.createdAt,
      orgName: organization.name,
    })
    .from(quotation)
    .innerJoin(organization, eq(organization.id, quotation.organizationId))
    .where(
      and(
        inArray(quotation.organizationId, ownerOrgIds),
        eq(quotation.isDummy, 0),
      ),
    )
    .orderBy(desc(quotation.createdAt));

  return rows;
}

// ── Lightweight single-row lookup (for cross-doc references) ─────────────
export async function getQuotationBasic(id: string) {
  const { orgId } = await requireAccess("quotation:read");

  const [row] = await db
    .select({
      id: quotation.id,
      quotationNo: quotation.quotationNo,
      status: quotation.status,
      grandTotal: quotation.grandTotal,
      validUntil: quotation.validUntil,
      createdAt: quotation.createdAt,
      salesPersonName: quotation.salesPersonName,
    })
    .from(quotation)
    .where(and(eq(quotation.id, id), eq(quotation.organizationId, orgId)))
    .limit(1);

  return row ?? null;
}

export type QuotationBasic = NonNullable<Awaited<ReturnType<typeof getQuotationBasic>>>;

// ── Search quotations by number (for SO creation lookup) ─────────────────
export async function searchQuotationsByNo(query: string, includeDummy = false) {
  const { orgId } = await requireAccess("quotation:read");

  // Match against the running number only (part after the last "-")
  // e.g. typing "42" matches "BMS-QT-2025-0042", not the prefix
  const rows = await db
    .select({
      id: quotation.id,
      quotationNo: quotation.quotationNo,
      status: quotation.status,
      isDummy: quotation.isDummy,
      grandTotal: quotation.grandTotal,
      customerId: quotation.customerId,
      customerSnapshot: quotation.customerSnapshot,
      createdAt: quotation.createdAt,
    })
    .from(quotation)
    .where(
      and(
        eq(quotation.organizationId, orgId),
        sql`REGEXP_REPLACE(${quotation.quotationNo}, '^.*-', '') ILIKE ${'%' + query + '%'}`,
        includeDummy ? sql`1=1` : eq(quotation.isDummy, 0),
        eq(quotation.status, "final"),
      ),
    )
    .orderBy(asc(quotation.isDummy), desc(quotation.createdAt))
    .limit(10);

  const filteredRows = includeDummy ? rows : rows.filter((r) => r.isDummy !== 1);
  if (filteredRows.length === 0) return filteredRows.map((r) => ({ ...r, cpoCount: 0 }));

  // Count existing CPOs per quotation so the UI can show "2 CPOs already"
  const qtIds = filteredRows.map((r) => r.id);
  const cpoCounts = await db
    .select({ quotationId: customerPurchaseOrder.quotationId, cnt: count() })
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.organizationId, orgId), inArray(customerPurchaseOrder.quotationId, qtIds)))
    .groupBy(customerPurchaseOrder.quotationId);

  const cpoCountMap: Record<string, number> = {};
  for (const c of cpoCounts) if (c.quotationId) cpoCountMap[c.quotationId] = c.cnt;

  return filteredRows.map((r) => ({ ...r, cpoCount: cpoCountMap[r.id] ?? 0 }));
}

// ── Fetch quotation with items for SO pre-fill ───────────────────────────
export async function getQuotationForSO(id: string) {
  const { orgId, userId } = await requireAccess("quotation:read");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds = ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  const [q] = await db
    .select({
      id: quotation.id,
      quotationNo: quotation.quotationNo,
      title: quotation.title,
      status: quotation.status,
      isDummy: quotation.isDummy,
      grandTotal: quotation.grandTotal,
      subtotal: quotation.subtotal,
      overallDiscountPct: quotation.overallDiscountPct,
      overallDiscountAmt: quotation.overallDiscountAmt,
      sstPct: quotation.sstPct,
      sst: quotation.sst,
      customerSnapshot: quotation.customerSnapshot,
      customerId: quotation.customerId,
      salesPersonName: quotation.salesPersonName,
      associateSalesPersons: quotation.associateSalesPersons,
      notes: quotation.notes,
    })
    .from(quotation)
    .where(and(eq(quotation.id, id), inArray(quotation.organizationId, ownerOrgIds)))
    .limit(1);

  if (!q) return null;
  if (q.status !== "final") throw new Error("Only finalized quotations can be linked to a sales order");

  const items = await db
    .select({
      rowNo: quotationItem.rowNo,
      productId: quotationItem.productId,
      productCode: quotationItem.productCode,
      description: quotationItem.description,
      qty: quotationItem.qty,
      uom: quotationItem.uom,
      unitPrice: quotationItem.unitPrice,
      discountPct: quotationItem.discountPct,
      discountAmt: quotationItem.discountAmt,
      totalPrice: quotationItem.totalPrice,
      lineType: quotationItem.lineType,
      rentalDuration: quotationItem.rentalDuration,
      rentalUnit: quotationItem.rentalUnit,
      setGroupId: quotationItem.setGroupId,
      setGroupLabel: quotationItem.setGroupLabel,
      setQty: quotationItem.setQty,
    })
    .from(quotationItem)
    .where(eq(quotationItem.quotationId, id))
    .orderBy(asc(quotationItem.sortOrder));

  // If quotation items have no set groups, inherit group assignments from the most recent CPO
  // that was created from this quotation (groups are often defined at CPO level, not quotation level)
  const hasUngrouppedItems = items.some((i) => !i.setGroupId);
  if (hasUngrouppedItems) {
    const [cpoRow] = await db
      .select({ items: customerPurchaseOrder.items })
      .from(customerPurchaseOrder)
      .where(and(
        inArray(customerPurchaseOrder.organizationId, ownerOrgIds),
        eq(customerPurchaseOrder.quotationId, id),
      ))
      .orderBy(desc(customerPurchaseOrder.createdAt))
      .limit(1);

    const cpoItems = cpoRow?.items;
    if (cpoItems && cpoItems.length === items.length) {
      const enriched = items.map((qtItem, idx) => {
        if (qtItem.setGroupId) return qtItem;
        const cpoItem = cpoItems[idx];
        if (!cpoItem?.setGroupId) return qtItem;
        return { ...qtItem, setGroupId: cpoItem.setGroupId, setGroupLabel: cpoItem.setGroupLabel ?? null, setQty: cpoItem.setQty ?? null };
      });
      return { ...q, items: enriched };
    }
  }

  return { ...q, items };
}

export type QuotationForSO = NonNullable<Awaited<ReturnType<typeof getQuotationForSO>>>;

// ── Get single quotation with items + siblings ────────────────────────────
export async function getQuotationDetail(id: string) {
  const { orgId, userId } = await requireAccess("quotation:read");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds =
    ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  const [q] = await db
    .select()
    .from(quotation)
    .where(
      and(eq(quotation.id, id), inArray(quotation.organizationId, ownerOrgIds)),
    )
    .limit(1);

  if (!q) return null;

  const [orgRow] = await db
    .select({
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      logoKey: organizationProfile.logoKey,
      brandColor: organizationProfile.brandColor,
      slateTextColor: organizationProfile.slateTextColor,
      slateHeadingColor: organizationProfile.slateHeadingColor,
      slateInfoFontSize: organizationProfile.slateInfoFontSize,
      companyName: organizationProfile.companyName,
      companyAddress: organizationProfile.companyAddress,
      taxNo: organizationProfile.taxNo,
      mofNo: organizationProfile.mofNo,
      phone: organizationProfile.phone,
      email: organizationProfile.email,
      website: organizationProfile.website,
      oldSsmNo: organizationProfile.oldSsmNo,
      newSsmNo: organizationProfile.newSsmNo,
      mdaEstablishmentNo: organizationProfile.mdaEstablishmentNo,
      bankingInfo: organizationProfile.bankingInfo,
      mofCertUrl: organizationProfile.mofCertUrl,
      ssmCertUrl: organizationProfile.ssmCertUrl,
      mdaCertUrl: organizationProfile.mdaCertUrl,
      taxCertUrl: organizationProfile.taxCertUrl,
      bankStatementUrl: organizationProfile.bankStatementUrl,
      lampiran12Url: organizationProfile.lampiran12Url,
      lampiran13Url: organizationProfile.lampiran13Url,
      pdfTemplate: organizationProfile.pdfTemplate,
      titlePosition:    organizationProfile.titlePosition,
      tableFontSize:    organizationProfile.tableFontSize,
      headerLayout:     organizationProfile.headerLayout,
      orgNameSize:      organizationProfile.orgNameSize,
      orgNameBold:      organizationProfile.orgNameBold,
      orgNameUppercase: organizationProfile.orgNameUppercase,
      orgInfoSide:             organizationProfile.orgInfoSide,
      quotationLabelSize:      organizationProfile.quotationLabelSize,
      quotationLabelBold:      organizationProfile.quotationLabelBold,
      quotationLabelUppercase: organizationProfile.quotationLabelUppercase,
      quotationLabelAlign:     organizationProfile.quotationLabelAlign,
      tableRowStyle:           organizationProfile.tableRowStyle,
      showCodeColumn:          organizationProfile.showCodeColumn,
      attentionNameSize: organizationProfile.attentionNameSize,
      attentionNameBold: organizationProfile.attentionNameBold,
      detailFontSize:    organizationProfile.detailFontSize,
      detailFontBold:    organizationProfile.detailFontBold,
      detailAlignment:   organizationProfile.detailAlignment,
    })
    .from(organization)
    .leftJoin(
      organizationProfile,
      eq(organizationProfile.organizationId, organization.id),
    )
    .where(eq(organization.id, q.organizationId))
    .limit(1);

  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const orgLogoUrl = orgRow?.logoKey
    ? `${r2Public}/${orgRow.logoKey}`
    : (orgRow?.logo ?? null);

  // Live customer record — merge over snapshot so stale/missing snapshots still show data
  let customerData: {
    title?: string | null;
    name?: string;
    position?: string | null;
    department?: string | null;
    email?: string | null;
    contactNo?: string | null;
    organizationName?: string | null;
    organizationAddress?: string | null;
  } | null = null;

  if (q.customerId) {
    const [cust] = await db
      .select({
        title: customer.title,
        name: customer.name,
        email: customer.email,
        contactNo: customer.contactNo,
      })
      .from(customer)
      .where(eq(customer.id, q.customerId))
      .limit(1);
    if (cust) {
      // Prefer membership data from the new M2M tables (primary or first)
      const [mem] = await db
        .select({
          orgName: customerOrganization.name,
          orgAddress: customerOrganization.address,
          position: customerCompany.position,
          department: customerCompany.department,
        })
        .from(customerCompany)
        .innerJoin(
          customerOrganization,
          eq(customerOrganization.id, customerCompany.customerOrganizationId),
        )
        .where(eq(customerCompany.customerId, q.customerId))
        .orderBy(desc(customerCompany.isPrimary), asc(customerCompany.createdAt))
        .limit(1);

      customerData = {
        ...cust,
        position: mem?.position ?? null,
        department: mem?.department ?? null,
        organizationName: mem?.orgName ?? null,
        organizationAddress: mem?.orgAddress ?? null,
      };
    }
  }

  // Merge: personal fields (name, contact) use live data; org fields use snapshot
  // because the snapshot records which specific org the user chose for this quotation.
  const snapshot = q.customerSnapshot as Record<string, string> | null;
  const mergedCustomerSnapshot = customerData
    ? {
        title: customerData.title ?? snapshot?.title,
        name: customerData.name ?? snapshot?.name ?? "",
        email: customerData.email ?? snapshot?.email,
        contactNo: customerData.contactNo ?? snapshot?.contactNo,
        organizationName: snapshot?.organizationName ?? customerData.organizationName,
        organizationAddress: snapshot?.organizationAddress ?? customerData.organizationAddress,
        position: snapshot?.position ?? customerData.position,
        department: snapshot?.department ?? customerData.department,
      }
    : snapshot;

  const rawItems = await db
    .select()
    .from(quotationItem)
    .where(eq(quotationItem.quotationId, id))
    .orderBy(asc(quotationItem.sortOrder));

  // Enrich items with product MDA PDF fields
  const certCodes = [...new Set(
    rawItems.filter(i => i.hasCert && i.productCode).map(i => i.productCode!),
  )];
  const pMdaMap = new Map<string, {
    mdaPdfFile: string | null; mdaPageNo: string | null;
    mdaMatchX: string | null; mdaMatchY: string | null;
    mdaRowHeight: string | null; mdaPageWidth: string | null; mdaPageHeight: string | null;
  }>();
  if (certCodes.length > 0) {
    const pRows = await db.select({
      productCode: product.productCode,
      mdaPdfFile: product.mdaPdfFile,
      mdaPageNo: product.mdaPageNo,
      mdaMatchX: product.mdaMatchX,
      mdaMatchY: product.mdaMatchY,
      mdaRowHeight: product.mdaRowHeight,
      mdaPageWidth: product.mdaPageWidth,
      mdaPageHeight: product.mdaPageHeight,
    }).from(product).where(and(
      inArray(product.organizationId, ownerOrgIds),
      inArray(product.productCode, certCodes),
    ));
    for (const r of pRows) pMdaMap.set(r.productCode, r);
  }
  const uniqueMdaKeys = [...new Set(
    [...pMdaMap.values()].map(r => r.mdaPdfFile).filter(Boolean) as string[],
  )];
  const mdaPresignMap = new Map<string, string>();
  await Promise.all(uniqueMdaKeys.map(async key => {
    const url = await presignMdaKey(key);
    if (url) mdaPresignMap.set(key, url);
  }));
  const items = rawItems.map(item => {
    const mda = item.productCode ? pMdaMap.get(item.productCode) : undefined;
    return {
      ...item,
      mdaPdfFile: mda?.mdaPdfFile ?? null,
      mdaPdfUrl:  mda?.mdaPdfFile ? (mdaPresignMap.get(mda.mdaPdfFile) ?? null) : null,
      mdaPageNo:    mda?.mdaPageNo    ?? null,
      mdaMatchX:    mda?.mdaMatchX    ?? null,
      mdaMatchY:    mda?.mdaMatchY    ?? null,
      mdaRowHeight: mda?.mdaRowHeight ?? null,
      mdaPageWidth: mda?.mdaPageWidth ?? null,
      mdaPageHeight: mda?.mdaPageHeight ?? null,
    };
  });

  // Collect unique product brands for PDF terms box
  const allProductCodes = [...new Set(rawItems.filter(i => i.productCode).map(i => i.productCode!))];
  const brandByCode = new Map<string, string>();
  if (allProductCodes.length > 0) {
    const bRows = await db
      .select({ productCode: product.productCode, brand: product.brand })
      .from(product)
      .where(and(inArray(product.organizationId, ownerOrgIds), inArray(product.productCode, allProductCodes)));
    for (const r of bRows) { if (r.brand) brandByCode.set(r.productCode, r.brand); }
  }
  const itemBrands = [...new Set(
    rawItems.map(i => i.productCode ? brandByCode.get(i.productCode) : undefined).filter(Boolean) as string[]
  )];

  // Siblings: other quotations in the same comparison group
  type Sibling = {
    id: string;
    quotationNo: string;
    organizationId: string;
    orgName: string;
    isDummy: number;
    status: string;
    grandTotal: string;
  };
  let siblings: Sibling[] = [];
  if (q.groupId) {
    siblings = await db
      .select({
        id: quotation.id,
        quotationNo: quotation.quotationNo,
        organizationId: quotation.organizationId,
        orgName: organization.name,
        isDummy: quotation.isDummy,
        status: quotation.status,
        grandTotal: quotation.grandTotal,
      })
      .from(quotation)
      .innerJoin(organization, eq(organization.id, quotation.organizationId))
      .where(eq(quotation.groupId, q.groupId))
      .orderBy(asc(quotation.isDummy));
  }

  let salesPersonPhone: string | null = null;
  if (q.salesPersonId) {
    const [spProfile] = await db
      .select({ phoneNumbers: profile.phoneNumbers })
      .from(profile)
      .where(eq(profile.userId, q.salesPersonId))
      .limit(1);
    salesPersonPhone = spProfile?.phoneNumbers?.[0] ?? null;
  }

  return {
    quotation: {
      ...q,
      customerSnapshot: mergedCustomerSnapshot,
      salesPersonName: q.salesPersonName?.toLowerCase() ?? null,
      preparedByName: q.preparedByName?.toLowerCase() ?? null,
      salesPersonPhone,
    },
    orgName: orgRow?.name ?? "",
    orgLogoUrl,
    orgBrandColor: orgRow?.brandColor ?? null,
    orgSlateTextColor: orgRow?.slateTextColor ?? null,
    orgSlateHeadingColor: orgRow?.slateHeadingColor ?? null,
    orgSlateInfoFontSize: orgRow?.slateInfoFontSize ?? null,
    orgCompanyName: orgRow?.companyName ?? null,
    orgCompanyAddress: orgRow?.companyAddress ?? null,
    orgTaxNo: orgRow?.taxNo ?? null,
    orgMofNo: orgRow?.mofNo ?? null,
    orgPhone: orgRow?.phone ?? null,
    orgEmail: orgRow?.email ?? null,
    orgWebsite: orgRow?.website ?? null,
    orgOldSsmNo: orgRow?.oldSsmNo ?? null,
    orgNewSsmNo: orgRow?.newSsmNo ?? null,
    orgMdaEstablishmentNo: orgRow?.mdaEstablishmentNo ?? null,
    orgBankingInfo: orgRow?.bankingInfo ?? [],
    orgPdfTemplate:    orgRow?.pdfTemplate    ?? "affirma",
    orgTitlePosition:  orgRow?.titlePosition  ?? "stamp",
    orgTableFontSize:  orgRow?.tableFontSize  ?? "normal",
    orgHeaderLayout:   orgRow?.headerLayout   ?? "standard",
    orgNameSize:       orgRow?.orgNameSize     ?? "medium",
    orgNameBold:       orgRow?.orgNameBold     ?? 1,
    orgNameUppercase:  orgRow?.orgNameUppercase ?? 0,
    orgInfoSide:             orgRow?.orgInfoSide             ?? "left",
    orgQuotationLabelSize:   orgRow?.quotationLabelSize      ?? "normal",
    orgQuotationLabelBold:   orgRow?.quotationLabelBold      ?? 1,
    orgQuotationLabelUppercase: orgRow?.quotationLabelUppercase ?? 1,
    orgQuotationLabelAlign:     orgRow?.quotationLabelAlign     ?? "right",
    orgTableRowStyle:        orgRow?.tableRowStyle            ?? "default",
    orgShowCodeColumn:       orgRow?.showCodeColumn           ?? 1,
    orgAttentionNameSize: orgRow?.attentionNameSize ?? "medium",
    orgAttentionNameBold: orgRow?.attentionNameBold ?? 1,
    orgDetailFontSize:    orgRow?.detailFontSize    ?? "normal",
    orgDetailFontBold:    orgRow?.detailFontBold    ?? 0,
    orgDetailAlignment:   orgRow?.detailAlignment   ?? "right",
    ...await Promise.all([
      presignCertKey(orgRow?.mofCertUrl),
      presignCertKey(orgRow?.ssmCertUrl),
      presignCertKey(orgRow?.mdaCertUrl),
      presignCertKey(orgRow?.taxCertUrl),
      presignCertKey(orgRow?.bankStatementUrl),
      presignCertKey(orgRow?.lampiran12Url),
      presignCertKey(orgRow?.lampiran13Url),
    ]).then(([orgMofCertUrl, orgSsmCertUrl, orgMdaCertUrl, orgTccCertUrl, orgBankStatementUrl, orgLampiran12Url, orgLampiran13Url]) => ({
      orgMofCertUrl,
      orgSsmCertUrl,
      orgMdaCertUrl,
      orgTccCertUrl,
      orgBankStatementUrl,
      orgLampiran12Url,
      orgLampiran13Url,
    })),
    items,
    itemBrands,
    siblings,
  };
}

// ── Get full detail for every quotation in a comparison group (batch) ────
// Used by the detail page so tab-switching is pure client-side (no navigation).
export async function getQuotationGroupAllDetails(id: string) {
  const { orgId, userId } = await requireAccess("quotation:read");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds = ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  // 1. Anchor quotation
  const [anchor] = await db
    .select()
    .from(quotation)
    .where(and(eq(quotation.id, id), inArray(quotation.organizationId, ownerOrgIds)))
    .limit(1);
  if (!anchor) return null;

  // 2. All quotations in the group (or just the one)
  const allQuotations = anchor.groupId
    ? await db
        .select()
        .from(quotation)
        .where(and(eq(quotation.groupId, anchor.groupId), inArray(quotation.organizationId, ownerOrgIds)))
        .orderBy(asc(quotation.isDummy))
    : [anchor];

  const quotationIds = allQuotations.map((q) => q.id);
  const orgIds = [...new Set(allQuotations.map((q) => q.organizationId))];

  // 3. All org profiles in one query
  const orgRows = await db
    .select({
      id: organization.id,
      name: organization.name,
      logo: organization.logo,
      logoKey: organizationProfile.logoKey,
      brandColor: organizationProfile.brandColor,
      slateTextColor: organizationProfile.slateTextColor,
      slateHeadingColor: organizationProfile.slateHeadingColor,
      slateInfoFontSize: organizationProfile.slateInfoFontSize,
      companyName: organizationProfile.companyName,
      companyAddress: organizationProfile.companyAddress,
      taxNo: organizationProfile.taxNo,
      mofNo: organizationProfile.mofNo,
      phone: organizationProfile.phone,
      email: organizationProfile.email,
      website: organizationProfile.website,
      oldSsmNo: organizationProfile.oldSsmNo,
      newSsmNo: organizationProfile.newSsmNo,
      mdaEstablishmentNo: organizationProfile.mdaEstablishmentNo,
      bankingInfo: organizationProfile.bankingInfo,
      pdfTemplate: organizationProfile.pdfTemplate,
      titlePosition: organizationProfile.titlePosition,
      tableFontSize: organizationProfile.tableFontSize,
      headerLayout: organizationProfile.headerLayout,
      orgNameSize: organizationProfile.orgNameSize,
      orgNameBold: organizationProfile.orgNameBold,
      orgNameUppercase: organizationProfile.orgNameUppercase,
      orgInfoSide: organizationProfile.orgInfoSide,
      quotationLabelSize: organizationProfile.quotationLabelSize,
      quotationLabelBold: organizationProfile.quotationLabelBold,
      quotationLabelUppercase: organizationProfile.quotationLabelUppercase,
      quotationLabelAlign: organizationProfile.quotationLabelAlign,
      tableRowStyle: organizationProfile.tableRowStyle,
      showCodeColumn: organizationProfile.showCodeColumn,
      attentionNameSize: organizationProfile.attentionNameSize,
      attentionNameBold: organizationProfile.attentionNameBold,
      detailFontSize: organizationProfile.detailFontSize,
      detailFontBold: organizationProfile.detailFontBold,
      detailAlignment: organizationProfile.detailAlignment,
    })
    .from(organization)
    .leftJoin(organizationProfile, eq(organizationProfile.organizationId, organization.id))
    .where(inArray(organization.id, orgIds));

  // 4. All items in one query
  const allItems = await db
    .select()
    .from(quotationItem)
    .where(inArray(quotationItem.quotationId, quotationIds))
    .orderBy(asc(quotationItem.sortOrder));

  // 5. Customer data (shared across group)
  const customerId = anchor.customerId;
  let customerData: Record<string, string | null> | null = null;
  if (customerId) {
    const [cust] = await db
      .select({
        title: customer.title,
        name: customer.name,
        position: customer.position,
        department: customer.department,
        email: customer.email,
        contactNo: customer.contactNo,
        organizationName: customer.organizationName,
        organizationAddress: customer.organizationAddress,
      })
      .from(customer)
      .where(eq(customer.id, customerId))
      .limit(1);
    if (cust) customerData = cust as Record<string, string | null>;
  }

  // 5b. Creator names for all quotations in the group
  const creatorIds = [...new Set(allQuotations.map((q) => q.createdBy).filter(Boolean) as string[])];
  const creatorRows = creatorIds.length
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, creatorIds))
    : [];
  const creatorMap = new Map(creatorRows.map((u) => [u.id, u.name]));

  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const orgMap = new Map(orgRows.map((o) => [o.id, o]));

  // 6. Build siblings summary (shared)
  const siblings = allQuotations.map((q) => ({
    id: q.id,
    quotationNo: q.quotationNo,
    organizationId: q.organizationId,
    orgName: orgMap.get(q.organizationId)?.name ?? "",
    isDummy: q.isDummy,
    status: q.status,
    grandTotal: q.grandTotal,
  }));

  // 7. Assemble one detail object per quotation
  return allQuotations.map((q) => {
    const orgRow = orgMap.get(q.organizationId);
    const orgLogoUrl = orgRow?.logoKey ? `${r2Public}/${orgRow.logoKey}` : (orgRow?.logo ?? null);
    const snapshot = q.customerSnapshot as Record<string, string> | null;
    const mergedCustomerSnapshot = customerData
      ? {
          title: customerData.title ?? snapshot?.title,
          name: customerData.name ?? snapshot?.name ?? "",
          email: customerData.email ?? snapshot?.email,
          contactNo: customerData.contactNo ?? snapshot?.contactNo,
          organizationName: snapshot?.organizationName ?? customerData.organizationName,
          organizationAddress: snapshot?.organizationAddress ?? customerData.organizationAddress,
          position: snapshot?.position ?? customerData.position,
          department: snapshot?.department ?? customerData.department,
        }
      : snapshot;

    return {
      quotation: {
        ...q,
        customerSnapshot: mergedCustomerSnapshot,
        salesPersonName: q.salesPersonName?.toLowerCase() ?? null,
        preparedByName: q.preparedByName?.toLowerCase() ?? null,
      },
      orgName: orgRow?.name ?? "",
      orgLogoUrl,
      orgBrandColor: orgRow?.brandColor ?? null,
      orgSlateTextColor: orgRow?.slateTextColor ?? null,
      orgSlateHeadingColor: orgRow?.slateHeadingColor ?? null,
      orgCompanyName: orgRow?.companyName ?? null,
      orgCompanyAddress: orgRow?.companyAddress ?? null,
      orgTaxNo: orgRow?.taxNo ?? null,
      orgMofNo: orgRow?.mofNo ?? null,
      orgPhone: orgRow?.phone ?? null,
      orgEmail: orgRow?.email ?? null,
      orgWebsite: orgRow?.website ?? null,
      orgOldSsmNo: orgRow?.oldSsmNo ?? null,
      orgNewSsmNo: orgRow?.newSsmNo ?? null,
      orgMdaEstablishmentNo: orgRow?.mdaEstablishmentNo ?? null,
      orgBankingInfo: orgRow?.bankingInfo ?? [],
      orgPdfTemplate: orgRow?.pdfTemplate ?? "affirma",
      orgTitlePosition: orgRow?.titlePosition ?? "stamp",
      orgTableFontSize: orgRow?.tableFontSize ?? "normal",
      orgHeaderLayout: orgRow?.headerLayout ?? "standard",
      orgNameSize: orgRow?.orgNameSize ?? "medium",
      orgNameBold: orgRow?.orgNameBold ?? 1,
      orgNameUppercase: orgRow?.orgNameUppercase ?? 0,
      orgInfoSide: orgRow?.orgInfoSide ?? "left",
      orgQuotationLabelSize: orgRow?.quotationLabelSize ?? "normal",
      orgQuotationLabelBold: orgRow?.quotationLabelBold ?? 1,
      orgQuotationLabelUppercase: orgRow?.quotationLabelUppercase ?? 1,
    orgQuotationLabelAlign:     orgRow?.quotationLabelAlign     ?? "right",
      orgTableRowStyle: orgRow?.tableRowStyle ?? "default",
      orgShowCodeColumn: orgRow?.showCodeColumn ?? 1,
      orgAttentionNameSize: orgRow?.attentionNameSize ?? "medium",
      orgAttentionNameBold: orgRow?.attentionNameBold ?? 1,
      orgDetailFontSize: orgRow?.detailFontSize ?? "normal",
      orgDetailFontBold: orgRow?.detailFontBold ?? 0,
      orgDetailAlignment: orgRow?.detailAlignment ?? "right",
      orgMofCertUrl: null,
      orgSsmCertUrl: null,
      orgMdaCertUrl: null,
      orgTccCertUrl: null,
      orgBankStatementUrl: null,
      orgLampiran12Url: null,
      orgLampiran13Url: null,
      items: allItems.filter((item) => item.quotationId === q.id),
      siblings,
      createdByName: q.createdBy ? (creatorMap.get(q.createdBy)?.toLowerCase() ?? null) : null,
    };
  });
}

// ── Get all quotations in a group for print (single batch) ────────────────
export async function getQuotationGroupForPrint(id: string) {
  const { orgId, userId } = await requireAccess("quotation:read");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds =
    ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  const [mainQ] = await db
    .select()
    .from(quotation)
    .where(
      and(eq(quotation.id, id), inArray(quotation.organizationId, ownerOrgIds)),
    )
    .limit(1);
  if (!mainQ) return null;

  const allQuotations = mainQ.groupId
    ? await db
        .select()
        .from(quotation)
        .where(eq(quotation.groupId, mainQ.groupId))
        .orderBy(asc(quotation.isDummy), asc(quotation.createdAt))
    : [mainQ];

  const qIds = allQuotations.map((q) => q.id);
  const rawAllItems = await db
    .select()
    .from(quotationItem)
    .where(inArray(quotationItem.quotationId, qIds))
    .orderBy(asc(quotationItem.sortOrder));

  // Enrich allItems with product MDA PDF fields
  const groupCertCodes = [...new Set(
    rawAllItems.filter(i => i.hasCert && i.productCode).map(i => i.productCode!),
  )];
  const groupAllOrgIds = [...new Set(allQuotations.map(q => q.organizationId))];
  const grpPMdaMap = new Map<string, {
    mdaPdfFile: string | null; mdaPageNo: string | null;
    mdaMatchX: string | null; mdaMatchY: string | null;
    mdaRowHeight: string | null; mdaPageWidth: string | null; mdaPageHeight: string | null;
  }>();
  if (groupCertCodes.length > 0) {
    const pRows = await db.select({
      productCode: product.productCode,
      mdaPdfFile: product.mdaPdfFile,
      mdaPageNo: product.mdaPageNo,
      mdaMatchX: product.mdaMatchX,
      mdaMatchY: product.mdaMatchY,
      mdaRowHeight: product.mdaRowHeight,
      mdaPageWidth: product.mdaPageWidth,
      mdaPageHeight: product.mdaPageHeight,
    }).from(product).where(and(
      inArray(product.organizationId, ownerOrgIds),
      inArray(product.productCode, groupCertCodes),
    ));
    for (const r of pRows) grpPMdaMap.set(r.productCode, r);
  }
  const grpUniqueMdaKeys = [...new Set(
    [...grpPMdaMap.values()].map(r => r.mdaPdfFile).filter(Boolean) as string[],
  )];
  const grpMdaPresignMap = new Map<string, string>();
  await Promise.all(grpUniqueMdaKeys.map(async key => {
    const url = await presignMdaKey(key);
    if (url) grpMdaPresignMap.set(key, url);
  }));
  const allItems = rawAllItems.map(item => {
    const mda = item.productCode ? grpPMdaMap.get(item.productCode) : undefined;
    return {
      ...item,
      mdaPdfFile: mda?.mdaPdfFile ?? null,
      mdaPdfUrl:  mda?.mdaPdfFile ? (grpMdaPresignMap.get(mda.mdaPdfFile) ?? null) : null,
      mdaPageNo:    mda?.mdaPageNo    ?? null,
      mdaMatchX:    mda?.mdaMatchX    ?? null,
      mdaMatchY:    mda?.mdaMatchY    ?? null,
      mdaRowHeight: mda?.mdaRowHeight ?? null,
      mdaPageWidth: mda?.mdaPageWidth ?? null,
      mdaPageHeight: mda?.mdaPageHeight ?? null,
    };
  });

  const allOrgIds = groupAllOrgIds;
  const orgProfiles = await db
    .select({
      organizationId: organization.id,
      name: organization.name,
      logo: organization.logo,
      logoKey: organizationProfile.logoKey,
      brandColor: organizationProfile.brandColor,
      slateTextColor: organizationProfile.slateTextColor,
      slateHeadingColor: organizationProfile.slateHeadingColor,
      slateInfoFontSize: organizationProfile.slateInfoFontSize,
      companyName: organizationProfile.companyName,
      companyAddress: organizationProfile.companyAddress,
      taxNo: organizationProfile.taxNo,
      mofNo: organizationProfile.mofNo,
      phone: organizationProfile.phone,
      email: organizationProfile.email,
      website: organizationProfile.website,
      oldSsmNo: organizationProfile.oldSsmNo,
      newSsmNo: organizationProfile.newSsmNo,
      mdaEstablishmentNo: organizationProfile.mdaEstablishmentNo,
      bankingInfo: organizationProfile.bankingInfo,
      mofCertUrl: organizationProfile.mofCertUrl,
      ssmCertUrl: organizationProfile.ssmCertUrl,
      mdaCertUrl: organizationProfile.mdaCertUrl,
      taxCertUrl: organizationProfile.taxCertUrl,
      bankStatementUrl: organizationProfile.bankStatementUrl,
      lampiran12Url: organizationProfile.lampiran12Url,
      lampiran13Url: organizationProfile.lampiran13Url,
      pdfTemplate: organizationProfile.pdfTemplate,
      titlePosition:    organizationProfile.titlePosition,
      tableFontSize:    organizationProfile.tableFontSize,
      headerLayout:     organizationProfile.headerLayout,
      orgNameSize:      organizationProfile.orgNameSize,
      orgNameBold:      organizationProfile.orgNameBold,
      orgNameUppercase: organizationProfile.orgNameUppercase,
      orgInfoSide:             organizationProfile.orgInfoSide,
      quotationLabelSize:      organizationProfile.quotationLabelSize,
      quotationLabelBold:      organizationProfile.quotationLabelBold,
      quotationLabelUppercase: organizationProfile.quotationLabelUppercase,
      quotationLabelAlign:     organizationProfile.quotationLabelAlign,
      tableRowStyle:           organizationProfile.tableRowStyle,
      showCodeColumn:          organizationProfile.showCodeColumn,
      attentionNameSize: organizationProfile.attentionNameSize,
      attentionNameBold: organizationProfile.attentionNameBold,
      detailFontSize:    organizationProfile.detailFontSize,
      detailFontBold:    organizationProfile.detailFontBold,
      detailAlignment:   organizationProfile.detailAlignment,
    })
    .from(organization)
    .leftJoin(
      organizationProfile,
      eq(organizationProfile.organizationId, organization.id),
    )
    .where(inArray(organization.id, allOrgIds));

  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const orgMap = new Map(orgProfiles.map((o) => [o.organizationId, o]));

  return Promise.all(allQuotations.map(async (q) => {
    const org = orgMap.get(q.organizationId);
    const items = allItems.filter((item) => item.quotationId === q.id);
    const [
      orgMofCertUrl, orgSsmCertUrl, orgMdaCertUrl, orgTccCertUrl,
      orgBankStatementUrl, orgLampiran12Url, orgLampiran13Url,
    ] = await Promise.all([
      presignCertKey(org?.mofCertUrl),
      presignCertKey(org?.ssmCertUrl),
      presignCertKey(org?.mdaCertUrl),
      presignCertKey(org?.taxCertUrl),
      presignCertKey(org?.bankStatementUrl),
      presignCertKey(org?.lampiran12Url),
      presignCertKey(org?.lampiran13Url),
    ]);

    return {
      quotation: q,
      items,
      orgName: org?.name ?? "",
      orgLogoUrl: org?.logoKey ? `${r2Public}/${org.logoKey}` : (org?.logo ?? null),
      orgBrandColor: org?.brandColor ?? null,
      orgSlateTextColor: org?.slateTextColor ?? null,
      orgSlateHeadingColor: org?.slateHeadingColor ?? null,
      orgSlateInfoFontSize: org?.slateInfoFontSize ?? null,
      orgCompanyName: org?.companyName ?? null,
      orgCompanyAddress: org?.companyAddress ?? null,
      orgTaxNo: org?.taxNo ?? null,
      orgMofNo: org?.mofNo ?? null,
      orgPhone: org?.phone ?? null,
      orgEmail: org?.email ?? null,
      orgWebsite: org?.website ?? null,
      orgOldSsmNo: org?.oldSsmNo ?? null,
      orgNewSsmNo: org?.newSsmNo ?? null,
      orgMdaEstablishmentNo: org?.mdaEstablishmentNo ?? null,
      orgBankingInfo: (org?.bankingInfo ?? []) as any[],
      orgPdfTemplate:    org?.pdfTemplate    ?? "affirma",
      orgTitlePosition:  org?.titlePosition  ?? "stamp",
      orgTableFontSize:  org?.tableFontSize  ?? "normal",
      orgHeaderLayout:   org?.headerLayout   ?? "standard",
      orgNameSize:       org?.orgNameSize    ?? "medium",
      orgNameBold:       org?.orgNameBold    ?? 1,
      orgNameUppercase:  org?.orgNameUppercase ?? 0,
      orgInfoSide:             org?.orgInfoSide             ?? "left",
      orgQuotationLabelSize:   org?.quotationLabelSize      ?? "normal",
      orgQuotationLabelBold:   org?.quotationLabelBold      ?? 1,
      orgQuotationLabelUppercase: org?.quotationLabelUppercase ?? 1,
      orgQuotationLabelAlign:     org?.quotationLabelAlign     ?? "right",
      orgTableRowStyle:        org?.tableRowStyle            ?? "default",
      orgShowCodeColumn:       org?.showCodeColumn           ?? 1,
      orgAttentionNameSize: org?.attentionNameSize ?? "medium",
      orgAttentionNameBold: org?.attentionNameBold ?? 1,
      orgDetailFontSize:    org?.detailFontSize    ?? "normal",
      orgDetailFontBold:    org?.detailFontBold    ?? 0,
      orgDetailAlignment:   org?.detailAlignment   ?? "right",
      orgMofCertUrl,
      orgSsmCertUrl,
      orgMdaCertUrl,
      orgTccCertUrl,
      orgBankStatementUrl,
      orgLampiran12Url,
      orgLampiran13Url,
    };
  }));
}

// ── Finalize quotation (draft → final) ────────────────────────────────────
// markups: { [quotationId]: markupPct } — applied to unit prices of dummy quotations
export async function finalizeQuotation(id: string) {
  const { orgId, userId } = await requireAccess("quotation:update");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds =
    ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  const [q] = await db
    .select({ status: quotation.status, groupId: quotation.groupId })
    .from(quotation)
    .where(
      and(eq(quotation.id, id), inArray(quotation.organizationId, ownerOrgIds)),
    )
    .limit(1);

  if (!q) throw new Error("Quotation not found");
  if (q.status !== "draft") throw new Error("Already finalized");

  // Assign real sequential quotation numbers to drafts that still hold placeholder IDs.
  // Revisions already have proper numbers (e.g. BMS-QT-2026-0003-R1), so skip those.
  const toFinalize = await db
    .select({ id: quotation.id, organizationId: quotation.organizationId, quotationNo: quotation.quotationNo })
    .from(quotation)
    .where(q.groupId ? eq(quotation.groupId, q.groupId) : eq(quotation.id, id))
    .orderBy(asc(quotation.isDummy));

  for (const qItem of toFinalize) {
    if (qItem.quotationNo.startsWith("PENDING-")) {
      const newNo = await generateQuotationNo(qItem.organizationId);
      await db.update(quotation).set({ quotationNo: newNo }).where(eq(quotation.id, qItem.id));
    }
  }

  if (q.groupId) {
    await db
      .update(quotation)
      .set({ status: "final" })
      .where(eq(quotation.groupId, q.groupId));
  } else {
    await db
      .update(quotation)
      .set({ status: "final" })
      .where(eq(quotation.id, id));
  }
}

// ── Update (edit) draft quotation ─────────────────────────────────────────
export type UpdateQuotationInput = {
  title?: string;
  sets?: number;
  customerId?: string | null;
  customerOrgMemberId?: string | null;
  salesPersonId?: string | null;
  salesPersonName?: string | null;
  associateSalesPersons?: { id: string; name: string }[] | null;
  validDays?: number;
  notes?: string | null;
  deliveryTerm?: string | null;
  paymentTerm?: string | null;
  returnPolicy?: string | null;
  warranty?: string | null;
  overallDiscountPct: string;
  overallDiscountAmt?: string;
  sstPct: string;
  includeCatalogue: boolean;
  includeMdaCerts: boolean;
  showTotalPrice: boolean;
  showItemizeDiscount: boolean;
  showProductCode: boolean;
  inclMof: boolean;
  inclSsm: boolean;
  inclTcc: boolean;
  inclBankStatement: boolean;
  inclMdaEstablishment: boolean;
  inclLampiran12: boolean;
  inclLampiran13: boolean;
  categoryIds?: string[];
  items: {
    rowNo: string;
    sku?: string | null;
    productCode?: string | null;
    description?: string | null;
    qty: string;
    uom?: string | null;
    unitPrice: string;
    discountPct: string;
    productId?: string | null;
    productName?: string | null;
    imageKey?: string | null;
    mdaRegNo?: string | null;
    mdaValidity?: string | null;
    hasCert?: boolean;
    hasPrice?: boolean;
    descriptionSource?: "db" | "sheet" | "user";
    priceSource?: "db" | "sheet" | "user";
    uomSource?: "db" | "sheet";
    discountSource?: "user" | null;
    setQtySource?: "user" | null;
    lineType?: "sell" | "rent";
    rentalDuration?: string | null;
    rentalUnit?: string | null;
    setGroupId?: string | null;
    setGroupLabel?: string | null;
    setQty?: string | null;
  }[];
};

export async function updateQuotation(id: string, input: UpdateQuotationInput) {
  const { orgId, userId } = await requireAccess("quotation:update");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds =
    ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  const [q] = await db
    .select({ status: quotation.status, createdAt: quotation.createdAt, sets: quotation.sets, groupId: quotation.groupId, isDummy: quotation.isDummy })
    .from(quotation)
    .where(
      and(eq(quotation.id, id), inArray(quotation.organizationId, ownerOrgIds)),
    )
    .limit(1);

  if (!q) throw new Error("Quotation not found");
  if (q.status !== "draft") throw new Error("Cannot edit a finalized quotation");

  // Snapshot customer using the shared helper
  const customerSnapshot = input.customerId
    ? await buildCustomerSnapshot(input.customerId, input.customerOrgMemberId)
    : null;

  // Recalculate totals — set items use setQty multiplier; global sets multiplies all
  const setsCount = Math.max(1, input.sets ?? Number(q.sets ?? 1));
  const perSetSubtotal = input.items.reduce((s, item) => s + calcItemTotal({
    qty: item.qty,
    unitPrice: item.unitPrice,
    discountPct: item.discountPct,
    lineType: item.lineType,
    rentalDuration: item.rentalDuration ?? undefined,
    setGroupId: item.setGroupId ?? undefined,
    setQty: item.setQty ?? undefined,
  }), 0);
  const subtotal = perSetSubtotal * setsCount;

  const overallDiscPct = Number(input.overallDiscountPct ?? 0);
  const overallDiscAmt = overallDiscPct > 0
    ? subtotal * (overallDiscPct / 100)
    : Number(input.overallDiscountAmt ?? 0);
  const afterDiscount = subtotal - overallDiscAmt;
  const sstAmt = afterDiscount * (Number(input.sstPct ?? 0) / 100);
  const grandTotal = afterDiscount + sstAmt;

  const baseDate = q.createdAt ? new Date(q.createdAt) : new Date();
  const validUntil = new Date(baseDate);
  validUntil.setDate(validUntil.getDate() + (input.validDays ?? 30));

  await db
    .update(quotation)
    .set({
      title: input.title ?? "Loose Items",
      sets: setsCount,
      customerId: input.customerId ?? null,
      customerSnapshot,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName?.toLowerCase() ?? null,
      associateSalesPersons: input.associateSalesPersons ?? null,
      validUntil,
      notes: input.notes ?? null,
      deliveryTerm: input.deliveryTerm ?? null,
      paymentTerm: input.paymentTerm ?? null,
      returnPolicy: input.returnPolicy ?? null,
      warranty: input.warranty ?? null,
      subtotal: subtotal.toFixed(2),
      overallDiscountPct: input.overallDiscountPct,
      overallDiscountAmt: overallDiscAmt.toFixed(2),
      sst: sstAmt.toFixed(2),
      sstPct: input.sstPct,
      grandTotal: grandTotal.toFixed(2),
      includeCatalogue: input.includeCatalogue ? 1 : 0,
      includeMdaCerts: input.includeMdaCerts ? 1 : 0,
      showUnitPrice: 1,
      showTotalPrice: input.showTotalPrice ? 1 : 0,
      showItemizeDiscount: input.showItemizeDiscount ? 1 : 0,
      showProductCode: input.showProductCode ? 1 : 0,
      inclMof: input.inclMof ? 1 : 0,
      inclSsm: input.inclSsm ? 1 : 0,
      inclTcc: input.inclTcc ? 1 : 0,
      inclBankStatement: input.inclBankStatement ? 1 : 0,
      inclMdaEstablishment: input.inclMdaEstablishment ? 1 : 0,
      inclLampiran12: input.inclLampiran12 ? 1 : 0,
      inclLampiran13: input.inclLampiran13 ? 1 : 0,
      categoryIds: input.categoryIds ?? [],
    })
    .where(eq(quotation.id, id));

  // Replace items wholesale
  await db.delete(quotationItem).where(eq(quotationItem.quotationId, id));

  if (input.items.length > 0) {
    await db.insert(quotationItem).values(
      input.items.map((item, i) => {
        const qty = Number(item.qty ?? 1);
        const price = Number(item.unitPrice ?? 0);
        const disc = Number(item.discountPct ?? 0) / 100;
        const total = calcItemTotal({
          qty: item.qty,
          unitPrice: item.unitPrice,
          discountPct: item.discountPct,
          lineType: item.lineType,
          rentalDuration: item.rentalDuration ?? undefined,
          setGroupId: item.setGroupId ?? undefined,
          setQty: item.setQty ?? undefined,
        });
        return {
          id: nanoid(),
          quotationId: id,
          sortOrder: i,
          rowNo: item.rowNo,
          sku: item.sku ?? null,
          productCode: item.productCode ?? null,
          description: item.description ?? null,
          qty: String(item.qty),
          uom: item.uom ?? null,
          unitPrice: item.unitPrice ?? "0",
          discountPct: item.discountPct ?? "0",
          discountAmt: (qty * price * disc).toFixed(2),
          totalPrice: total.toFixed(2),
          productId: item.productId ?? null,
          productName: item.productName ?? null,
          imageKey: item.imageKey ?? null,
          mdaRegNo: item.mdaRegNo ?? null,
          mdaValidity: item.mdaValidity ?? null,
          hasCert: item.hasCert ? 1 : 0,
          hasPrice: item.hasPrice ? 1 : 0,
          descriptionSource: item.descriptionSource ?? "sheet",
          priceSource: item.priceSource ?? "sheet",
          uomSource: item.uomSource ?? "sheet",
          discountSource: item.discountSource ?? null,
          setQtySource: item.setQtySource ?? null,
          lineType: item.lineType ?? "sell",
          rentalDuration: item.rentalDuration ?? null,
          rentalUnit: item.rentalUnit ?? null,
          setGroupId: item.setGroupId ?? null,
          setGroupLabel: item.setGroupLabel ?? null,
          setQty: item.setQty ?? null,
        };
      }),
    );
  }

  // Propagate customer + items to all other quotations in the same comparison group
  if (q.groupId) {
    await db
      .update(quotation)
      .set({ customerId: input.customerId ?? null, customerSnapshot })
      .where(and(eq(quotation.groupId, q.groupId), not(eq(quotation.id, id))));

    // Sync item structure (qty, description, set groups, etc.) to each dummy while
    // preserving the dummy's own unit prices.
    const siblings = await db
      .select({ id: quotation.id, sets: quotation.sets, overallDiscountPct: quotation.overallDiscountPct, overallDiscountAmt: quotation.overallDiscountAmt, sstPct: quotation.sstPct })
      .from(quotation)
      .where(and(eq(quotation.groupId, q.groupId), not(eq(quotation.id, id))));

    for (const sibling of siblings) {
      // Load sibling's existing items to preserve prices (keyed by sortOrder)
      const siblingItems = await db
        .select({ sortOrder: quotationItem.sortOrder, unitPrice: quotationItem.unitPrice, discountPct: quotationItem.discountPct })
        .from(quotationItem)
        .where(eq(quotationItem.quotationId, sibling.id));

      const priceMap = new Map(siblingItems.map((i) => [i.sortOrder, { unitPrice: i.unitPrice, discountPct: i.discountPct }]));

      await db.delete(quotationItem).where(eq(quotationItem.quotationId, sibling.id));

      if (input.items.length > 0) {
        const newSiblingItems = input.items.map((item, i) => {
          const preserved = priceMap.get(i);
          const unitPrice = preserved?.unitPrice ?? "0";
          const discountPct = preserved?.discountPct ?? item.discountPct ?? "0";
          const qty = Number(item.qty ?? 1);
          const price = Number(unitPrice);
          const disc = Number(discountPct) / 100;
          const total = calcItemTotal({
            qty: item.qty,
            unitPrice,
            discountPct,
            lineType: item.lineType,
            rentalDuration: item.rentalDuration ?? undefined,
            setGroupId: item.setGroupId ?? undefined,
            setQty: item.setQty ?? undefined,
          });
          return {
            id: nanoid(),
            quotationId: sibling.id,
            sortOrder: i,
            rowNo: item.rowNo,
            sku: item.sku ?? null,
            productCode: item.productCode ?? null,
            description: item.description ?? null,
            qty: String(item.qty),
            uom: item.uom ?? null,
            unitPrice,
            discountPct,
            discountAmt: (qty * price * disc).toFixed(2),
            totalPrice: total.toFixed(2),
            productId: item.productId ?? null,
            productName: item.productName ?? null,
            imageKey: item.imageKey ?? null,
            mdaRegNo: item.mdaRegNo ?? null,
            mdaValidity: item.mdaValidity ?? null,
            hasCert: item.hasCert ? 1 : 0,
            hasPrice: item.hasPrice ? 1 : 0,
            descriptionSource: item.descriptionSource ?? "sheet",
            priceSource: item.priceSource ?? "sheet",
            uomSource: item.uomSource ?? "sheet",
            discountSource: item.discountSource ?? null,
            setQtySource: item.setQtySource ?? null,
            lineType: item.lineType ?? "sell",
            rentalDuration: item.rentalDuration ?? null,
            rentalUnit: item.rentalUnit ?? null,
            setGroupId: item.setGroupId ?? null,
            setGroupLabel: item.setGroupLabel ?? null,
            setQty: item.setQty ?? null,
          };
        });
        await db.insert(quotationItem).values(newSiblingItems);

        // Recalculate sibling totals using its own prices + anchor's qty/structure
        const sibSetsCount = setsCount; // inherit sets count from anchor
        const sibPerSetSubtotal = newSiblingItems.reduce((s, it) => s + calcItemTotal({
          qty: it.qty,
          unitPrice: it.unitPrice,
          discountPct: it.discountPct,
          lineType: (it.lineType ?? "sell") as "sell" | "rent",
          rentalDuration: it.rentalDuration ?? undefined,
          setGroupId: it.setGroupId ?? undefined,
          setQty: it.setQty ?? undefined,
        }), 0);
        const sibSubtotal = sibPerSetSubtotal * sibSetsCount;
        const sibOverallDiscPct = Number(sibling.overallDiscountPct ?? 0);
        const sibOverallDiscAmt = sibOverallDiscPct > 0
          ? sibSubtotal * (sibOverallDiscPct / 100)
          : Number(sibling.overallDiscountAmt ?? 0);
        const sibAfterDiscount = sibSubtotal - sibOverallDiscAmt;
        const sibSstAmt = sibAfterDiscount * (Number(sibling.sstPct ?? 0) / 100);
        const sibGrandTotal = sibAfterDiscount + sibSstAmt;

        await db.update(quotation).set({
          title: input.title ?? "Loose Items",
          sets: setsCount,
          subtotal: sibSubtotal.toFixed(2),
          overallDiscountAmt: sibOverallDiscAmt.toFixed(2),
          sst: sibSstAmt.toFixed(2),
          grandTotal: sibGrandTotal.toFixed(2),
        }).where(eq(quotation.id, sibling.id));
      }
    }
  }
}

// ── Delete quotation ───────────────────────────────────────────────────────
// ── Government bulk quotation creation ───────────────────────────────────────

export type GovRawItem = {
  rowNo: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  unitPrice?: string;
};

export type GovFileInput = {
  title: string;
  items: GovRawItem[];
  customerId: string;
  validityDays: number;
  originalOrgId: string;
  includeMdaCerts: boolean;
  inclMof: boolean;
  inclSsm: boolean;
  inclTcc: boolean;
  inclBankStatement: boolean;
  inclMdaEstablishment: boolean;
  inclLampiran12: boolean;
  inclLampiran13: boolean;
  markups?: number[]; // ascending markup % per dummy org (index 0 = dummy1, 1 = dummy2, …)
};

export type GovQuotationEntry = {
  id: string;
  orgId: string;
  orgName: string;
  isDummy: boolean;
  dummyIndex: number;
};

export type GovGroupResult = {
  title: string;
  groupId: string;
  govBatchId: string;
  customerOrgName: string;
  originalId: string;
  quotations: GovQuotationEntry[];
};

function genMarkups(dummyCount: number): number[] {
  const out: number[] = [];
  let min = 5;
  for (let i = 0; i < dummyCount; i++) {
    const max = Math.min(min + 15, 50);
    const pct = Math.floor(Math.random() * (max - min + 1)) + min;
    out.push(pct);
    min = pct + 3;
  }
  return out;
}

function buildGovItem(
  raw: GovRawItem,
  productMap: Map<string, typeof product.$inferSelect>,
): ReviewItem {
  const dbProduct = raw.productCode ? productMap.get(raw.productCode) : undefined;

  const description = raw.description?.trim() || dbProduct?.description || "";
  const qty = raw.qty?.trim() || "1";
  const uom = raw.uom?.trim() || dbProduct?.uom || "";
  const unitPrice = raw.unitPrice?.trim() || dbProduct?.sellingUnitPrice || "0";

  const hasCert = !!(dbProduct?.mdaPdfFile);
  const hasPrice = !!(unitPrice && Number(unitPrice) > 0);
  const qtyN = Number(qty) || 1;
  const priceN = Number(unitPrice) || 0;
  const total = (qtyN * priceN).toFixed(2);

  let status: ReviewItem["status"];
  if (!dbProduct) status = "not_found";
  else if (!hasPrice && !hasCert) status = "no_price_no_cert";
  else if (!hasPrice) status = "no_price";
  else if (!hasCert) status = "no_cert";
  else status = "ok";

  return {
    rowNo: raw.rowNo,
    productCode: raw.productCode,
    description,
    qty,
    uom,
    unitPrice,
    hasCert,
    hasPrice,
    descriptionSource: raw.description?.trim() ? "sheet" : "db",
    priceSource: raw.unitPrice?.trim() ? "sheet" : "db",
    uomSource: raw.uom?.trim() ? "sheet" : "db",
    discountPct: "0",
    discountAmt: "0",
    computedTotal: total,
    status,
    productId: dbProduct?.id,
    productName: dbProduct?.description ?? undefined,
    imageKey: dbProduct?.imageKey ?? undefined,
    mdaRegNo: dbProduct?.mdaRegistrationNo ?? undefined,
    mdaValidity: dbProduct?.mdaExpiredOn ?? undefined,
  };
}

export async function createGovernmentBatch(
  files: GovFileInput[],
): Promise<GovGroupResult[]> {
  const { orgId, userId } = await requireAccess("quotation:create");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const orgs =
    ownerOrgs.length > 0 ? ownerOrgs : [{ id: orgId, name: orgId, slug: "" }];
  const ownerOrgIds = orgs.map((o) => o.id);

  const [me] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  // Batch-lookup all unique product codes across all files
  const allCodes = [
    ...new Set(
      files.flatMap((f) =>
        f.items.map((i) => i.productCode).filter((c): c is string => !!c),
      ),
    ),
  ];
  const dbProductRows =
    allCodes.length > 0
      ? await db
          .select()
          .from(product)
          .where(
            and(
              inArray(product.organizationId, ownerOrgIds),
              inArray(product.productCode, allCodes),
            ),
          )
      : [];

  const productMap = new Map<string, typeof dbProductRows[0]>();
  for (const p of dbProductRows) {
    if (!productMap.has(p.productCode)) productMap.set(p.productCode, p);
  }

  // Batch-lookup customers with full M2M org data (address lives in customerOrganization)
  const customerIds = [...new Set(files.map((f) => f.customerId).filter(Boolean))];
  const customerRows =
    customerIds.length > 0
      ? await db.select().from(customer).where(inArray(customer.id, customerIds))
      : [];
  const customerMap = new Map(customerRows.map((c) => [c.id, c]));

  // Build snapshots that include org address from M2M tables
  const snapshotMap = new Map<string, Awaited<ReturnType<typeof buildCustomerSnapshot>>>();
  for (const cid of customerIds) {
    snapshotMap.set(cid, await buildCustomerSnapshot(cid));
  }

  const govBatchId = nanoid(); // single ID shared by all quotations in this batch call
  const results: GovGroupResult[] = [];

  for (const file of files) {
    const reviewItems = file.items.map((raw) => buildGovItem(raw, productMap));

    const subtotal = reviewItems.reduce((s, item) => {
      return s + (Number(item.qty) || 1) * (Number(item.unitPrice) || 0);
    }, 0);

    const cust = customerMap.get(file.customerId);
    const customerSnapshot = snapshotMap.get(file.customerId) ?? null;

    const sharedValues = {
      mode: "comparison" as const,
      customerId: file.customerId,
      customerSnapshot,
      salesPersonId: null,
      salesPersonName: null,
      preparedById: userId,
      preparedByName: me?.name?.toLowerCase() ?? "",
      notes: null,
      subtotal: subtotal.toFixed(2),
      overallDiscountPct: "0",
      overallDiscountAmt: "0",
      sst: "0",
      sstPct: "0",
      grandTotal: subtotal.toFixed(2),
      title: file.title,
      includeCatalogue: 0,
      includeMdaCerts: file.includeMdaCerts ? 1 : 0,
      showUnitPrice: 1,
      showTotalPrice: 1,
      showItemizeDiscount: 0,
      showProductCode: 1,
      inclMof: file.inclMof ? 1 : 0,
      inclSsm: file.inclSsm ? 1 : 0,
      inclTcc: file.inclTcc ? 1 : 0,
      inclBankStatement: file.inclBankStatement ? 1 : 0,
      inclMdaEstablishment: file.inclMdaEstablishment ? 1 : 0,
      inclLampiran12: file.inclLampiran12 ? 1 : 0,
      inclLampiran13: file.inclLampiran13 ? 1 : 0,
      status: "draft" as const,
      createdBy: userId,
    };

    const groupId = nanoid();
    const originalDate = new Date();
    const validDaysNum = file.validityDays || 30;

    // Original org first, then dummies in creation order
    const orderedOrgs = [
      ...orgs.filter((o) => o.id === file.originalOrgId),
      ...orgs.filter((o) => o.id !== file.originalOrgId),
    ];
    // Fall back: if originalOrgId not in orgs, treat first org as original
    if (orderedOrgs[0]?.id !== file.originalOrgId) {
      // no match — keep creation order, first = original
    }

    const dummyOrgs = orderedOrgs.filter(o => o.id !== file.originalOrgId);
    const markups = (file.markups && file.markups.length === dummyOrgs.length)
      ? file.markups
      : genMarkups(dummyOrgs.length);

    const quotationResults: GovQuotationEntry[] = [];
    let dummyIndex = 1;

    for (const org of orderedOrgs) {
      const isOriginal = org.id === file.originalOrgId;
      const isDummy = !isOriginal;
      const dummyDate = isDummy ? randomWeekdaysBack(new Date(), 1, 14) : undefined;
      const qDate = dummyDate ?? originalDate;
      const validUntil = new Date(qDate);
      validUntil.setDate(validUntil.getDate() + validDaysNum);

      // Apply ascending markup for dummy orgs so dummy prices > original
      const markupPct = isDummy ? (markups[dummyIndex - 1] ?? 10) : 0;
      const markupFactor = 1 + markupPct / 100;
      let orgSubtotal = 0;
      const orgItems = reviewItems.map(item => {
        const qty = Number(item.qty ?? 1);
        const markedPrice = isDummy
          ? Math.ceil(Number(item.unitPrice ?? 0) * markupFactor)
          : Number(item.unitPrice ?? 0);
        orgSubtotal += qty * markedPrice * (1 - Number(item.discountPct ?? 0) / 100);
        return isDummy ? { ...item, unitPrice: markedPrice.toFixed(2) } : item;
      });

      const qId = nanoid();
      const quotationNo = await generateQuotationNo(org.id);
      const [q] = await db
        .insert(quotation)
        .values({
          id: qId,
          organizationId: org.id,
          quotationNo,
          groupId,
          govBatchId,
          isDummy: isDummy ? 1 : 0,
          ...(dummyDate ? { createdAt: dummyDate } : {}),
          validUntil,
          ...sharedValues,
          subtotal: orgSubtotal.toFixed(2),
          grandTotal: orgSubtotal.toFixed(2),
        })
        .returning();

      await db.insert(quotationItem).values(buildItemRows(q.id, orgItems as ReviewItem[]));

      quotationResults.push({
        id: q.id,
        orgId: org.id,
        orgName: org.name,
        isDummy,
        dummyIndex: isDummy ? dummyIndex++ : 0,
      });
    }

    const originalQ = quotationResults.find((q) => !q.isDummy) ?? quotationResults[0];

    results.push({
      title: file.title,
      groupId,
      govBatchId,
      customerOrgName: cust?.organizationName ?? "",
      originalId: originalQ.id,
      quotations: quotationResults,
    });
  }

  return results;
}

// In comparison mode, deletes all quotations in the group together.
export async function updateQuotationSettings(
  id: string,
  input: {
    overallDiscountPct?: string;
    overallDiscountAmt?: string;
    sstPct?: string;
    showProductCode?: boolean;
    includeMdaCerts?: boolean;
    includeCatalogue?: boolean;
    inclMof?: boolean;
    inclSsm?: boolean;
    inclTcc?: boolean;
    inclBankStatement?: boolean;
    inclMdaEstablishment?: boolean;
    inclLampiran12?: boolean;
    inclLampiran13?: boolean;
    showItemizeDiscount?: boolean;
  },
) {
  await requireAccess("quotation:update");

  const [q] = await db
    .select({ status: quotation.status, subtotal: quotation.subtotal })
    .from(quotation)
    .where(eq(quotation.id, id))
    .limit(1);

  if (!q) throw new Error("Quotation not found");
  if (q.status !== "draft") throw new Error("Cannot edit a finalized quotation");

  const subtotal = Number(q.subtotal ?? 0);
  const overallDiscPct = Number(input.overallDiscountPct ?? 0);
  const overallDiscAmt = overallDiscPct > 0
    ? subtotal * (overallDiscPct / 100)
    : Number(input.overallDiscountAmt ?? 0);
  const afterDiscount = subtotal - overallDiscAmt;
  const sstAmt = afterDiscount * (Number(input.sstPct ?? 0) / 100);
  const grandTotal = afterDiscount + sstAmt;

  await db.update(quotation).set({
    overallDiscountPct: input.overallDiscountPct ?? "0",
    overallDiscountAmt: overallDiscAmt.toFixed(2),
    sst: sstAmt.toFixed(2),
    sstPct: input.sstPct ?? "0",
    grandTotal: grandTotal.toFixed(2),
    showProductCode: input.showProductCode ? 1 : 0,
    includeMdaCerts: input.includeMdaCerts ? 1 : 0,
    includeCatalogue: input.includeCatalogue ? 1 : 0,
    inclMof: input.inclMof ? 1 : 0,
    inclSsm: input.inclSsm ? 1 : 0,
    inclTcc: input.inclTcc ? 1 : 0,
    inclBankStatement: input.inclBankStatement ? 1 : 0,
    inclMdaEstablishment: input.inclMdaEstablishment ? 1 : 0,
    inclLampiran12: input.inclLampiran12 ? 1 : 0,
    inclLampiran13: input.inclLampiran13 ? 1 : 0,
    showItemizeDiscount: input.showItemizeDiscount ? 1 : 0,
  }).where(eq(quotation.id, id));
}

export async function deleteQuotation(id: string) {
  const { orgId, userId } = await requireAccess("quotation:delete");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds =
    ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  const [q] = await db
    .select({ groupId: quotation.groupId })
    .from(quotation)
    .where(
      and(eq(quotation.id, id), inArray(quotation.organizationId, ownerOrgIds)),
    )
    .limit(1);

  if (!q) throw new Error("Quotation not found");

  if (q.groupId) {
    await db.delete(quotation).where(eq(quotation.groupId, q.groupId));
  } else {
    await db.delete(quotation).where(eq(quotation.id, id));
  }
}

// Rebuild a customer snapshot for a revision, preserving the org that was chosen in the
// original while refreshing live customer fields (name, email, contact).
async function rebuildSnapshotForRevision(
  customerId: string | null,
  existingSnapshot: { organizationName?: string | null } | null,
) {
  if (!customerId) return null;
  const snapshotOrg = existingSnapshot?.organizationName;
  let customerOrgMemberId: string | null = null;
  if (snapshotOrg) {
    const [mem] = await db
      .select({ id: customerCompany.id })
      .from(customerCompany)
      .innerJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
      .where(and(
        eq(customerCompany.customerId, customerId),
        eq(customerOrganization.name, snapshotOrg),
      ))
      .limit(1);
    customerOrgMemberId = mem?.id ?? null;
  }
  return buildCustomerSnapshot(customerId, customerOrgMemberId);
}

export async function reviseQuotation(quotationId: string): Promise<string> {
  const { orgId, userId } = await requireAccess("quotation:create");

  // 1. Load the source quotation (must belong to the user's active org)
  const [source] = await db
    .select()
    .from(quotation)
    .where(and(eq(quotation.id, quotationId), eq(quotation.organizationId, orgId)))
    .limit(1);
  if (!source) throw new Error("Quotation not found");
  if (source.status !== "final") throw new Error("Only finalized quotations can be revised");

  // 2. Determine root of this quotation's revision chain
  const originalId = source.originalQuotationId ?? quotationId;

  // 3. Base quotation number (strip any existing -Rn suffix from root)
  const [rootRow] = await db
    .select({ quotationNo: quotation.quotationNo })
    .from(quotation)
    .where(eq(quotation.id, originalId))
    .limit(1);
  const baseNo = rootRow?.quotationNo ?? source.quotationNo.replace(/-R\d+$/, "");

  // 4. Next revision number — count from the anchor's revision chain (org-scoped)
  const siblings = await db
    .select({ revisionNo: quotation.revisionNo })
    .from(quotation)
    .where(
      and(
        eq(quotation.organizationId, orgId),
        or(eq(quotation.id, originalId), eq(quotation.originalQuotationId, originalId))
      )
    );
  const newRevisionNo = siblings.reduce((m, r) => Math.max(m, r.revisionNo ?? 0), 0) + 1;

  const now = new Date();

  // ── Single quotation ──────────────────────────────────────────────────────
  if (!source.groupId) {
    const [sourceItems, newCustomerSnapshot] = await Promise.all([
      db.select().from(quotationItem).where(eq(quotationItem.quotationId, quotationId)),
      rebuildSnapshotForRevision(
        source.customerId,
        source.customerSnapshot as { organizationName?: string } | null,
      ),
    ]);

    const newId = nanoid();
    await db.insert(quotation).values({
      ...source,
      id: newId,
      quotationNo: `${baseNo}-R${newRevisionNo}`,
      revisionNo: newRevisionNo,
      originalQuotationId: originalId,
      groupId: null,
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      customerSnapshot: newCustomerSnapshot,
    });

    if (sourceItems.length > 0) {
      await db.insert(quotationItem).values(
        sourceItems.map((item) => ({ ...item, id: nanoid(), quotationId: newId }))
      );
    }

    revalidatePath("/dashboard/sales/quotation");
    return newId;
  }

  // ── Comparison quotation ──────────────────────────────────────────────────
  // Load every member of the source group
  const groupMembers = await db
    .select()
    .from(quotation)
    .where(eq(quotation.groupId, source.groupId))
    .orderBy(asc(quotation.isDummy));

  // Rebuild snapshot once from the anchor (organizationId === orgId) so all
  // members in the new revision group get a consistent, fresh snapshot that
  // preserves the chosen customer org.
  const anchorMember = groupMembers.find((m) => m.organizationId === orgId) ?? groupMembers[0];
  const newCustomerSnapshot = await rebuildSnapshotForRevision(
    anchorMember?.customerId ?? null,
    (anchorMember?.customerSnapshot as { organizationName?: string } | null) ?? null,
  );

  // Load all items for the whole group in one query
  const memberIds = groupMembers.map((m) => m.id);
  const allItems = memberIds.length > 0
    ? await db.select().from(quotationItem).where(inArray(quotationItem.quotationId, memberIds))
    : [];

  // New groupId isolates this revision from the finalized source group
  const newGroupId = nanoid();
  let newAnchorId = "";

  for (const member of groupMembers) {
    const memberRootId = member.originalQuotationId ?? member.id;
    const memberBaseNo = member.quotationNo.replace(/-R\d+$/, "");
    const memberNewId = nanoid();

    if (member.organizationId === orgId) newAnchorId = memberNewId;

    // Dummies are backdated 1-3 weekdays from the anchor's date,
    // but never before their own previous version's date.
    const memberCreatedAt = member.isDummy
      ? new Date(Math.max(
          randomWeekdaysBack(now, 1, 3).getTime(),
          new Date(member.createdAt).getTime(),
        ))
      : now;

    await db.insert(quotation).values({
      ...member,
      id: memberNewId,
      quotationNo: `${memberBaseNo}-R${newRevisionNo}`,
      revisionNo: newRevisionNo,
      originalQuotationId: memberRootId,
      groupId: newGroupId,
      status: "draft",
      createdBy: userId,
      createdAt: memberCreatedAt,
      updatedAt: now,
      customerSnapshot: newCustomerSnapshot,
    });

    const memberItems = allItems.filter((i) => i.quotationId === member.id);
    if (memberItems.length > 0) {
      await db.insert(quotationItem).values(
        memberItems.map((i) => ({ ...i, id: nanoid(), quotationId: memberNewId }))
      );
    }
  }

  revalidatePath("/dashboard/sales/quotation");
  return newAnchorId;
}
