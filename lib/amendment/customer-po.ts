// Amending a customer PO whose sales order is already submitted or confirmed.
//
// The customer has changed their order. Instead of unwinding everything (cancel the PR, recall the
// supplier PO, recall the SO, re-enter it), the amendment is applied where things stand:
//   - the CPO's lines are changed, as a new revision (Rev 1, Rev 2…) with the reason;
//   - the SO's lines that came from this CPO are changed in place (same SO number, new revision),
//     its totals recalculated, and it goes back for approval (no DO until it's approved again);
//   - a supplier PO bought for it that nothing has been packed or received against yet has its lines
//     changed to match (same PO number, new revision: the supplier gets an amended PO);
//   - a PO to one of the owner's companies is also re-priced by its own pricing rule (e.g. the customer
//     PO price − 5%), and the change carries on to that company's customer PO and sales order (and
//     the POs it raised), as their own revision;
//   - anything that can't be done that way is listed for the user (new products to buy, a supplier
//     PO that has already shipped…).
// It's refused while something would be wrong: a quantity below what was already delivered, or an
// SO that has already been invoiced (that needs a credit note).
//
// Server-only: called from the server actions in server/customer-purchase-order.ts.

import { nanoid } from "nanoid";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customerPurchaseOrder,
  deliveryOrder,
  deliveryOrderItem,
  documentAmendment,
  goodsReceipt,
  invoice,
  organization,
  packingListItem,
  product,
  purchaseOrder,
  purchaseOrderCustomerPo,
  purchaseOrderItem,
  purchaseRequisition,
  salesOrder,
  salesOrderItem,
  supplier,
} from "@/db/schema";
import { soLineQty } from "@/lib/sales-order/set-qty";
import { bookSetPriceAsUnitPrice } from "@/lib/quotation-set-price";
import { discountFromQuotations, discountFromSaved, overallDiscountAmount } from "@/lib/sales-order/overall-discount";
import { adjustReservation } from "@/lib/inventory/create-movement";
import { createNotification, getSoApprovers } from "@/server/notifications";
import { priceIntercompanyLines, sumTotals } from "@/lib/intercompany/pricing";

type CpoRow = typeof customerPurchaseOrder.$inferSelect;
type SoItemRow = typeof salesOrderItem.$inferSelect;
type CpoLine = NonNullable<CpoRow["items"]>[number];

export type DocType = "cpo" | "so" | "po";

/** A whole document as it was at one revision: its header and its lines. */
export type DocSnapshot = { doc: Record<string, unknown>; items: Record<string, unknown>[] };

const snapshot = (doc: Record<string, unknown>, items: Record<string, unknown>[]): DocSnapshot => {
  const { items: _lines, ...header } = doc as Record<string, unknown> & { items?: unknown };
  void _lines;
  return JSON.parse(JSON.stringify({ doc: header, items }));
};

export type AmendLineChange = {
  productCode: string | null;
  description: string | null;
  oldQty: number;
  newQty: number;
  oldTotal: number;
  newTotal: number;
  delivered: number;
  change: "added" | "removed" | "changed";
};

export type PoAction = {
  poId: string;
  poNo: string;
  supplierName: string | null;
  poItemId: string;
  productCode: string;
  description: string | null;
  fromQty: number;
  toQty: number;
  /** Unit price before / after (only a PO to one of your companies is re-priced) */
  fromPrice: number;
  toPrice: number;
  /** Changed on the supplier PO by the amendment (else the user does it, see why) */
  auto: boolean;
  why?: string;
};

export type AmendmentPlan = {
  cpoNo: string;
  cpoRevision: number;
  so: { id: string; soNo: string; status: string; revision: number; oldTotal: number; newTotal: number };
  /** false: the customer PO and SO lines and total stay as they are (only supplier POs are re-priced) */
  soChanged: boolean;
  lines: AmendLineChange[];
  poActions: PoAction[];
  /** What the user has to do by hand */
  followUps: string[];
  /** Orders to your own companies that carry the change on (their customer PO and sales order follow) */
  chain: string[];
  /** Why it can't be applied (empty: it can) */
  blockers: string[];
};

type SoOps = {
  update: { id: string; set: Partial<typeof salesOrderItem.$inferInsert> }[];
  insert: (typeof salesOrderItem.$inferInsert)[];
  remove: string[];
};

export type AmendmentWork = {
  plan: AmendmentPlan;
  so: typeof salesOrder.$inferSelect;
  oldSoItems: SoItemRow[];
  soOps: SoOps;
  soTotals: { subtotal: string; overallDiscountPct: string; overallDiscountAmt: string; sst: string; grandTotal: string };
};

