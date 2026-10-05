"use server";

// Doctor case templates — a doctor's usual cases (category, description and
// the items normally used) so a Case DO for that doctor starts pre-filled.
// Templates belong to the company that made them (each company keeps its own
// for its doctors); the doctors and products they use can be any of the group's.

import { db } from "@/db";
import { caseTemplate, caseTemplateItem, customer, customerCompany, customerOrganization, documentCategory, product } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getOrgGroupIds } from "@/lib/document-number-group";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { isMdaValid } from "@/lib/mda/valid";
import { pricedWithoutMda, pricedWithoutMdaMessage } from "@/lib/mda/priced-without-mda";
import { cleanCustomerView, type CustomerView } from "@/lib/delivery/customer-view";

// A machine: serial-tracked, rental, or has serial numbers registered.
// Spelled out with the table name: Drizzle leaves columns unqualified in a
// single-table query, which would point the sub-query at asset_unit's own id.
const isMachineSql = sql<boolean>`("product"."requires_serial_tracking" OR "product"."is_rental" OR EXISTS (SELECT 1 FROM asset_unit au WHERE au.product_id = "product"."id"))`;

async function ctx(perm: string) {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, perm)) throw new Error("Forbidden");
  return { orgId, userId: session.user.id, groupIds: await getOrgGroupIds(orgId), canEdit: hasAccess(perms, "delivery-order:create") };
}

export interface CaseTemplateItemInput extends CustomerView {
  productId?: string | null; productCode?: string | null; description?: string | null; qty: string; uom?: string | null;
  unitPrice?: string | null; // selling price per unit (itemized pricing)
  // Machines: which kind of unit to pick, and how a company asset goes out
  machineUse?: "SALE" | "ASSET" | null;
  loanPurpose?: "RENTAL" | "LOAN" | "DEMO" | null;
  loanReturnMode?: "same_day" | "stays" | null;
  usageFee?: string | null;
}

export interface SaveCaseTemplateInput {
  id?: string;
  customerId: string;
  customerOrgId?: string | null; // the hospital (customer organisation); null = any
  name: string;
  categoryIds: string[];
  description: string;
  items: CaseTemplateItemInput[];
  isDefault?: boolean;
  // Selling price: a price per item, or one total price for the whole case
  priceMode?: "itemized" | "total";
  totalPrice?: string | null;
}

export type CaseTemplateRow = Awaited<ReturnType<typeof loadTemplates>>[number];

// orgIds: the active company only — templates are per company
async function loadTemplates(orgIds: string[], customerIds?: string[]) {
  const rows = await db.select({
    t: caseTemplate, customerName: customer.name, customerTitle: customer.title, customerOrg: customer.organizationName,
    hospitalName: customerOrganization.name,
  }).from(caseTemplate).innerJoin(customer, eq(customer.id, caseTemplate.customerId))
    .leftJoin(customerOrganization, eq(customerOrganization.id, caseTemplate.customerOrgId))
    .where(and(inArray(caseTemplate.organizationId, orgIds), ...(customerIds ? [inArray(caseTemplate.customerId, customerIds)] : [])))
    .orderBy(asc(customer.name), desc(caseTemplate.isDefault), asc(caseTemplate.name));
  const ids = rows.map((r) => r.t.id);
  const items = ids.length ? await db.select().from(caseTemplateItem).where(inArray(caseTemplateItem.templateId, ids)).orderBy(asc(caseTemplateItem.rowNo)) : [];
  const prodIds = [...new Set(items.map((i) => i.productId).filter(Boolean) as string[])];
  // MDA per item product: the template is the customer copy, and a product
  // without a valid MDA registration won't print on it
  const mdaRows = prodIds.length ? await db.select({ id: product.id, reg: product.mdaRegistrationNo, exp: product.mdaExpiredOn }).from(product).where(inArray(product.id, prodIds)) : [];
  const mdaOk = new Map(mdaRows.map((m) => [m.id, isMdaValid(m.reg, m.exp)]));
  const machineIds = new Set(prodIds.length ? (await db.select({ id: product.id }).from(product).where(and(inArray(product.id, prodIds),
    isMachineSql))).map((p) => p.id) : []);
  // Categories are per company; matched by name on the Case DO (a template's
  // categories are its own company's, so this also covers older templates)
  const catIds = [...new Set(rows.flatMap((r) => r.t.categoryIds ?? []))];
  const cats = catIds.length ? await db.select({ id: documentCategory.id, name: documentCategory.name }).from(documentCategory).where(inArray(documentCategory.id, catIds)) : [];
  return rows.map((r) => ({
    ...r.t,
    categoryNames: (r.t.categoryIds ?? []).map((id) => cats.find((c) => c.id === id)?.name).filter(Boolean) as string[],
    doctorName: [r.customerTitle, r.customerName].filter(Boolean).join(" "),
    doctorOrg: r.customerOrg,
    // the hospital it's for; null = any of the doctor's hospitals
    hospitalName: r.hospitalName ?? null,
    items: items.filter((i) => i.templateId === r.t.id).map((i) => ({
      ...i, isMachine: !!i.productId && machineIds.has(i.productId),
      // null: a free-text line (prints as written, no MDA of its own)
      mdaValid: i.productId ? mdaOk.get(i.productId) ?? false : null,
    })),
  }));
}

