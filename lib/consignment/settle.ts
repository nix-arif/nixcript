// Consignment settlement — turns billable consumption into documents.
//
//   agent (intercompany): owner's INVOICE to the agent (customer record linked
//     to the agent company) + the agent's confirmed PO to the owner (supplier
//     record linked to the owner company), priced at the transfer price.
//   customer: an INVOICE to the customer at the selling price.
//
// Internal (not "use server"): trusts its inputs. Callers check permission
// and scope — server/consign.ts (manual) and server/delivery-order.ts (auto,
// per use). Each billable event is stamped with its settlement, so it can
// never be billed twice.

import { db } from "@/db";
import {
  consignEvent, consignHeader, consignLine, consignPairSetting, consignPriceItem, consignSettlement,
  consignPartner, consignPartnerPriceItem, purchaseOrderCounter,
  customer, customerOrganization, invoice, invoiceItem, intercompanyPurchaseOrderCounter,
  organization, product, purchaseOrder, purchaseOrderItem, salesOrderItem, supplier, documentNumberingSetting, member,
  assetUnit,
} from "@/db/schema";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { LENDABLE_USES } from "@/lib/inventory/constants";
import { nextFreeDocNo } from "@/lib/document-number-group";
import { standaloneInvoiceNo } from "@/lib/invoice-number";
import { buildDocumentNo } from "@/lib/document-numbering";
import type { DocType } from "@/lib/document-numbering";

const num = (s: string | null | undefined) => parseFloat(s ?? "0") || 0;
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

// ── Numbering (same counters + group-wide uniqueness as the document modules) ──

// Same rules as server/document-numbering.ts#getNumberingConfig, without its
// session check — settlement also runs from the monthly scheduler, where
// there is no signed-in user.
const DEFAULT_DOC_CODE: Partial<Record<DocType, string>> = { inv: "INV", po: "PO", icpo: "ICPO" };
async function getNumberingConfig(orgId: string, docType: DocType) {
  const [row] = await db.select().from(documentNumberingSetting)
    .where(and(eq(documentNumberingSetting.organizationId, orgId), eq(documentNumberingSetting.documentType, docType))).limit(1);
  if (row) {
    return { documentType: docType, prefix: row.prefix, docCode: row.docCode, separator: row.separator, includeYear: row.includeYear, paddingLength: row.paddingLength, numberFormat: row.numberFormat ?? "standard" };
  }
  const [org] = await db.select({ slug: organization.slug }).from(organization).where(eq(organization.id, orgId));
  return { documentType: docType, prefix: (org?.slug ?? "ORG").toUpperCase(), docCode: DEFAULT_DOC_CODE[docType] ?? docType.toUpperCase(), separator: "-", includeYear: 1, paddingLength: 4, numberFormat: "standard" };
}

// Settlement invoices have no DO: the invoice "C" series (INVSI/26-C0001), so
// they never take a number an aligned DO invoice will need
async function nextInvoiceNo(orgId: string): Promise<string> {
  return standaloneInvoiceNo(orgId);
}

async function nextIntercompanyPoNo(orgId: string): Promise<string> {
  // A company with no intercompany-PO numbering set up follows its own PO
  // numbering with doc code "ICPO" (e.g. POAF/26-0001 → ICPOAF/26-0001),
  // instead of the org-slug fallback.
  const [own] = await db.select({ id: documentNumberingSetting.id }).from(documentNumberingSetting)
    .where(and(eq(documentNumberingSetting.organizationId, orgId), eq(documentNumberingSetting.documentType, "icpo"))).limit(1);
  const cfg = own ? await getNumberingConfig(orgId, "icpo") : { ...(await getNumberingConfig(orgId, "po")), documentType: "icpo" as const, docCode: "ICPO" };
  const year = new Date().getFullYear();
  const [c] = await db.select().from(intercompanyPurchaseOrderCounter).where(eq(intercompanyPurchaseOrderCounter.organizationId, orgId)).limit(1);
  const start = c && c.year === year ? c.lastNumber + 1 : 1;
  const { seq, docNo } = await nextFreeDocNo(
    { table: purchaseOrder, id: purchaseOrder.id, organizationId: purchaseOrder.organizationId, number: purchaseOrder.poNo },
    orgId, start, (n) => buildDocumentNo(cfg, year, n),
  );
  if (c) await db.update(intercompanyPurchaseOrderCounter).set({ year, lastNumber: seq }).where(eq(intercompanyPurchaseOrderCounter.organizationId, orgId));
  else await db.insert(intercompanyPurchaseOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: seq });
  return docNo;
}

async function nextPoNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "po");
  const year = new Date().getFullYear();
  const [c] = await db.select().from(purchaseOrderCounter).where(eq(purchaseOrderCounter.organizationId, orgId)).limit(1);
  const start = c && c.year === year ? c.lastNumber + 1 : 1;
  const { seq, docNo } = await nextFreeDocNo(
    { table: purchaseOrder, id: purchaseOrder.id, organizationId: purchaseOrder.organizationId, number: purchaseOrder.poNo },
    orgId, start, (n) => buildDocumentNo(cfg, year, n),
  );
  if (c) await db.update(purchaseOrderCounter).set({ year, lastNumber: seq }).where(eq(purchaseOrderCounter.organizationId, orgId));
  else await db.insert(purchaseOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: seq });
  return docNo;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