const LOCKING = new Set(["submitted", "confirmed", "fulfilled"]);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const keyOf = (l: { productCode?: string | null; description?: string | null }) =>
  norm(l.productCode) ? `c:${norm(l.productCode)}` : `d:${norm(l.description)}`;
const num = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const money = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lineTotal = (l: { totalPrice?: string | null; setGroupId?: string | null; setQty?: string | null }) =>
  num(l.totalPrice) * (l.setGroupId ? num(l.setQty) || 1 : 1);

/** The revision a document would get next (1 for its first amendment). */
export async function nextRevision(docType: DocType, docId: string): Promise<number> {
  try {
    const [r] = await db
      .select({ n: sql<number>`coalesce(max(${documentAmendment.revision}), 0)::int` })
      .from(documentAmendment)
      .where(and(eq(documentAmendment.docType, docType), eq(documentAmendment.docId, docId)));
    return (r?.n ?? 0) + 1;
  } catch {
    throw new Error("Amendments aren't set up on this database yet (migration 0099_document_amendment).");
  }
}

/** A document's current revision (0: never amended). Never throws (an old database just says 0). */
export async function currentRevision(docType: DocType, docId: string): Promise<number> {
  try {
    return (await nextRevision(docType, docId)) - 1;
  } catch {
    return 0;
  }
}

// The SO line a CPO line becomes (same as the create-SO form does), before it's matched to the SO.
function soLineFromCpo(i: CpoLine) {
  const qty = num(i.qty);
  const unit = num(i.unitPrice);
  const disc = num(i.discountPct);
  const gross = qty * unit;
  const discAmt = (gross * disc) / 100;
  return {
    productCode: i.productCode || null,
    description: (i.description ?? "").toUpperCase() || null,
    qty: i.qty || "1",
    uom: i.uom || null,
    unitPrice: i.unitPrice || "0",
    discountPct: i.discountPct || "0",
    discountAmt: discAmt.toFixed(2),
    totalPrice: (gross - discAmt).toFixed(2),
    lineType: i.lineType || "sell",
    setGroupId: i.setGroupId || null,
    setGroupLabel: i.setGroupLabel || null,
    setQty: i.setQty || null,
    cpoDescription: i.cpoDescription || null,
    setCpoTitle: i.setCpoTitle || null,
    customerId: i.customerId || null,
    customerName: i.customerName || null,
    customerOrganization: i.customerOrganization || null,
    customerOrganizationId: i.customerOrganizationId || null,
  };
}

/**
 * What amending `cpo` to `newItems` (and its discount) would do. Nothing is saved.
 * newDiscount: the CPO's overall discount after the amendment (undefined: unchanged).
 */