/** A doctor's templates (for the Case DO form). */
export async function getCaseTemplatesForCustomer(customerId: string) {
  const { orgId } = await ctx("delivery-order:read");
  return loadTemplates([orgId], [customerId]);
}

/** Every template, grouped by doctor on the page. */
export async function listCaseTemplates() {
  const { orgId, canEdit } = await ctx("delivery-order:read");
  const [templates, categories] = await Promise.all([
    loadTemplates([orgId]),
    db.select({ id: documentCategory.id, name: documentCategory.name, color: documentCategory.color }).from(documentCategory).where(eq(documentCategory.organizationId, orgId)),
  ]);
  return { templates, categories, canEdit };
}

export async function saveCaseTemplate(input: SaveCaseTemplateInput): Promise<{ ok: true; id: string } | { ok: false; title: string }> {
  try {
    const { orgId, userId, groupIds } = await ctx("delivery-order:create");
    const name = input.name.trim();
    if (!name) return { ok: false, title: "Give the template a name, e.g. \"MILH standard\"" };
    const [doc] = await db.select({ id: customer.id, org: customer.organizationId }).from(customer).where(eq(customer.id, input.customerId)).limit(1);
    if (!doc || !groupIds.includes(doc.org)) return { ok: false, title: "Doctor not found" };
    const hospitalId = input.customerOrgId || null;
    if (hospitalId) {
      const [m] = await db.select({ id: customerCompany.id }).from(customerCompany)
        .where(and(eq(customerCompany.customerId, input.customerId), eq(customerCompany.customerOrganizationId, hospitalId))).limit(1);
      if (!m) return { ok: false, title: "The doctor isn't linked to that hospital" };
    }
    const items: (CaseTemplateItemInput & { rowNo: number; view: Required<CustomerView> })[] = [];
    for (const i of input.items.filter((i) => (i.productCode || i.description) && parseFloat(i.qty) > 0)) {
      const c = cleanCustomerView(i, false);
      if ("error" in c) return { ok: false, title: `${i.productCode || i.description}: ${c.error}` };
      items.push({ ...i, rowNo: items.length + 1, view: c.view });
    }
    const priceMode = input.priceMode === "total" ? "total" : "itemized";
    const money = (v?: string | null) => (v !== undefined && v !== null && String(v).trim() !== "" && parseFloat(String(v)) >= 0 ? parseFloat(String(v)).toFixed(2) : null);
    if (priceMode === "total" && money(input.totalPrice) === null) return { ok: false, title: "Enter the total price for the case, or choose itemized pricing" };
    const values = { name, customerOrgId: hospitalId, categoryIds: input.categoryIds ?? [], description: input.description.trim() || null, priceMode, totalPrice: priceMode === "total" ? money(input.totalPrice) : null };
    if (priceMode === "itemized") {
      const bad = await pricedWithoutMda(items);
      if (bad.length) return { ok: false, title: pricedWithoutMdaMessage(bad) };
    }
    // A doctor's first template (for this hospital) is their default there; asking for default moves it here
    const existing = await db.select({ id: caseTemplate.id }).from(caseTemplate)
      .where(and(eq(caseTemplate.customerId, input.customerId), eq(caseTemplate.organizationId, orgId), sameHospital(hospitalId)));
    const makeDefault = input.isDefault === true || existing.filter((e) => e.id !== input.id).length === 0;
    let id = input.id;
    if (id) {
      const [ex] = await db.select({ id: caseTemplate.id }).from(caseTemplate).where(and(eq(caseTemplate.id, id), eq(caseTemplate.organizationId, orgId))).limit(1);
      if (!ex) return { ok: false, title: "Template not found" };
      await db.update(caseTemplate).set({ ...values, customerId: input.customerId }).where(eq(caseTemplate.id, id));
      await db.delete(caseTemplateItem).where(eq(caseTemplateItem.templateId, id));
    } else {
      id = nanoid();
      await db.insert(caseTemplate).values({ id, organizationId: orgId, customerId: input.customerId, ...values, createdBy: userId });
    }
    if (makeDefault) await setDefault(id, input.customerId, orgId, hospitalId);
    if (items.length) {
      await db.insert(caseTemplateItem).values(items.map((i) => ({
        id: nanoid(), templateId: id!, rowNo: i.rowNo, productId: i.productId ?? null, productCode: i.productCode ?? null,
        description: i.description ?? null, qty: String(parseFloat(i.qty)), uom: i.uom ?? null,
        unitPrice: money(i.unitPrice),
        machineUse: i.machineUse === "SALE" || i.machineUse === "ASSET" ? i.machineUse : null,
        loanPurpose: i.machineUse === "ASSET" && ["RENTAL", "LOAN", "DEMO"].includes(i.loanPurpose ?? "") ? i.loanPurpose : null,
        loanReturnMode: i.machineUse === "ASSET" && ["same_day", "stays"].includes(i.loanReturnMode ?? "") ? i.loanReturnMode : null,
        usageFee: i.machineUse === "ASSET" && parseFloat(i.usageFee ?? "") > 0 ? String(parseFloat(i.usageFee!)) : null,
        ...i.view,
      })));
    }
    revalidatePath("/dashboard/fulfillment/delivery/case-templates");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't save the template" };
  }
}