export interface PricedLine {
  eventId: string;
  eventType: string;
  eventDate: Date;
  consignmentNo: string;
  sourceNo: string | null;
  productId: string;
  productCode: string;
  description: string | null;
  uom: string | null;
  lotNo: string | null;
  serialNo: string | null;
  qty: number;
  unitCost: number;
  unitPrice: number | null; // null = can't be priced yet
  amount: number;
  note: string | null;
  // partner (sales-agent) lines
  endCustomerOrgId?: string | null;
  endCustomerId?: string | null;
  hospitalName?: string | null;
  commission?: number;
}

type Pair = typeof consignPairSetting.$inferSelect;

async function transferPrice(pair: Pair | null, ev: { sourceType: string | null; sourceId: string | null }, line: typeof consignLine.$inferSelect, prod: { costUnitPrice: string | null }):
  Promise<{ price: number | null; note: string | null }> {
  const cost = num(line.unitCost) || num(prod.costUnitPrice);
  // Never bill at 0 by accident: no cost → the line waits until one exists
  const costPlus = (markup: number) => cost > 0
    ? { price: cost * (1 + markup / 100), note: null as string | null }
    : { price: null, note: "No unit cost recorded — set the product's cost price or add it to the price list" };
  const method = pair?.priceMethod ?? "cost_plus";
  if (method === "cost_plus") return costPlus(num(pair?.markupPct));
  if (method === "price_list") {
    const [pi] = pair ? await db.select({ price: consignPriceItem.price }).from(consignPriceItem)
      .where(and(eq(consignPriceItem.pairSettingId, pair.id), eq(consignPriceItem.productId, line.productId))).limit(1) : [];
    if (pi) return { price: num(pi.price), note: null };
    const fb = costPlus(num(pair?.markupPct));
    return { price: fb.price, note: fb.note ?? "Not on the price list — priced cost-plus" };
  }
  // pct_of_sale: a share of what the agent invoiced for this product on the source document
  if (ev.sourceType !== "CASE_DO" || !ev.sourceId) return { price: null, note: "No sale document to take a share of" };
  const [inv] = await db.select({ id: invoice.id }).from(invoice).where(eq(invoice.deliveryOrderId, ev.sourceId)).limit(1);
  if (!inv) return { price: null, note: "Waiting for the Case DO's invoice" };
  const [it] = await db.select({ unitPrice: invoiceItem.unitPrice }).from(invoiceItem)
    .where(and(eq(invoiceItem.invoiceId, inv.id), eq(invoiceItem.productId, line.productId))).limit(1);
  if (!it) return { price: null, note: "Product not found on the Case DO's invoice" };
  return { price: num(it.unitPrice) * num(pair?.sharePct) / 100, note: null };
}

async function customerPrice(header: typeof consignHeader.$inferSelect, line: typeof consignLine.$inferSelect, prod: { sellingUnitPrice: string | null }):
  Promise<{ price: number | null; note: string | null }> {
  if (header.soId) {
    const [si] = await db.select({ unitPrice: salesOrderItem.unitPrice }).from(salesOrderItem)
      .where(and(eq(salesOrderItem.salesOrderId, header.soId), eq(salesOrderItem.productId, line.productId))).limit(1);
    if (si) return { price: num(si.unitPrice), note: null };
  }
  if (num(prod.sellingUnitPrice) > 0) return { price: num(prod.sellingUnitPrice), note: header.soId ? "Not on the sales order — catalogue price" : null };
  return { price: null, note: "No selling price — link a sales order or set the product's selling price" };
}

type Partner = typeof consignPartner.$inferSelect;

/** Dealer: the dealer's price. Sales agent: the hospital price (+ commission computed by the caller). */
async function partnerPrice(partner: Partner, ev: { unitPrice: string | null }, line: typeof consignLine.$inferSelect, prod: { costUnitPrice: string | null; sellingUnitPrice: string | null }):
  Promise<{ price: number | null; note: string | null }> {
  const selling = num(prod.sellingUnitPrice);
  if (partner.model === "sales_agent") {
    if (ev.unitPrice !== null && ev.unitPrice !== undefined && ev.unitPrice !== "") return { price: num(ev.unitPrice), note: null };
    if (selling > 0) return { price: selling, note: "Catalogue selling price (no price reported)" };
    return { price: null, note: "No selling price — report the price charged or set the product's selling price" };
  }
  const discounted = () => selling > 0
    ? { price: selling * (1 - num(partner.discountPct) / 100), note: null as string | null }
    : { price: null, note: "No selling price to discount — set the product's selling price or add it to the dealer's price list" };
  if (partner.priceMethod === "price_list") {
    const [pi] = await db.select({ price: consignPartnerPriceItem.price }).from(consignPartnerPriceItem)
      .where(and(eq(consignPartnerPriceItem.partnerId, partner.id), eq(consignPartnerPriceItem.productId, line.productId))).limit(1);
    if (pi) return { price: num(pi.price), note: null };
    const fb = discounted();
    return { price: fb.price, note: fb.note ?? "Not on the dealer price list — selling price less discount" };
  }
  if (partner.priceMethod === "cost_plus") {
    const cost = num(line.unitCost) || num(prod.costUnitPrice);
    return cost > 0 ? { price: cost * (1 + num(partner.markupPct) / 100), note: null } : { price: null, note: "No unit cost recorded — set the product's cost price" };
  }
  return discounted();
}