export async function planCustomerPoAmendment(
  cpo: CpoRow,
  newItems: CpoLine[],
  newDiscount?: { pct: string | null; amt: string | null },
  // cascade: the CPO a sibling company got from our PO, following our amendment (its SO may not be submitted yet)
  opts: { cascade?: boolean } = {},
): Promise<AmendmentWork> {
  const orgId = cpo.organizationId;
  if (!cpo.salesOrderId) throw new Error("This customer PO has no sales order: edit it normally.");
  const [so] = await db.select().from(salesOrder).where(eq(salesOrder.id, cpo.salesOrderId));
  if (!so || so.status === "cancelled" || (!opts.cascade && !LOCKING.has(so.status))) {
    throw new Error("Its sales order isn't submitted yet: edit the customer PO (and the sales order) normally.");
  }

  const blockers: string[] = [];
  const followUps: string[] = [];
  if (so.status === "fulfilled") blockers.push(`${so.soNo} has been fully delivered: an amendment after delivery needs a return or a new order.`);
  const invs = await db
    .select({ invoiceNo: invoice.invoiceNo })
    .from(invoice)
    .where(and(eq(invoice.salesOrderId, so.id), ne(invoice.status, "cancelled")));
  if (invs.length > 0) blockers.push(`${so.soNo} has been invoiced (${invs.map((i) => i.invoiceNo).join(", ")}): cancel the invoice, or issue a credit note, before amending.`);

  // the SO's lines, and the ones that came from this CPO (an older SO may not have tagged them)
  const oldSoItems = await db.select().from(salesOrderItem).where(eq(salesOrderItem.salesOrderId, so.id)).orderBy(asc(salesOrderItem.rowNo));
  const linkedCpoIds = new Set([
    ...((so.customerPoLinks as { customerPoId: string }[] | null) ?? []).map((l) => l.customerPoId),
    ...(so.customerPoId ? [so.customerPoId] : []),
  ]);
  let mine = oldSoItems.filter((i) => i.sourceCustomerPoId === cpo.id);
  if (mine.length === 0 && linkedCpoIds.size <= 1) mine = oldSoItems;
  const mineIds = new Set(mine.map((i) => i.id));
  const others = oldSoItems.filter((i) => !mineIds.has(i.id));

  // delivered so far, per SO line
  const delivered = new Map<string, number>();
  if (oldSoItems.length > 0) {
    const rows = await db
      .select({ soItemId: deliveryOrderItem.soItemId, total: sql<string>`coalesce(sum(${deliveryOrderItem.qty}::numeric), 0)::text` })
      .from(deliveryOrderItem)
      .innerJoin(deliveryOrder, eq(deliveryOrder.id, deliveryOrderItem.deliveryOrderId))
      .where(and(eq(deliveryOrder.salesOrderId, so.id), ne(deliveryOrder.status, "cancelled")))
      .groupBy(deliveryOrderItem.soItemId);
    for (const r of rows) if (r.soItemId) delivered.set(r.soItemId, num(r.total));
  }

  // new SO lines from the amended CPO lines (a set priced as a whole carries its price on its first line)
  const newLines = bookSetPriceAsUnitPrice(newItems.filter((i) => !i._excluded)).map(soLineFromCpo);

  // match them to the SO's lines: same product code (or description), in order
  const queues = new Map<string, SoItemRow[]>();
  for (const o of mine) {
    const k = keyOf(o);
    queues.set(k, [...(queues.get(k) ?? []), o]);
  }
  const ops: SoOps = { update: [], insert: [], remove: [] };
  const after: (Pick<SoItemRow, "productCode" | "description" | "qty" | "totalPrice" | "setGroupId" | "setQty" | "sourceCustomerPoId">)[] = [...others];
  const rowNos = mine.map((m) => m.rowNo);
  let nextRow = Math.max(0, ...oldSoItems.map((i) => i.rowNo)) + 1;

  // product ids for codes the SO didn't have
  const newCodes = [...new Set(newLines.map((l) => l.productCode?.trim()).filter((c): c is string => !!c))];
  const prods = newCodes.length
    ? await db.select({ id: product.id, code: product.productCode }).from(product).where(and(eq(product.organizationId, orgId), inArray(product.productCode, newCodes)))
    : [];
  const productIdOf = new Map(prods.map((p) => [p.code, p.id]));

  newLines.forEach((nl, idx) => {
    const k = keyOf(nl);
    const old = queues.get(k)?.shift();
    const rowNo = rowNos[idx] ?? nextRow++;
    const common = {
      qty: nl.qty, uom: nl.uom ?? undefined, unitPrice: nl.unitPrice, discountPct: nl.discountPct, discountAmt: nl.discountAmt,
      totalPrice: nl.totalPrice, setGroupId: nl.setGroupId, setGroupLabel: nl.setGroupLabel, setQty: nl.setQty,
      cpoDescription: nl.cpoDescription, setCpoTitle: nl.setCpoTitle, rowNo,
    };
    if (old) {
      // the SO keeps its own description, product link and sourcing details
      ops.update.push({ id: old.id, set: common });
      after.push({ ...old, ...common });
      const done = delivered.get(old.id) ?? 0;
      const newQty = soLineQty(nl);
      if (newQty + 1e-9 < done) blockers.push(`${old.productCode || old.description}: ${qtyText(done)} already delivered, more than the ${qtyText(newQty)} the amendment asks for.`);
    } else {
      const row = {
        id: nanoid(),
        salesOrderId: so.id,
        productId: (nl.productCode && productIdOf.get(nl.productCode.trim())) || null,
        productCode: nl.productCode,
        description: nl.description,
        lineType: nl.lineType,
        sourceCustomerPoId: cpo.id,
        sourceCustomerPoNo: cpo.customerPoNo,
        customerId: nl.customerId,
        customerName: nl.customerName,
        customerOrganization: nl.customerOrganization,
        customerOrganizationId: nl.customerOrganizationId,
        isAdditional: false,
        ...common,
      };
      ops.insert.push(row);
      after.push(row);
    }
  });
  for (const rest of queues.values()) {
    for (const o of rest) {
      ops.remove.push(o.id);
      const done = delivered.get(o.id) ?? 0;
      if (done > 0) blockers.push(`${o.productCode || o.description}: ${qtyText(done)} already delivered, it can't be removed.`);
    }
  }

  // the changes per product, as quantities to buy / deliver (× the number of sets)
  const sum = (ls: typeof after, f: (l: (typeof after)[number]) => number) => ls.reduce((s, l) => s + f(l), 0);
  const keys = new Set([...mine.map(keyOf), ...newLines.map(keyOf)]);
  const mineAfter = after.filter((l) => !others.includes(l as SoItemRow));
  const lines: AmendLineChange[] = [];
  const deltaByKey = new Map<string, number>();
  for (const k of keys) {
    const o = mine.filter((l) => keyOf(l) === k);
    const n = mineAfter.filter((l) => keyOf(l) === k);
    const oldQty = sum(o, (l) => soLineQty(l));
    const newQty = sum(n, (l) => soLineQty(l));
    const oldTotal = sum(o, lineTotal);
    const newTotal = sum(n, lineTotal);
    deltaByKey.set(k, newQty - oldQty);
    if (Math.abs(oldQty - newQty) < 1e-9 && Math.abs(oldTotal - newTotal) < 0.005) continue;
    const ref = n[0] ?? o[0];
    lines.push({
      productCode: ref.productCode ?? null,
      description: ref.description ?? null,
      oldQty, newQty, oldTotal, newTotal,
      delivered: o.reduce((s, l) => s + (delivered.get((l as SoItemRow).id) ?? 0), 0),
      change: o.length === 0 ? "added" : n.length === 0 ? "removed" : "changed",
    });
  }

  // the SO's totals after the amendment
  const subtotal = sum(after, lineTotal);
  const cpoDiscounts = linkedCpoIds.size > 0
    ? await db
        .select({ id: customerPurchaseOrder.id, pct: customerPurchaseOrder.overallDiscountPct, amt: customerPurchaseOrder.overallDiscountAmt })
        .from(customerPurchaseOrder)
        .where(inArray(customerPurchaseOrder.id, [...linkedCpoIds]))
    : [];
  const withNew = cpoDiscounts.map((c) => (c.id === cpo.id && newDiscount ? { ...c, pct: newDiscount.pct, amt: newDiscount.amt } : c));
  // every linked CPO recorded its discount: the SO's follows them; otherwise the SO keeps its own
  const disc = withNew.length > 0 && withNew.every((c) => c.pct != null || c.amt != null)
    ? discountFromQuotations(
        after.map((l) => ({ sourceQuotationId: l.sourceCustomerPoId, totalPrice: String(lineTotal(l)) })),
        withNew.map((c) => ({ id: c.id, discountPct: c.pct ?? "0", discountAmt: c.amt ?? "0" })),
      )
    : discountFromSaved(so.overallDiscountPct, so.overallDiscountAmt);
  const discAmt = overallDiscountAmount(subtotal, disc);
  const sst = ((subtotal - discAmt) * num(so.sstPct)) / 100;
  const grand = subtotal - discAmt + sst;
  const soTotals = {
    subtotal: subtotal.toFixed(2),
    overallDiscountPct: disc.mode === "pct" ? disc.pct : "0",
    overallDiscountAmt: discAmt.toFixed(2),
    sst: sst.toFixed(2),
    grandTotal: grand.toFixed(2),
  };

  // the supplier POs bought for this SO, and which of them can still be amended
  const prIds = (await db.select({ id: purchaseRequisition.id }).from(purchaseRequisition).where(eq(purchaseRequisition.salesOrderId, so.id))).map((r) => r.id);
  const pos = await db
    .select({
      id: purchaseOrder.id, poNo: purchaseOrder.poNo, status: purchaseOrder.status, supplierId: purchaseOrder.supplierId,
      supplierSnapshot: purchaseOrder.supplierSnapshot, createdAt: purchaseOrder.createdAt,
      pricingMethod: purchaseOrder.pricingMethod, pricingMarginPct: purchaseOrder.pricingMarginPct, originalSupplierName: purchaseOrder.originalSupplierName,
    })
    .from(purchaseOrder)
    .where(and(
      eq(purchaseOrder.organizationId, orgId),
      ne(purchaseOrder.status, "cancelled"),
      prIds.length ? or(eq(purchaseOrder.salesOrderId, so.id), inArray(purchaseOrder.purchaseRequisitionId, prIds)) : eq(purchaseOrder.salesOrderId, so.id),
    ))
    .orderBy(asc(purchaseOrder.createdAt));
  const poIds = pos.map((p) => p.id);
  const [poItems, packed, received, sups] = poIds.length
    ? await Promise.all([
        db.select().from(purchaseOrderItem).where(inArray(purchaseOrderItem.purchaseOrderId, poIds)).orderBy(asc(purchaseOrderItem.rowNo)),
        db.selectDistinct({ id: packingListItem.purchaseOrderId }).from(packingListItem).where(inArray(packingListItem.purchaseOrderId, poIds)),
        db.selectDistinct({ id: goodsReceipt.purchaseOrderId }).from(goodsReceipt).where(and(inArray(goodsReceipt.purchaseOrderId, poIds), ne(goodsReceipt.status, "recalled"))),
        db.select({ id: supplier.id, linked: supplier.linkedOrganizationId }).from(supplier).where(inArray(supplier.id, pos.map((p) => p.supplierId).filter((v): v is string => !!v))),
      ])
    : [[], [], [], []];
  const packedSet = new Set(packed.map((r) => r.id));
  const receivedSet = new Set(received.map((r) => r.id));
  const sellerOf = new Map(sups.filter((s) => s.linked).map((s) => [s.id, s.linked as string]));
  const whyNot = (p: (typeof pos)[number]): string | undefined =>
    receivedSet.has(p.id) ? "goods have been received against it"
      : packedSet.has(p.id) ? "the supplier has packed it already"
      : undefined;

  const poActions: PoAction[] = [];
  for (const [k, delta] of deltaByKey) {
    if (Math.abs(delta) < 1e-9 || !k.startsWith("c:")) continue;
    const onPo = poItems.filter((i) => `c:${norm(i.productCode)}` === k);
    const po = (id: string) => pos.find((p) => p.id === id)!;
    const act = (it: (typeof poItems)[number], toQty: number) => {
      const p = po(it.purchaseOrderId);
      const why = whyNot(p);
      poActions.push({
        poId: p.id, poNo: p.poNo ?? "", supplierName: (p.supplierSnapshot as { name?: string } | null)?.name ?? null,
        poItemId: it.id, productCode: it.productCode ?? "", description: it.description,
        fromQty: num(it.qty), toQty, fromPrice: num(it.unitPrice), toPrice: num(it.unitPrice), auto: !why, why,
      });
    };
    if (delta > 0) {
      const target = onPo.find((i) => !whyNot(po(i.purchaseOrderId))) ?? onPo[0];
      if (target) act(target, num(target.qty) + delta);
      else if ((mine.some((l) => keyOf(l) === k))) {
        // ordered from stock or not bought yet: the stock check on approval (or a PR) covers it
      } else {
        const l = newLines.find((x) => keyOf(x) === k);
        followUps.push(`${l?.productCode ?? k.slice(2)} is new on the order (${qtyText(delta)}): raise a PR for it if it isn't in stock.`);
      }
    } else {
      let left = -delta;
      for (const it of [...onPo].reverse()) {
        if (left <= 1e-9) break;
        const take = Math.min(left, num(it.qty));
        act(it, num(it.qty) - take);
        left -= take;
      }
    }
  }
  // a PO to one of your companies, priced from the customer PO (or another rule): priced again, with the amended lines
  const chain: string[] = [];
  for (const p of pos) {
    const sellerOrgId = p.supplierId ? sellerOf.get(p.supplierId) : undefined;
    if (!sellerOrgId || whyNot(p)) continue;
    const mineOnPo = poItems.filter((i) => i.purchaseOrderId === p.id);
    const lines = mineOnPo
      .map((i) => {
        const a = poActions.find((x) => x.poItemId === i.id);
        return { ...i, qty: a ? qtyText(a.toQty) : i.qty };
      })
      .filter((i) => num(i.qty) > 1e-9);
    const linkedCpos = await db
      .select({ id: purchaseOrderCustomerPo.customerPoId })
      .from(purchaseOrderCustomerPo)
      .where(eq(purchaseOrderCustomerPo.purchaseOrderId, p.id));
    const priced = await priceIntercompanyLines(
      sellerOrgId, orgId, lines,
      { method: p.pricingMethod, marginPct: p.pricingMarginPct },
      linkedCpos.map((c) => c.id), p.originalSupplierName,
      { id: cpo.id, items: newItems },
    );
    let changed = poActions.some((a) => a.poId === p.id);
    priced.lines.forEach((l) => {
      const before = mineOnPo.find((i) => i.id === l.id)!;
      const toPrice = num(l.unitPrice);
      if (Math.abs(toPrice - num(before.unitPrice)) < 0.005) return;
      changed = true;
      const a = poActions.find((x) => x.poItemId === l.id);
      if (a) a.toPrice = toPrice;
      else poActions.push({
        poId: p.id, poNo: p.poNo ?? "", supplierName: (p.supplierSnapshot as { name?: string } | null)?.name ?? null,
        poItemId: l.id, productCode: l.productCode ?? "", description: l.description,
        fromQty: num(before.qty), toQty: num(before.qty), fromPrice: num(before.unitPrice), toPrice, auto: true,
      });
    });
    if (changed) {
      const [ic] = await db
        .select({ soNo: salesOrder.soNo, orgName: organization.name })
        .from(salesOrder)
        .leftJoin(organization, eq(organization.id, salesOrder.organizationId))
        .where(and(eq(salesOrder.sourcePurchaseOrderId, p.id), ne(salesOrder.status, "cancelled")))
        .limit(1);
      chain.push(ic
        ? `${p.poNo} → ${ic.orgName ?? "the other company"}: its customer PO ${p.poNo} and sales order ${ic.soNo} are amended to match.`
        : `${p.poNo}: ${(p.supplierSnapshot as { name?: string } | null)?.name ?? "the other company"} has no sales order for it yet.`);
    }
  }

  for (const a of poActions.filter((x) => !x.auto)) {
    followUps.push(`${a.poNo} (${a.supplierName ?? "supplier"}) can't be amended here because ${a.why}: ${a.productCode} ${qtyText(a.fromQty)} → ${qtyText(a.toQty)}, arrange it with the supplier.`);
  }

  const plan: AmendmentPlan = {
    cpoNo: cpo.customerPoNo,
    cpoRevision: (await currentRevision("cpo", cpo.id)) + 1,
    so: { id: so.id, soNo: so.soNo, status: so.status, revision: (await currentRevision("so", so.id)) + 1, oldTotal: num(so.grandTotal), newTotal: grand },
    lines,
    poActions,
    followUps,
    chain,
    blockers,
    soChanged: lines.length > 0 || Math.abs(num(so.grandTotal) - grand) >= 0.005,
  };
  if (!plan.soChanged && poActions.length === 0) blockers.push("Nothing to amend: the lines and amount are the same as the sales order's.");
  return { plan, so, oldSoItems, soOps: ops, soTotals };
}