export async function deleteCaseTemplate(id: string): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId } = await ctx("delivery-order:create");
    const [t] = await db.select().from(caseTemplate).where(and(eq(caseTemplate.id, id), eq(caseTemplate.organizationId, orgId))).limit(1);
    if (!t) return { ok: false, title: "Template not found" };
    await db.delete(caseTemplate).where(eq(caseTemplate.id, id));
    if (t.isDefault) {
      const [next] = await db.select({ id: caseTemplate.id }).from(caseTemplate)
        .where(and(eq(caseTemplate.customerId, t.customerId), eq(caseTemplate.organizationId, orgId), sameHospital(t.customerOrgId))).orderBy(asc(caseTemplate.createdAt)).limit(1);
      if (next) await db.update(caseTemplate).set({ isDefault: true }).where(eq(caseTemplate.id, next.id));
    }
    revalidatePath("/dashboard/fulfillment/delivery/case-templates");
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't delete the template" };
  }
}

/** Product search for template items (anyone who can see delivery orders). */
export async function searchTemplateProducts(query: string) {
  const { groupIds } = await ctx("delivery-order:read");
  const q = query.trim();
  if (q.length < 2) return [];
  const { ilike, or } = await import("drizzle-orm");
  // A machine: serial-tracked, rental, or has serial numbers registered
  return db.select({
    id: product.id, productCode: product.productCode, description: product.description, uom: product.uom,
    sellingPrice: product.sellingUnitPrice,
    mdaRegNo: product.mdaRegistrationNo, mdaExpiredOn: product.mdaExpiredOn,
    isMachine: isMachineSql,
  })
    .from(product)
    .where(and(inArray(product.organizationId, groupIds), or(ilike(product.productCode, `%${q}%`), ilike(product.description, `%${q}%`))))
    .orderBy(asc(product.productCode)).limit(30);
}

/** The hospitals a doctor works at (to choose which one a template is for). */
export async function getDoctorHospitals(customerId: string): Promise<{ id: string; name: string; isPrimary: boolean }[]> {
  await ctx("delivery-order:read");
  return db.select({ id: customerOrganization.id, name: customerOrganization.name, isPrimary: customerCompany.isPrimary })
    .from(customerCompany).innerJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
    .where(eq(customerCompany.customerId, customerId))
    .orderBy(desc(customerCompany.isPrimary), asc(customerOrganization.name));
}

/** MDA status of products (Case DO customer items): valid registration or not. */
export async function getProductsMda(productIds: string[]): Promise<Record<string, { regNo: string | null; valid: boolean }>> {
  const { groupIds } = await ctx("delivery-order:read");
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return {};
  const rows = await db.select({ id: product.id, reg: product.mdaRegistrationNo, exp: product.mdaExpiredOn }).from(product)
    .where(and(inArray(product.id, ids), inArray(product.organizationId, groupIds)));
  return Object.fromEntries(rows.map((r) => [r.id, { regNo: r.reg, valid: isMdaValid(r.reg, r.exp) }]));
}

const sameHospital = (hospitalId: string | null) => (hospitalId ? eq(caseTemplate.customerOrgId, hospitalId) : isNull(caseTemplate.customerOrgId));

// one default per doctor and hospital ("any hospital" counts as its own), within this company
async function setDefault(id: string, customerId: string, orgId: string, hospitalId: string | null) {
  await db.update(caseTemplate).set({ isDefault: false })
    .where(and(eq(caseTemplate.customerId, customerId), eq(caseTemplate.organizationId, orgId), sameHospital(hospitalId), ne(caseTemplate.id, id)));
  await db.update(caseTemplate).set({ isDefault: true }).where(eq(caseTemplate.id, id));
}

/** Make this the template filled in automatically when its doctor is picked. */
export async function makeCaseTemplateDefault(id: string): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId } = await ctx("delivery-order:create");
    const [t] = await db.select({ customerId: caseTemplate.customerId, hospitalId: caseTemplate.customerOrgId }).from(caseTemplate)
      .where(and(eq(caseTemplate.id, id), eq(caseTemplate.organizationId, orgId))).limit(1);
    if (!t) return { ok: false, title: "Template not found" };
    await setDefault(id, t.customerId, orgId, t.hospitalId);
    revalidatePath("/dashboard/fulfillment/delivery/case-templates");
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't change the default" };
  }
}