const monthName = (d: Date) => d.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Monthly rental for consigned machines: one billable `rental` event per
 * machine per calendar month it was held by the consignee (any part of the
 * month), at the monthly fee set for that consignee. Idempotent — a month
 * already accrued for a machine is never added twice.
 */
export async function accrueMachineRentals(p: { ownerOrgId: string; agentOrgId?: string; partnerId?: string; from?: Date; to?: Date }) {
  let fee = 0;
  if (p.agentOrgId) {
    const [pair] = await db.select().from(consignPairSetting)
      .where(and(eq(consignPairSetting.ownerOrgId, p.ownerOrgId), eq(consignPairSetting.agentOrgId, p.agentOrgId))).limit(1);
    if (pair?.machineMethod === "monthly_rental") fee = num(pair.machineFee);
  } else if (p.partnerId) {
    const [pt] = await db.select().from(consignPartner).where(and(eq(consignPartner.id, p.partnerId), eq(consignPartner.organizationId, p.ownerOrgId))).limit(1);
    if (pt?.model === "dealer" && pt.machineMethod === "monthly_rental") fee = num(pt.machineFee);
  }
  if (!(fee > 0)) return;

  const headerCond = p.agentOrgId
    ? and(eq(consignHeader.organizationId, p.ownerOrgId), eq(consignHeader.consigneeType, "agent"), eq(consignHeader.agentOrgId, p.agentOrgId))
    : and(eq(consignHeader.organizationId, p.ownerOrgId), eq(consignHeader.consigneeType, "partner"), eq(consignHeader.partnerId, p.partnerId!));
  const machines = await db.select({ line: consignLine, header: consignHeader }).from(consignLine)
    .innerJoin(consignHeader, eq(consignHeader.id, consignLine.consignmentId))
    .innerJoin(assetUnit, eq(assetUnit.id, consignLine.unitId))
    .where(and(headerCond, inArray(assetUnit.intendedUse, [...LENDABLE_USES])));
  if (!machines.length) return;

  const now = new Date();
  const upTo = p.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 1); // through the current month
  for (const { line, header } of machines) {
    const events = await db.select().from(consignEvent).where(eq(consignEvent.lineId, line.id)).orderBy(consignEvent.eventDate);
    const sent = events.find((e) => e.type === "send" || e.type === "move_in");
    if (!sent) continue;
    // A serial line holds one unit: held from its send until it was returned, written off, used up or
    // moved to another of the agent's locations. The line it moved from already charges the month of
    // the move, so a moved-in line starts the month after.
    const gone = events.find((e) => ["return", "adjust", "consume", "move_out"].includes(e.type) && num(e.qty) > 0);
    const start = sent.type === "move_in"
      ? new Date(sent.eventDate.getFullYear(), sent.eventDate.getMonth() + 1, 1)
      : new Date(sent.eventDate.getFullYear(), sent.eventDate.getMonth(), 1);
    const accrued = new Set(events.filter((e) => e.type === "rental").map((e) => e.reason));
    for (let m = p.from && p.from > start ? new Date(p.from) : start; m < upTo; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      if (!(sent.eventDate < next) || (gone && gone.eventDate < m)) continue;
      const key = `rent:${monthKey(m)}`;
      if (accrued.has(key)) continue;
      await db.insert(consignEvent).values({
        id: nanoid(), consignmentId: header.id, lineId: line.id, organizationId: header.organizationId,
        type: "rental", qty: "1.0000", eventDate: m, sourceType: "RENTAL", sourceId: null, sourceNo: `Rental ${monthName(m)}`,
        reason: key, chargePrice: fee.toFixed(2), billable: true, createdBy: header.createdBy,
      });
    }
  }
}