const lineSummary = (l: AmendLineChange) => {
  const what = l.productCode || l.description || "line";
  if (l.change === "added") return `${what}: added, ${qtyText(l.newQty)} (${money(l.newTotal)})`;
  if (l.change === "removed") return `${what}: removed (was ${qtyText(l.oldQty)}, ${money(l.oldTotal)})`;
  return `${what}: ${qtyText(l.oldQty)} → ${qtyText(l.newQty)}, ${money(l.oldTotal)} → ${money(l.newTotal)}`;
};

/**
 * Records the CPO's own revision. before: the CPO as it was (the version this revision replaces);
 * docNo: its number now. Returns the record's id.
 */
export async function recordCpoAmendment(before: CpoRow, userId: string, reason: string, plan: AmendmentPlan, docNo = before.customerPoNo): Promise<string> {
  const id = nanoid();
  await db.insert(documentAmendment).values({
    id, organizationId: before.organizationId, docType: "cpo", docId: before.id, docNo,
    revision: plan.cpoRevision, reason, sourceAmendmentId: id,
    changes: { summary: plan.lines.map(lineSummary), before: snapshot(before as unknown as Record<string, unknown>, (before.items ?? []) as unknown as Record<string, unknown>[]) },
    createdBy: userId,
  });
  return id;
}

