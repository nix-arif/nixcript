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
  organization,
  organizationProfile,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
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
  imageKey?: string; // R2 key for catalogue image
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
  title?: string;
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
  showTotalPrice: boolean;
  showItemizeDiscount: boolean;
  inclMof: boolean;
  inclSsm: boolean;
  inclTcc: boolean;
  inclBankStatement: boolean;
  inclMdaEstablishment: boolean;
  inclLampiran12: boolean;
  inclLampiran13: boolean;
};

function buildItemRows(quotationId: string, items: ReviewItem[]) {
  return items.map((item) => {
    const qty = Number(item.qty ?? 1);
    const price = Number(item.unitPrice ?? 0);
    const disc = Number(item.discountPct ?? 0);
    const total = qty * price * (1 - disc / 100);

    return {
      id: nanoid(),
      quotationId,
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
      imageKey: item.imageKey ?? null,
      mdaRegNo: item.mdaRegNo,
      mdaValidity: item.mdaValidity,
      hasCert: item.hasCert ? 1 : 0,
      hasPrice: item.hasPrice ? 1 : 0,
      descriptionSource: item.descriptionSource,
      priceSource: item.priceSource,
      uomSource: item.uomSource,
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

  // Calculate shared pricing
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

  const validDaysNum = input.validDays ?? 30;

  const sharedValues = {
    mode: input.mode,
    customerId: input.customerId,
    customerSnapshot,
    salesPersonId: input.salesPersonId,
    salesPersonName: input.salesPersonName,
    preparedById: userId,
    preparedByName: me?.name ?? "",
    notes: input.notes,
    subtotal: subtotal.toFixed(2),
    overallDiscountPct: input.overallDiscountPct,
    overallDiscountAmt: ((subtotal * overallDisc) / 100).toFixed(2),
    sst: sstAmt.toFixed(2),
    sstPct: input.sstPct,
    grandTotal: grandTotal.toFixed(2),
    title: input.title ?? "Loose Items",
    includeCatalogue: input.includeCatalogue ? 1 : 0,
    includeMdaCerts: input.includeMdaCerts ? 1 : 0,
    showUnitPrice: 1,
    showTotalPrice: input.showTotalPrice ? 1 : 0,
    showItemizeDiscount: input.showItemizeDiscount ? 1 : 0,
    inclMof: input.inclMof ? 1 : 0,
    inclSsm: input.inclSsm ? 1 : 0,
    inclTcc: input.inclTcc ? 1 : 0,
    inclBankStatement: input.inclBankStatement ? 1 : 0,
    inclMdaEstablishment: input.inclMdaEstablishment ? 1 : 0,
    inclLampiran12: input.inclLampiran12 ? 1 : 0,
    inclLampiran13: input.inclLampiran13 ? 1 : 0,
    status: "draft" as const,
    createdBy: userId,
  };

  if (input.mode === "single") {
    const ownerOrgId = await getOwnerOrgId(userId, orgId);
    const quotationNo = await generateQuotationNo(ownerOrgId);
    const baseDate = new Date();
    const validUntil = new Date(baseDate);
    validUntil.setDate(validUntil.getDate() + validDaysNum);

    const [q] = await db
      .insert(quotation)
      .values({
        id: nanoid(),
        organizationId: ownerOrgId,
        quotationNo,
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

  // Determine primary org: for owners, use the active org; for members who may
  // be viewing a sibling org they don't directly belong to, use their home org.
  const [activeOrgMembership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);

  let primaryOrgId = orgId;
  if (!activeOrgMembership || activeOrgMembership.role !== "owner") {
    const clusterIds = targetOrgs.map((o) => o.id);
    const [homeOrgRow] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, userId), inArray(member.organizationId, clusterIds)))
      .orderBy(asc(member.createdAt))
      .limit(1);
    if (homeOrgRow) primaryOrgId = homeOrgRow.organizationId;
  }

  const groupId = nanoid();
  let originalQuotation: typeof quotation.$inferSelect | null = null;

  const originalDate = new Date();

  for (const org of targetOrgs) {
    const quotationNo = await generateQuotationNo(org.id);
    const isDummy = org.id !== primaryOrgId ? 1 : 0;
    const dummyDate = isDummy ? randomWeekdaysBack(originalDate, 1, 5) : undefined;
    const qDate = dummyDate ?? originalDate;
    const validUntil = new Date(qDate);
    validUntil.setDate(validUntil.getDate() + validDaysNum);

    const [q] = await db
      .insert(quotation)
      .values({
        id: nanoid(),
        organizationId: org.id,
        quotationNo,
        groupId,
        isDummy,
        ...(dummyDate ? { createdAt: dummyDate } : {}),
        validUntil,
        ...sharedValues,
      })
      .returning();

    await db.insert(quotationItem).values(buildItemRows(q.id, input.items));

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
        position: customer.position,
        department: customer.department,
        email: customer.email,
        contactNo: customer.contactNo,
        organizationName: customer.organizationName,
        organizationAddress: customer.organizationAddress,
      })
      .from(customer)
      .where(eq(customer.id, q.customerId))
      .limit(1);
    if (cust) customerData = cust;
  }

  // Merge: live data wins; fall back to snapshot for deleted customers
  const snapshot = q.customerSnapshot as Record<string, string> | null;
  const mergedCustomerSnapshot = customerData
    ? {
        title: customerData.title ?? snapshot?.title,
        name: customerData.name ?? snapshot?.name ?? "",
        position: customerData.position ?? snapshot?.position,
        department: customerData.department ?? snapshot?.department,
        email: customerData.email ?? snapshot?.email,
        contactNo: customerData.contactNo ?? snapshot?.contactNo,
        organizationName: customerData.organizationName ?? snapshot?.organizationName,
        organizationAddress: customerData.organizationAddress ?? snapshot?.organizationAddress,
      }
    : snapshot;

  const items = await db
    .select()
    .from(quotationItem)
    .where(eq(quotationItem.quotationId, id))
    .orderBy(asc(quotationItem.rowNo));

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

  return {
    quotation: { ...q, customerSnapshot: mergedCustomerSnapshot },
    orgName: orgRow?.name ?? "",
    orgLogoUrl,
    orgBrandColor: orgRow?.brandColor ?? null,
    orgCompanyName: orgRow?.companyName ?? null,
    orgCompanyAddress: orgRow?.companyAddress ?? null,
    orgTaxNo: orgRow?.taxNo ?? null,
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
    .orderBy(asc(quotationItem.rowNo));

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
          position: customerData.position ?? snapshot?.position,
          department: customerData.department ?? snapshot?.department,
          email: customerData.email ?? snapshot?.email,
          contactNo: customerData.contactNo ?? snapshot?.contactNo,
          organizationName: customerData.organizationName ?? snapshot?.organizationName,
          organizationAddress: customerData.organizationAddress ?? snapshot?.organizationAddress,
        }
      : snapshot;

    return {
      quotation: { ...q, customerSnapshot: mergedCustomerSnapshot },
      orgName: orgRow?.name ?? "",
      orgLogoUrl,
      orgBrandColor: orgRow?.brandColor ?? null,
      orgCompanyName: orgRow?.companyName ?? null,
      orgCompanyAddress: orgRow?.companyAddress ?? null,
      orgTaxNo: orgRow?.taxNo ?? null,
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
  const allItems = await db
    .select()
    .from(quotationItem)
    .where(inArray(quotationItem.quotationId, qIds))
    .orderBy(asc(quotationItem.rowNo));

  const allOrgIds = [...new Set(allQuotations.map((q) => q.organizationId))];
  const orgProfiles = await db
    .select({
      organizationId: organization.id,
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
export async function finalizeQuotation(
  id: string,
  markups?: Record<string, number>,
) {
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

  // Apply markups to dummy quotations
  if (q.groupId && markups) {
    for (const [qId, markupPct] of Object.entries(markups)) {
      if (!markupPct || markupPct <= 0) continue;
      const factor = 1 + markupPct / 100;

      const [qRecord] = await db
        .select()
        .from(quotation)
        .where(eq(quotation.id, qId))
        .limit(1);
      if (!qRecord || qRecord.isDummy === 0) continue;

      const qItems = await db
        .select()
        .from(quotationItem)
        .where(eq(quotationItem.quotationId, qId));

      let newSubtotal = 0;
      for (const item of qItems) {
        const newUnitPrice =
          Math.round(Number(item.unitPrice) * factor * 100) / 100;
        const qty = Number(item.qty ?? 1);
        const disc = Number(item.discountPct ?? 0);
        const newLineTotal = qty * newUnitPrice * (1 - disc / 100);
        const discAmt = (qty * newUnitPrice * disc) / 100;

        await db
          .update(quotationItem)
          .set({
            unitPrice: newUnitPrice.toFixed(2),
            totalPrice: newLineTotal.toFixed(2),
            discountAmt: discAmt.toFixed(2),
          })
          .where(eq(quotationItem.id, item.id));

        newSubtotal += newLineTotal;
      }

      const overallDisc = Number(qRecord.overallDiscountPct ?? 0);
      const newAfterDisc = newSubtotal * (1 - overallDisc / 100);
      const newSst = newAfterDisc * (Number(qRecord.sstPct ?? 0) / 100);
      const newGrandTotal = newAfterDisc + newSst;

      await db
        .update(quotation)
        .set({
          subtotal: newSubtotal.toFixed(2),
          overallDiscountAmt: ((newSubtotal * overallDisc) / 100).toFixed(2),
          sst: newSst.toFixed(2),
          grandTotal: newGrandTotal.toFixed(2),
        })
        .where(eq(quotation.id, qId));
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
  customerId?: string | null;
  salesPersonId?: string | null;
  salesPersonName?: string | null;
  validDays?: number;
  notes?: string | null;
  overallDiscountPct: string;
  sstPct: string;
  includeCatalogue: boolean;
  includeMdaCerts: boolean;
  showTotalPrice: boolean;
  showItemizeDiscount: boolean;
  inclMof: boolean;
  inclSsm: boolean;
  inclTcc: boolean;
  inclBankStatement: boolean;
  inclMdaEstablishment: boolean;
  inclLampiran12: boolean;
  inclLampiran13: boolean;
  items: {
    rowNo: number;
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
    descriptionSource?: "db" | "sheet";
    priceSource?: "db" | "sheet";
    uomSource?: "db" | "sheet";
  }[];
};

export async function updateQuotation(id: string, input: UpdateQuotationInput) {
  const { orgId, userId } = await requireAccess("quotation:update");
  const ownerOrgs = await getAllOwnerOrgs(userId, orgId);
  const ownerOrgIds =
    ownerOrgs.length > 0 ? ownerOrgs.map((o) => o.id) : [orgId];

  const [q] = await db
    .select({ status: quotation.status, createdAt: quotation.createdAt })
    .from(quotation)
    .where(
      and(eq(quotation.id, id), inArray(quotation.organizationId, ownerOrgIds)),
    )
    .limit(1);

  if (!q) throw new Error("Quotation not found");
  if (q.status !== "draft") throw new Error("Cannot edit a finalized quotation");

  // Snapshot customer
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

  // Recalculate totals from edited items
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

  const baseDate = q.createdAt ? new Date(q.createdAt) : new Date();
  const validUntil = new Date(baseDate);
  validUntil.setDate(validUntil.getDate() + (input.validDays ?? 30));

  await db
    .update(quotation)
    .set({
      title: input.title ?? "Loose Items",
      customerId: input.customerId ?? null,
      customerSnapshot,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      validUntil,
      notes: input.notes ?? null,
      subtotal: subtotal.toFixed(2),
      overallDiscountPct: input.overallDiscountPct,
      overallDiscountAmt: ((subtotal * overallDisc) / 100).toFixed(2),
      sst: sstAmt.toFixed(2),
      sstPct: input.sstPct,
      grandTotal: grandTotal.toFixed(2),
      includeCatalogue: input.includeCatalogue ? 1 : 0,
      includeMdaCerts: input.includeMdaCerts ? 1 : 0,
      showUnitPrice: 1,
      showTotalPrice: input.showTotalPrice ? 1 : 0,
      showItemizeDiscount: input.showItemizeDiscount ? 1 : 0,
      inclMof: input.inclMof ? 1 : 0,
      inclSsm: input.inclSsm ? 1 : 0,
      inclTcc: input.inclTcc ? 1 : 0,
      inclBankStatement: input.inclBankStatement ? 1 : 0,
      inclMdaEstablishment: input.inclMdaEstablishment ? 1 : 0,
      inclLampiran12: input.inclLampiran12 ? 1 : 0,
      inclLampiran13: input.inclLampiran13 ? 1 : 0,
    })
    .where(eq(quotation.id, id));

  // Replace items wholesale
  await db.delete(quotationItem).where(eq(quotationItem.quotationId, id));

  if (input.items.length > 0) {
    await db.insert(quotationItem).values(
      input.items.map((item) => {
        const qty = Number(item.qty ?? 1);
        const price = Number(item.unitPrice ?? 0);
        const disc = Number(item.discountPct ?? 0);
        const total = qty * price * (1 - disc / 100);
        return {
          id: nanoid(),
          quotationId: id,
          rowNo: item.rowNo,
          sku: item.sku ?? null,
          productCode: item.productCode ?? null,
          description: item.description ?? null,
          qty: String(item.qty),
          uom: item.uom ?? null,
          unitPrice: item.unitPrice ?? "0",
          discountPct: item.discountPct ?? "0",
          discountAmt: ((qty * price * disc) / 100).toFixed(2),
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
        };
      }),
    );
  }
}

// ── Delete quotation ───────────────────────────────────────────────────────
// In comparison mode, deletes all quotations in the group together.
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