/** Unsettled billable events for an owner, priced — agent pair or one customer consignment. */
export async function priceUnsettled(opts:
  | { kind: "agent"; ownerOrgId: string; agentOrgId: string; from?: Date; to?: Date; sourceId?: string }
  | { kind: "customer"; ownerOrgId: string; consignmentId: string }
  | { kind: "partner"; ownerOrgId: string; partnerId: string; from?: Date; to?: Date; sourceId?: string }): Promise<PricedLine[]> {
  // Machines on monthly rental accrue their months before anything is priced
  if (opts.kind === "agent" && !opts.sourceId) await accrueMachineRentals({ ownerOrgId: opts.ownerOrgId, agentOrgId: opts.agentOrgId, from: opts.from, to: opts.to });
  if (opts.kind === "partner" && !opts.sourceId) await accrueMachineRentals({ ownerOrgId: opts.ownerOrgId, partnerId: opts.partnerId, from: opts.from, to: opts.to });
  const conds = [
    eq(consignEvent.organizationId, opts.ownerOrgId), eq(consignEvent.billable, true), isNull(consignEvent.settlementId),
    eq(consignHeader.organizationId, opts.ownerOrgId),
  ];
  if (opts.kind === "agent") {
    conds.push(eq(consignHeader.consigneeType, "agent"), eq(consignHeader.agentOrgId, opts.agentOrgId));
    if (opts.from) conds.push(gte(consignEvent.eventDate, opts.from));
    if (opts.to) conds.push(lt(consignEvent.eventDate, opts.to));
    if (opts.sourceId) conds.push(eq(consignEvent.sourceId, opts.sourceId));
  } else if (opts.kind === "partner") {
    conds.push(eq(consignHeader.consigneeType, "partner"), eq(consignHeader.partnerId, opts.partnerId));
    if (opts.from) conds.push(gte(consignEvent.eventDate, opts.from));
    if (opts.to) conds.push(lt(consignEvent.eventDate, opts.to));
    if (opts.sourceId) conds.push(eq(consignEvent.sourceId, opts.sourceId));
  } else {
    conds.push(eq(consignHeader.id, opts.consignmentId));
  }
  const rows = await db.select({ ev: consignEvent, line: consignLine, header: consignHeader, prod: { costUnitPrice: product.costUnitPrice, sellingUnitPrice: product.sellingUnitPrice } })
    .from(consignEvent)
    .innerJoin(consignLine, eq(consignLine.id, consignEvent.lineId))
    .innerJoin(consignHeader, eq(consignHeader.id, consignEvent.consignmentId))
    .innerJoin(product, eq(product.id, consignLine.productId))
    .where(and(...conds))
    .orderBy(consignEvent.eventDate);
  const [partner] = opts.kind === "partner"
    ? await db.select().from(consignPartner).where(and(eq(consignPartner.id, opts.partnerId), eq(consignPartner.organizationId, opts.ownerOrgId))).limit(1)
    : [];
  const hospitalIds = [...new Set(rows.map((r) => r.ev.endCustomerOrgId).filter(Boolean) as string[])];
  const hospitals = hospitalIds.length
    ? await db.select({ id: customerOrganization.id, name: customerOrganization.name }).from(customerOrganization).where(inArray(customerOrganization.id, hospitalIds))
    : [];
  const [pair] = opts.kind === "agent"
    ? await db.select().from(consignPairSetting).where(and(eq(consignPairSetting.ownerOrgId, opts.ownerOrgId), eq(consignPairSetting.agentOrgId, opts.agentOrgId))).limit(1)
    : [];
  const out: PricedLine[] = [];
  for (const { ev, line, header, prod } of rows) {
    const isMachine = ev.type === "machine_use" || ev.type === "rental";
    // Machine use / rental: the charge was fixed when it was recorded
    let { price, note } = isMachine
      ? { price: ev.chargePrice !== null ? num(ev.chargePrice) : null, note: ev.type === "machine_use" && ev.unitPrice ? `Usage fee charged to hospital: RM ${num(ev.unitPrice).toFixed(2)}` : null as string | null }
      : opts.kind === "agent"
        ? await transferPrice(pair ?? null, ev, line, prod)
        : opts.kind === "partner"
          ? await partnerPrice(partner!, ev, line, prod)
          : await customerPrice(header, line, prod);
    // A sales agent's usage is invoiced to the hospital it was used at
    if (opts.kind === "partner" && partner?.model === "sales_agent" && !ev.endCustomerOrgId && (ev.type === "consume" || ev.type === "machine_use")) {
      price = null; note = "No hospital recorded for this usage";
    }
    const qty = num(ev.qty);
    out.push({
      eventId: ev.id, eventType: ev.type, eventDate: ev.eventDate, consignmentNo: header.consignmentNo, sourceNo: ev.sourceNo,
      productId: line.productId, productCode: line.productCode, uom: line.uom,
      description: ev.type === "machine_use" ? `Machine use (per case) — ${line.description ?? line.productCode}`
        : ev.type === "rental" ? `Machine rental ${monthName(ev.eventDate)} — ${line.description ?? line.productCode}`
        : line.description,
      lotNo: line.lotNo, serialNo: line.serialNo, qty, unitCost: num(line.unitCost) || num(prod.costUnitPrice),
      unitPrice: price === null ? null : Math.round(price * 100) / 100,
      amount: price === null ? 0 : Math.round(price * qty * 100) / 100,
      note: ev.type === "adjust" ? [`Charged adjustment (${ev.reason})`, note].filter(Boolean).join(" · ") : note,
      endCustomerOrgId: ev.endCustomerOrgId, endCustomerId: ev.endCustomerId,
      hospitalName: ev.endCustomerOrgId ? hospitals.find((h) => h.id === ev.endCustomerOrgId)?.name ?? null : null,
      commission: opts.kind === "partner" && partner?.model === "sales_agent" && price !== null
        ? (ev.reason === "no-commission" ? 0 : Math.round(price * qty * num(partner.commissionPct)) / 100) : undefined,
    });
  }
  return out;
}

// ── Documents ────────────────────────────────────────────────────────────────

async function findOrCreateLinkedCustomer(ownerOrgId: string, agentOrgId: string, userId: string) {
  const [c] = await db.select({ id: customer.id, name: customer.name }).from(customer)
    .where(and(eq(customer.organizationId, ownerOrgId), eq(customer.linkedOrganizationId, agentOrgId))).limit(1);
  if (c) return c;
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, agentOrgId));
  const name = org?.name ?? "Agent company";
  const [created] = await db.insert(customer).values({
    id: nanoid(), organizationId: ownerOrgId, name, organizationName: name, linkedOrganizationId: agentOrgId, createdBy: userId,
  }).returning({ id: customer.id, name: customer.name });
  return created;
}