/**
 * Applies the amendment to the SO and the chosen supplier POs (amendPoIds; only those that can be),
 * and records their revisions. The SO goes back for approval.
 */
export async function applyAmendmentDownstream(
  work: AmendmentWork,
  userId: string,
  reason: string,
  amendPoIds: string[],
  sourceAmendmentId: string,
  depth = 0,
): Promise<{ soRevision: number; amendedPos: { poNo: string; revision: number }[]; chain: string[] }> {
  const { so, plan, soOps, soTotals, oldSoItems } = work;
  const orgId = so.organizationId;
  // an SO that was submitted or approved goes back for approval; one not submitted yet stays as it is
  const relock = LOCKING.has(so.status);

  // the stock it held is released: it's reserved again when the SO is approved
  if (plan.soChanged && relock && so.stockReservationStatus === "reserved") {
    for (const i of oldSoItems) {
      if (i.productId) await adjustReservation({ orgId, productId: i.productId, warehouseLabel: "Default", delta: -soLineQty(i) });
    }
  }

  // nothing changed on the SO (only supplier POs are re-priced): it keeps its lines, revision and approval
  if (plan.soChanged) {
  for (const u of soOps.update) await db.update(salesOrderItem).set(u.set).where(eq(salesOrderItem.id, u.id));
  if (soOps.insert.length) await db.insert(salesOrderItem).values(soOps.insert);
  if (soOps.remove.length) await db.delete(salesOrderItem).where(inArray(salesOrderItem.id, soOps.remove));

  await db.update(salesOrder).set({
    ...soTotals,
    // back for approval (same number): no DO until it's approved again
    ...(relock && {
      status: "submitted",
      submittedBy: userId,
      submittedAt: new Date(),
      approvedBy: null,
      approvedAt: null,
      stockReservationStatus: null,
      stockReservedAt: null,
      stockReservedBy: null,
    }),
  }).where(eq(salesOrder.id, so.id));

  await db.insert(documentAmendment).values({
    id: nanoid(), organizationId: orgId, docType: "so", docId: so.id, docNo: so.soNo,
    revision: plan.so.revision, reason, sourceAmendmentId,
    changes: {
      summary: [...plan.lines.map(lineSummary), `Total ${money(plan.so.oldTotal)} → ${money(plan.so.newTotal)}`, `From customer PO ${plan.cpoNo} Rev ${plan.cpoRevision}`],
      before: snapshot(so as unknown as Record<string, unknown>, oldSoItems as unknown as Record<string, unknown>[]),
    },
    createdBy: userId,
  });
  }

  // the supplier POs that can still be changed: same number, new revision
  const amendedPos: { poNo: string; revision: number }[] = [];
  const chain: string[] = [];
  const chosen = plan.poActions.filter((a) => a.auto && amendPoIds.includes(a.poId));
  for (const poId of [...new Set(chosen.map((a) => a.poId))]) {
    const acts = chosen.filter((a) => a.poId === poId);
    // the PO as it was, kept with its revision
    const [poBefore] = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, poId));
    const poItemsBefore = await db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, poId)).orderBy(asc(purchaseOrderItem.rowNo));
    for (const a of acts) {
      if (a.toQty <= 1e-9) {
        await db.delete(purchaseOrderItem).where(eq(purchaseOrderItem.id, a.poItemId));
      } else {
        await db.update(purchaseOrderItem)
          .set({ qty: qtyText(a.toQty), unitPrice: a.toPrice.toFixed(2), totalPrice: (a.toQty * a.toPrice).toFixed(2) })
          .where(eq(purchaseOrderItem.id, a.poItemId));
      }
    }
    const [po] = await db.select({ sstPct: purchaseOrder.sstPct }).from(purchaseOrder).where(eq(purchaseOrder.id, poId));
    const items = await db.select({ totalPrice: purchaseOrderItem.totalPrice }).from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, poId));
    const t = sumTotals(items, po?.sstPct);
    await db.update(purchaseOrder).set({ subtotal: t.subtotal, sst: t.sst, grandTotal: t.grandTotal }).where(eq(purchaseOrder.id, poId));
    const revision = await nextRevision("po", poId);
    await db.insert(documentAmendment).values({
      id: nanoid(), organizationId: orgId, docType: "po", docId: poId, docNo: acts[0].poNo,
      revision, reason, sourceAmendmentId,
      changes: { summary: [
        ...acts.map((a) => {
          if (a.toQty <= 1e-9) return `${a.productCode}: removed (was ${qtyText(a.fromQty)})`;
          const q = Math.abs(a.fromQty - a.toQty) > 1e-9 ? ` ${qtyText(a.fromQty)} → ${qtyText(a.toQty)}` : "";
          const pr = Math.abs(a.fromPrice - a.toPrice) >= 0.005 ? ` @ ${money(a.fromPrice)} → ${money(a.toPrice)}` : "";
          return `${a.productCode}:${q}${pr}`;
        }),
        plan.soChanged ? `For ${so.soNo} Rev ${plan.so.revision} (customer PO ${plan.cpoNo} Rev ${plan.cpoRevision})` : `Re-priced for ${so.soNo} (customer PO ${plan.cpoNo})`,
      ], before: poBefore ? snapshot(poBefore as unknown as Record<string, unknown>, poItemsBefore as unknown as Record<string, unknown>[]) : undefined },
      createdBy: userId,
    });
    amendedPos.push({ poNo: acts[0].poNo, revision });
    // a PO to one of your companies: its customer PO and sales order follow
    chain.push(...(await cascadeToSibling(poId, userId, reason, depth)));
  }

  return { soRevision: plan.soChanged ? plan.so.revision : plan.so.revision - 1, amendedPos, chain };
}

// Our PO to a sibling company was amended: the customer PO it became there (and its sales order, and
// the POs that company raised) follows it, as their own revision.
async function cascadeToSibling(poId: string, userId: string, reason: string, depth: number): Promise<string[]> {
  if (depth >= 3) return [];
  const [icSo] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.sourcePurchaseOrderId, poId), ne(salesOrder.status, "cancelled")))
    .limit(1);
  if (!icSo?.customerPoId) return [];
  const [[icCpo], [po], [org]] = await Promise.all([
    db.select().from(customerPurchaseOrder).where(eq(customerPurchaseOrder.id, icSo.customerPoId)),
    db.select({ poNo: purchaseOrder.poNo, grandTotal: purchaseOrder.grandTotal }).from(purchaseOrder).where(eq(purchaseOrder.id, poId)),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, icSo.organizationId)),
  ]);
  if (!icCpo || !po) return [];
  const orgName = org?.name ?? "The other company";

  // its lines are our PO's lines: match them by product code, in order
  const poLines = await db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, poId)).orderBy(asc(purchaseOrderItem.rowNo));
  const queue = new Map<string, typeof poLines>();
  for (const l of poLines) queue.set(norm(l.productCode), [...(queue.get(norm(l.productCode)) ?? []), l]);
  const newItems: CpoLine[] = (icCpo.items ?? []).flatMap((i) => {
    const l = queue.get(norm(i.productCode))?.shift();
    return l ? [{ ...i, qty: l.qty ?? "1", unitPrice: l.unitPrice ?? "0", discountPct: "0", totalPrice: l.totalPrice ?? "0" }] : [];
  });

  let work: AmendmentWork;
  try {
    work = await planCustomerPoAmendment(icCpo, newItems, undefined, { cascade: true });
  } catch (e) {
    return [`${orgName}: ${icSo.soNo} wasn't updated (${e instanceof Error ? e.message : "error"}). Update it there.`];
  }
  const blockers = work.plan.blockers.filter((b) => !b.startsWith("Nothing to amend"));
  if (blockers.length > 0) return [`${orgName}: ${icSo.soNo} wasn't updated: ${blockers.join(" ")}`];
  if (work.plan.blockers.length > 0) return []; // nothing changed for it

  await db.update(customerPurchaseOrder).set({ items: newItems, amount: po.grandTotal }).where(eq(customerPurchaseOrder.id, icCpo.id));
  const cpoAmendmentId = work.plan.soChanged ? await recordCpoAmendment(icCpo, userId, reason, work.plan) : nanoid();
  const autoPoIds = [...new Set(work.plan.poActions.filter((a) => a.auto).map((a) => a.poId))];
  const down = await applyAmendmentDownstream(work, userId, reason, autoPoIds, cpoAmendmentId, depth + 1);

  // its approvers: the SO is back for approval there
  if (work.plan.soChanged && LOCKING.has(icSo.status)) {
    const approvers = await getSoApprovers(icSo.organizationId).catch(() => [] as string[]);
    await Promise.all(approvers.filter((u) => u !== userId).map((u) => createNotification({
      organizationId: icSo.organizationId, userId: u, type: "so:submitted",
      title: `SO ${icSo.soNo} amended (Rev ${down.soRevision}) — needs approval`,
      body: `Customer PO ${icCpo.customerPoNo} was amended: ${reason}`,
      link: `/dashboard/sales/order/${icSo.id}`,
    }).catch(() => {})));
  }
  const pos = down.amendedPos.map((x) => `${x.poNo} Rev ${x.revision}`).join(", ");
  return [
    `${orgName}: customer PO ${icCpo.customerPoNo} Rev ${work.plan.cpoRevision}, sales order ${icSo.soNo} Rev ${down.soRevision}${pos ? `, ${pos}` : ""}`,
    ...down.chain,
    ...work.plan.followUps.map((f) => `${orgName}: ${f}`),
  ];
}

export type AmendmentRecord = {
  id: string; revision: number; reason: string; summary: string[]; createdAt: Date; createdByName: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
/** A kept snapshot's dates are text (JSON): back to Date for the PDFs. */
export function reviveDates<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && ISO.test(v) ? new Date(v) : v])) as T;
}

/**
 * A document as it was at revision `rev` (kept by the next amendment), for printing an old version.
 * null: that's the current version, or it wasn't kept.
 */
export async function versionSnapshot(docType: DocType, docId: string, rev: number): Promise<DocSnapshot | null> {
  try {
    const [r] = await db
      .select({ changes: documentAmendment.changes })
      .from(documentAmendment)
      .where(and(eq(documentAmendment.docType, docType), eq(documentAmendment.docId, docId), eq(documentAmendment.revision, rev + 1)))
      .limit(1);
    return (r?.changes?.before as DocSnapshot | undefined) ?? null;
  } catch {
    return null;
  }
}