async function findOrCreateLinkedSupplier(agentOrgId: string, ownerOrgId: string, userId: string) {
  const [s] = await db.select({ id: supplier.id, name: supplier.name }).from(supplier)
    .where(and(eq(supplier.organizationId, agentOrgId), eq(supplier.linkedOrganizationId, ownerOrgId))).limit(1);
  if (s) return s;
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, ownerOrgId));
  const [created] = await db.insert(supplier).values({
    id: nanoid(), organizationId: agentOrgId, name: org?.name ?? "Owner company", linkedOrganizationId: ownerOrgId, createdBy: userId,
  } as typeof supplier.$inferInsert).returning({ id: supplier.id, name: supplier.name });
  return created;
}

/** Aggregate priced lines into invoice/PO lines: one per product + unit price. */
function groupLines(lines: PricedLine[]) {
  const map = new Map<string, { productId: string; productCode: string; description: string; uom: string | null; qty: number; unitPrice: number; unitCost: number; refs: Set<string> }>();
  for (const l of lines) {
    const key = `${l.productId}|${l.unitPrice}|${l.description}`;
    const e = map.get(key) ?? { productId: l.productId, productCode: l.productCode, description: l.description ?? l.productCode, uom: l.uom, qty: 0, unitPrice: l.unitPrice ?? 0, unitCost: l.unitCost, refs: new Set<string>() };
    e.qty += l.qty;
    if (l.sourceNo) e.refs.add(l.sourceNo);
    if (l.serialNo) e.refs.add(`SN ${l.serialNo}`);
    map.set(key, e);
  }
  return [...map.values()].map((g, i) => ({
    ...g, rowNo: i + 1,
    fullDescription: `${g.description}${g.refs.size ? ` — ${[...g.refs].join(", ")}` : ""}`,
    total: Math.round(g.qty * g.unitPrice * 100) / 100,
  }));
}

export interface SettlementResult { settlementId: string; invoiceNo: string; poNo?: string; total: number; lineCount: number; skipped: PricedLine[] }

export async function settleAgent(p: { ownerOrgId: string; agentOrgId: string; userId: string; from?: Date; to?: Date; sourceId?: string; label: string }): Promise<SettlementResult | null> {
  const priced = await priceUnsettled({ kind: "agent", ownerOrgId: p.ownerOrgId, agentOrgId: p.agentOrgId, from: p.from, to: p.to, sourceId: p.sourceId });
  const ready = priced.filter((l) => l.unitPrice !== null);
  const skipped = priced.filter((l) => l.unitPrice === null);
  if (!ready.length) return null;
  const groups = groupLines(ready);
  const total = groups.reduce((s, g) => s + g.total, 0);
  const costTotal = groups.reduce((s, g) => s + g.qty * g.unitCost, 0);
  const now = new Date();

  const cust = await findOrCreateLinkedCustomer(p.ownerOrgId, p.agentOrgId, p.userId);
  const sup = await findOrCreateLinkedSupplier(p.agentOrgId, p.ownerOrgId, p.userId);
  const invoiceNo = await nextInvoiceNo(p.ownerOrgId);
  const poNo = await nextIntercompanyPoNo(p.agentOrgId);
  const invoiceId = nanoid(), poId = nanoid(), settlementId = nanoid();
  const notes = `Consignment settlement — ${p.label}`;

  await db.insert(invoice).values({
    id: invoiceId, organizationId: p.ownerOrgId, invoiceNo, invoiceDate: now,
    customerId: cust.id, customerSnapshot: { name: cust.name, organizationName: cust.name },
    subtotal: money(total), grandTotal: money(total),
    costTotal: money(costTotal), profit: money(total - costTotal),
    status: "draft", notes, createdBy: p.userId,
  } as typeof invoice.$inferInsert);
  await db.insert(invoiceItem).values(groups.map((g) => ({
    id: nanoid(), invoiceId, rowNo: g.rowNo, productId: g.productId, productCode: g.productCode, description: g.fullDescription,
    qty: String(g.qty), uom: g.uom, unitPrice: money(g.unitPrice), totalPrice: money(g.total),
    costUnitPrice: money(g.unitCost), costTotal: money(g.qty * g.unitCost),
  })) as (typeof invoiceItem.$inferInsert)[]);

  await db.insert(purchaseOrder).values({
    id: poId, organizationId: p.agentOrgId, poNo, supplierId: sup.id, sourceInvoiceId: invoiceId,
    subtotal: money(total), grandTotal: money(total), currency: "MYR", status: "confirmed",
    notes: `${notes} (invoice ${invoiceNo}) — consigned stock already used; no goods receipt`,
    createdBy: p.userId, approvedBy: p.userId, approvedAt: now,
  } as typeof purchaseOrder.$inferInsert);
  // Invoice and PO reference each other: link the invoice once the PO exists
  await db.update(invoice).set({ purchaseOrderId: poId }).where(eq(invoice.id, invoiceId));
  await db.insert(purchaseOrderItem).values(groups.map((g) => ({
    id: nanoid(), purchaseOrderId: poId, rowNo: g.rowNo, productCode: g.productCode, description: g.fullDescription,
    qty: String(g.qty), uom: g.uom, unitPrice: money(g.unitPrice), totalPrice: money(g.total), currency: "MYR",
  })) as (typeof purchaseOrderItem.$inferInsert)[]);

  await db.insert(consignSettlement).values({
    id: settlementId, organizationId: p.ownerOrgId, consigneeType: "agent", agentOrgId: p.agentOrgId,
    periodFrom: p.from ?? null, periodTo: p.to ?? null, invoiceId, purchaseOrderId: poId, total: money(total), createdBy: p.userId,
  });
  await db.update(consignEvent).set({ settlementId }).where(inArray(consignEvent.id, ready.map((l) => l.eventId)));
  return { settlementId, invoiceNo, poNo, total, lineCount: ready.length, skipped };
}

export async function settleCustomer(p: { ownerOrgId: string; consignmentId: string; userId: string }): Promise<SettlementResult | null> {
  const [header] = await db.select().from(consignHeader).where(and(eq(consignHeader.id, p.consignmentId), eq(consignHeader.organizationId, p.ownerOrgId))).limit(1);
  if (!header || header.consigneeType !== "customer") return null;
  const all = await priceUnsettled({ kind: "customer", ownerOrgId: p.ownerOrgId, consignmentId: p.consignmentId });
  const priced = all.filter((l) => l.unitPrice !== null);
  if (!priced.length) return null;
  const groups = groupLines(priced);
  const total = groups.reduce((s, g) => s + g.total, 0);
  const costTotal = groups.reduce((s, g) => s + g.qty * g.unitCost, 0);
  const [hospital] = header.customerOrgId
    ? await db.select({ name: customerOrganization.name, address: customerOrganization.address }).from(customerOrganization).where(eq(customerOrganization.id, header.customerOrgId)).limit(1)
    : [];
  const [cust] = header.customerId ? await db.select({ name: customer.name, title: customer.title }).from(customer).where(eq(customer.id, header.customerId)).limit(1) : [];
  const invoiceNo = await nextInvoiceNo(p.ownerOrgId);
  const invoiceId = nanoid(), settlementId = nanoid();
  await db.insert(invoice).values({
    id: invoiceId, organizationId: p.ownerOrgId, invoiceNo, invoiceDate: new Date(),
    customerId: header.customerId, salesOrderId: header.soId,
    customerSnapshot: { name: cust ? [cust.title, cust.name].filter(Boolean).join(" ") : hospital?.name ?? "Customer", organizationName: hospital?.name, organizationAddress: hospital?.address ?? undefined },
    billingAddress: hospital?.address ?? null,
    subtotal: money(total), grandTotal: money(total), costTotal: money(costTotal), profit: money(total - costTotal),
    status: "draft", notes: `Consignment usage — ${header.consignmentNo}`, createdBy: p.userId,
  } as typeof invoice.$inferInsert);
  await db.insert(invoiceItem).values(groups.map((g) => ({
    id: nanoid(), invoiceId, rowNo: g.rowNo, productId: g.productId, productCode: g.productCode, description: g.fullDescription,
    qty: String(g.qty), uom: g.uom, unitPrice: money(g.unitPrice), totalPrice: money(g.total),
    costUnitPrice: money(g.unitCost), costTotal: money(g.qty * g.unitCost),
  })) as (typeof invoiceItem.$inferInsert)[]);
  await db.insert(consignSettlement).values({
    id: settlementId, organizationId: p.ownerOrgId, consigneeType: "customer", customerId: header.customerId,
    invoiceId, total: money(total), createdBy: p.userId,
  });
  await db.update(consignEvent).set({ settlementId }).where(inArray(consignEvent.id, priced.map((l) => l.eventId)));
  return { settlementId, invoiceNo, total, lineCount: priced.length, skipped: all.filter((l) => l.unitPrice === null) };
}

/** Auto, per-use settlement right after a Case DO consumed consigned stock. */
export async function autoSettlePerUse(p: { agentOrgId: string; sourceId: string; sourceNo: string; userId: string }) {
  const owners = await db.selectDistinct({ ownerOrgId: consignEvent.organizationId }).from(consignEvent)
    .where(and(eq(consignEvent.sourceId, p.sourceId), eq(consignEvent.billable, true), isNull(consignEvent.settlementId)));
  for (const { ownerOrgId } of owners) {
    const [pair] = await db.select().from(consignPairSetting)
      .where(and(eq(consignPairSetting.ownerOrgId, ownerOrgId), eq(consignPairSetting.agentOrgId, p.agentOrgId))).limit(1);
    if (pair?.settlementMode === "auto" && pair.settlementFrequency === "per_use") {
      await settleAgent({ ownerOrgId, agentOrgId: p.agentOrgId, userId: p.userId, sourceId: p.sourceId, label: p.sourceNo });
    }
  }
}

/**
 * Monthly automatic settlement — for every owner → agent pair set to
 * "automatic, monthly", settle the previous calendar month. Idempotent:
 * settled events are stamped, so a second run in the same month finds
 * nothing. Called by the scheduler (app/api/cron/consignment-settlement).
 */
export async function runMonthlyAutoSettlements(now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 1);
  const label = from.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
  const pairs = await db.select().from(consignPairSetting)
    .where(and(eq(consignPairSetting.settlementMode, "auto"), eq(consignPairSetting.settlementFrequency, "monthly")));
  const results: { ownerOrgId: string; agentOrgId: string; invoiceNo?: string; poNo?: string; total?: number; skipped?: number; error?: string }[] = [];
  for (const pair of pairs) {
    try {
      // Documents are created in the name of the owner company's owner
      const [owner] = await db.select({ userId: member.userId }).from(member)
        .where(and(eq(member.organizationId, pair.ownerOrgId), eq(member.role, "owner"), isNull(member.deletedAt))).limit(1);
      const userId = pair.updatedBy ?? owner?.userId;
      if (!userId) { results.push({ ownerOrgId: pair.ownerOrgId, agentOrgId: pair.agentOrgId, error: "no user to create documents as" }); continue; }
      const res = await settleAgent({ ownerOrgId: pair.ownerOrgId, agentOrgId: pair.agentOrgId, userId, from, to, label });
      results.push({ ownerOrgId: pair.ownerOrgId, agentOrgId: pair.agentOrgId, invoiceNo: res?.invoiceNo, poNo: res?.poNo, total: res?.total ?? 0, skipped: res?.skipped.length ?? 0 });
    } catch (e) {
      results.push({ ownerOrgId: pair.ownerOrgId, agentOrgId: pair.agentOrgId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const partners = await db.select().from(consignPartner)
    .where(and(eq(consignPartner.settlementMode, "auto"), eq(consignPartner.settlementFrequency, "monthly"), eq(consignPartner.active, true)));
  const partnerResults: { partnerId: string; invoiceNos?: string[]; poNo?: string; total?: number; commission?: number; error?: string }[] = [];
  for (const partner of partners) {
    try {
      const [owner] = await db.select({ userId: member.userId }).from(member)
        .where(and(eq(member.organizationId, partner.organizationId), eq(member.role, "owner"), isNull(member.deletedAt))).limit(1);
      const userId = owner?.userId ?? partner.createdBy;
      const res = await settlePartner({ ownerOrgId: partner.organizationId, partnerId: partner.id, userId, from, to, label });
      partnerResults.push({ partnerId: partner.id, invoiceNos: res?.invoiceNos, poNo: res?.poNo, total: res?.total ?? 0, commission: res?.commission ?? 0 });
    } catch (e) {
      partnerResults.push({ partnerId: partner.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { period: label, results, partnerResults };
}

// ── External agents (partners) ───────────────────────────────────────────────

async function partnerCustomer(partner: Partner, userId: string) {
  if (partner.customerId) {
    const [c] = await db.select({ id: customer.id, name: customer.name }).from(customer).where(eq(customer.id, partner.customerId)).limit(1);
    if (c) return c;
  }
  const [c] = await db.insert(customer).values({
    id: nanoid(), organizationId: partner.organizationId, name: partner.name, organizationName: partner.name,
    email: partner.email, contactNo: partner.phone, createdBy: userId,
  } as typeof customer.$inferInsert).returning({ id: customer.id, name: customer.name });
  await db.update(consignPartner).set({ customerId: c.id }).where(eq(consignPartner.id, partner.id));
  return c;
}

async function partnerSupplier(partner: Partner, userId: string) {
  if (partner.supplierId) {
    const [s] = await db.select({ id: supplier.id }).from(supplier).where(eq(supplier.id, partner.supplierId)).limit(1);
    if (s) return s;
  }
  const [s] = await db.insert(supplier).values({
    id: nanoid(), organizationId: partner.organizationId, name: partner.name, contactPerson: partner.contactPerson,
    contactNo: partner.phone, email: partner.email, address: partner.address, createdBy: userId,
  } as typeof supplier.$inferInsert).returning({ id: supplier.id });
  await db.update(consignPartner).set({ supplierId: s.id }).where(eq(consignPartner.id, partner.id));
  return s;
}

export interface PartnerSettlementResult { settlementId: string; invoiceNos: string[]; poNo?: string; total: number; commission: number; lineCount: number; skipped: PricedLine[] }

/**
 * Dealer: one invoice to the dealer at its dealer price.
 * Sales agent: one invoice per hospital at the selling price + the
 * commission owed to the agent as a confirmed, value-only PO.
 */
export async function settlePartner(p: { ownerOrgId: string; partnerId: string; userId: string; from?: Date; to?: Date; sourceId?: string; label: string }): Promise<PartnerSettlementResult | null> {
  const [partner] = await db.select().from(consignPartner).where(and(eq(consignPartner.id, p.partnerId), eq(consignPartner.organizationId, p.ownerOrgId))).limit(1);
  if (!partner) return null;
  const priced = await priceUnsettled({ kind: "partner", ownerOrgId: p.ownerOrgId, partnerId: p.partnerId, from: p.from, to: p.to, sourceId: p.sourceId });
  const ready = priced.filter((l) => l.unitPrice !== null);
  const skipped = priced.filter((l) => l.unitPrice === null);
  if (!ready.length) return null;
  const settlementId = nanoid();
  const invoiceIds: string[] = [], invoiceNos: string[] = [];
  const notes = `Consignment ${partner.model === "dealer" ? "sell-through" : "usage"} — ${partner.name} — ${p.label}`;

  const makeInvoice = async (lines: PricedLine[], cust: { id: string | null; name: string; orgName?: string | null; address?: string | null }) => {
    const groups = groupLines(lines);
    const total = groups.reduce((s, g) => s + g.total, 0);
    const costTotal = groups.reduce((s, g) => s + g.qty * g.unitCost, 0);
    const invoiceNo = await nextInvoiceNo(p.ownerOrgId);
    const invoiceId = nanoid();
    await db.insert(invoice).values({
      id: invoiceId, organizationId: p.ownerOrgId, invoiceNo, invoiceDate: new Date(), customerId: cust.id,
      customerSnapshot: { name: cust.name, organizationName: cust.orgName ?? cust.name, organizationAddress: cust.address ?? undefined },
      billingAddress: cust.address ?? null,
      subtotal: money(total), grandTotal: money(total), costTotal: money(costTotal), profit: money(total - costTotal),
      status: "draft", notes, createdBy: p.userId,
    } as typeof invoice.$inferInsert);
    await db.insert(invoiceItem).values(groups.map((g) => ({
      id: nanoid(), invoiceId, rowNo: g.rowNo, productId: g.productId, productCode: g.productCode, description: g.fullDescription,
      qty: String(g.qty), uom: g.uom, unitPrice: money(g.unitPrice), totalPrice: money(g.total),
      costUnitPrice: money(g.unitCost), costTotal: money(g.qty * g.unitCost),
    })) as (typeof invoiceItem.$inferInsert)[]);
    invoiceIds.push(invoiceId); invoiceNos.push(invoiceNo);
    return total;
  };

  let total = 0, commission = 0;
  let poId: string | null = null, poNo: string | undefined;
  if (partner.model === "dealer") {
    const c = await partnerCustomer(partner, p.userId);
    total = await makeInvoice(ready, { id: c.id, name: partner.name, orgName: partner.name, address: partner.address });
  } else {
    // One invoice per hospital (and contact, when recorded)
    const byHospital = new Map<string, PricedLine[]>();
    for (const l of ready) {
      const k = `${l.endCustomerOrgId}|${l.endCustomerId ?? ""}`;
      byHospital.set(k, [...(byHospital.get(k) ?? []), l]);
    }
    for (const lines of byHospital.values()) {
      const { endCustomerOrgId, endCustomerId } = lines[0];
      const [h] = await db.select({ name: customerOrganization.name, address: customerOrganization.address }).from(customerOrganization).where(eq(customerOrganization.id, endCustomerOrgId!)).limit(1);
      const [c] = endCustomerId ? await db.select({ name: customer.name, title: customer.title }).from(customer).where(eq(customer.id, endCustomerId)).limit(1) : [];
      total += await makeInvoice(lines, {
        id: endCustomerId ?? null, name: c ? [c.title, c.name].filter(Boolean).join(" ") : h?.name ?? "Hospital",
        orgName: h?.name, address: h?.address,
      });
    }
    commission = Math.round(ready.reduce((s, l) => s + (l.commission ?? 0), 0) * 100) / 100;
    if (commission > 0) {
      const sup = await partnerSupplier(partner, p.userId);
      poId = nanoid(); poNo = await nextPoNo(p.ownerOrgId);
      await db.insert(purchaseOrder).values({
        id: poId, organizationId: p.ownerOrgId, poNo, supplierId: sup.id, subtotal: money(commission), grandTotal: money(commission),
        currency: "MYR", status: "confirmed", notes: `Commission ${partner.commissionPct}% — ${notes} (invoices ${invoiceNos.join(", ")}) — service, no goods receipt`,
        createdBy: p.userId, approvedBy: p.userId, approvedAt: new Date(),
      } as typeof purchaseOrder.$inferInsert);
      await db.insert(purchaseOrderItem).values({
        id: nanoid(), purchaseOrderId: poId, rowNo: 1,
        description: `Sales commission ${partner.commissionPct}% on ${money(total)} — ${p.label}`,
        qty: "1", unitPrice: money(commission), totalPrice: money(commission), currency: "MYR",
      } as typeof purchaseOrderItem.$inferInsert);
    }
  }

  await db.insert(consignSettlement).values({
    id: settlementId, organizationId: p.ownerOrgId, consigneeType: "partner", partnerId: partner.id,
    periodFrom: p.from ?? null, periodTo: p.to ?? null, invoiceId: invoiceIds[0] ?? null, invoiceIds,
    purchaseOrderId: poId, total: money(total), commissionTotal: commission ? money(commission) : null, createdBy: p.userId,
  });
  await db.update(consignEvent).set({ settlementId }).where(inArray(consignEvent.id, ready.map((l) => l.eventId)));
  return { settlementId, invoiceNos, poNo, total, commission, lineCount: ready.length, skipped };
}

/** Per-use automatic settlement right after a partner usage report. */
export async function autoSettlePartnerPerUse(p: { ownerOrgId: string; partnerId: string; sourceId: string; sourceNo: string; userId: string }) {
  const [partner] = await db.select().from(consignPartner).where(eq(consignPartner.id, p.partnerId)).limit(1);
  if (partner?.settlementMode === "auto" && partner.settlementFrequency === "per_use") {
    return settlePartner({ ownerOrgId: p.ownerOrgId, partnerId: p.partnerId, userId: p.userId, sourceId: p.sourceId, label: p.sourceNo });
  }
  return null;
}
