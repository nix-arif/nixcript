"use server";

/**
 * Consignment module (model B) — the ONE place that moves consigned stock.
 * Agent consignment (owner company → sibling company / its specialist) and
 * customer consignment (owner → hospital) run on the same rules:
 *
 *   send     owner warehouse → consignment location   (stock stays the owner's)
 *   consume  location → out; ownership passes; billable   (phase 2: Case DO)
 *   return   location → owner warehouse
 *   adjust   location → out after a count (lost / damaged / expired)
 *
 * All stock rows stay under the owner's organization_id; the location is the
 * warehouse label (lib/consignment/labels.ts). User-facing failures are
 * RETURNED as { ok:false, title, details } — Next.js hides thrown
 * server-action messages in production.
 */

import { db } from "@/db";
import {
  consignHeader, consignLine, consignEvent, consignSetting, consignPairSetting, consignCounter,
  stockLevel, stockLot, assetUnit, product, organization, organizationProfile,
  member, user, customer, customerOrganization, salesOrder, consignSettlement, consignPriceItem, invoice, purchaseOrder,
  consignPartner, consignPartnerPriceItem, stockMovement,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { moveStock, consumeConsigned, recordMachineUse } from "@/lib/consignment/engine";
import { LENDABLE_USES } from "@/lib/inventory/constants";
import { autoSettlePartnerPerUse, priceUnsettled, settleAgent, settleCustomer, settlePartner, type PricedLine } from "@/lib/consignment/settle";
import { MOVEMENT_TYPE, ASSET_UNIT_STATUS } from "@/lib/inventory/constants";
import { agentLocation, agentRepLocation, customerLocation, partnerLocation, parseLocation } from "@/lib/consignment/labels";
import { getOrgGroupIds, nextFreeDocNo } from "@/lib/document-number-group";
import { groupIdsByProduct } from "@/lib/inventory/item-groups";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";

// ── Types ────────────────────────────────────────────────────────────────────

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; title: string; details?: string[] };

export interface ConsignItemInput {
  productId: string;
  qty: number;          // ignored for serial-tracked products (count of unitIds)
  lotNo?: string | null;
  unitIds?: string[];   // serial-tracked products
}

export interface CreateConsignmentInput {
  consigneeType: "agent" | "customer" | "partner";
  agentOrgId?: string;
  partnerId?: string;
  agentRepId?: string | null;
  customerId?: string | null;
  customerOrgId?: string;
  soId?: string | null;
  sourceWarehouseLabel: string;
  sentDate?: string;     // yyyy-mm-dd
  reviewDate?: string | null;
  notes?: string;
  items: ConsignItemInput[];
}

// ── Access ───────────────────────────────────────────────────────────────────

async function ctx(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission for this consignment action");
  return { orgId, userId: session.user.id, perms };
}

function fail(title: string, details?: string[]): { ok: false; title: string; details?: string[] } {
  return details?.length ? { ok: false, title, details } : { ok: false, title };
}

async function guarded<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Something went wrong");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const num = (s: string | null | undefined) => parseFloat(s ?? "0") || 0;
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

async function getWarehouseLabels(orgId: string): Promise<string[]> {
  const [profile] = await db
    .select({ warehouseAddresses: organizationProfile.warehouseAddresses })
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId))
    .limit(1);
  const labels = ((profile?.warehouseAddresses as { label?: string }[] | null) ?? [])
    .map((w) => w.label?.trim())
    .filter((l): l is string => !!l);
  return labels.length ? labels : ["Default"];
}

async function generateConsignmentNo(orgId: string): Promise<string> {
  // Same company code + format as the DO numbering, with doc code "CS"
  // (e.g. DOSI/26-0001 → CSSI/26-0001); unique across the owner's companies.
  const doCfg = await getNumberingConfig(orgId, "do");
  const cfg = { ...doCfg, docCode: "CS" };
  const year = new Date().getFullYear();
  const [counter] = await db.select().from(consignCounter).where(eq(consignCounter.organizationId, orgId)).limit(1);
  const start = counter && counter.year === year ? counter.lastNumber + 1 : 1;
  const { seq, docNo } = await nextFreeDocNo(
    { table: consignHeader, id: consignHeader.id, organizationId: consignHeader.organizationId, number: consignHeader.consignmentNo },
    orgId, start, (n) => buildDocumentNo(cfg, year, n),
  );
  if (counter) await db.update(consignCounter).set({ year, lastNumber: seq }).where(eq(consignCounter.id, counter.id));
  else await db.insert(consignCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: seq });
  return docNo;
}

async function levelQty(orgId: string, productId: string, label: string): Promise<number> {
  const [l] = await db.select({ q: stockLevel.quantity }).from(stockLevel)
    .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.productId, productId), eq(stockLevel.warehouseLabel, label))).limit(1);
  return num(l?.q);
}

async function lotQty(orgId: string, productId: string, label: string, lotNo: string): Promise<number> {
  const [l] = await db.select({ q: stockLot.quantity }).from(stockLot)
    .where(and(eq(stockLot.organizationId, orgId), eq(stockLot.productId, productId), eq(stockLot.warehouseLabel, label), eq(stockLot.lotNo, lotNo))).limit(1);
  return num(l?.q);
}

/** Location label + a readable name for a consignment's consignee. */
async function resolveLocation(ownerOrgId: string, input: CreateConsignmentInput): Promise<{ label: string } | { error: string }> {
  const groupIds = await getOrgGroupIds(ownerOrgId);
  if (input.consigneeType === "agent") {
    if (!input.agentOrgId) return { error: "Choose the agent company" };
    if (input.agentOrgId === ownerOrgId) return { error: "The agent must be a different company from the owner" };
    if (!groupIds.includes(input.agentOrgId)) return { error: "The agent must be one of your own companies" };
    if (input.agentRepId) {
      const [m] = await db.select({ id: member.id }).from(member)
        .where(and(eq(member.organizationId, input.agentOrgId), eq(member.userId, input.agentRepId), isNull(member.deletedAt))).limit(1);
      if (!m) return { error: "The specialist is not a member of the agent company" };
      return { label: agentRepLocation(input.agentOrgId, input.agentRepId) };
    }
    return { label: agentLocation(input.agentOrgId) };
  }
  if (input.consigneeType === "partner") {
    if (!input.partnerId) return { error: "Choose the external agent" };
    const [pt] = await db.select({ id: consignPartner.id, active: consignPartner.active }).from(consignPartner)
      .where(and(eq(consignPartner.id, input.partnerId), eq(consignPartner.organizationId, ownerOrgId))).limit(1);
    if (!pt) return { error: "External agent not found" };
    if (!pt.active) return { error: "This external agent is inactive" };
    return { label: partnerLocation(input.partnerId) };
  }
  if (!input.customerOrgId) return { error: "Choose the customer's organisation (hospital)" };
  const [co] = await db.select({ id: customerOrganization.id }).from(customerOrganization)
    .where(and(eq(customerOrganization.id, input.customerOrgId), inArray(customerOrganization.organizationId, groupIds))).limit(1);
  if (!co) return { error: "Customer organisation not found" };
  return { label: customerLocation(input.customerOrgId) };
}

interface PreparedItem {
  productId: string; productCode: string; description: string | null; uom: string | null;
  qty: number; lotNo: string | null; expiryDate: Date | null; unitCost: string | null;
  units: { id: string; serialNo: string }[];
}

/** Validate every requested item against the source label BEFORE moving anything. */
async function prepareItems(ownerOrgId: string, sourceLabel: string, items: ConsignItemInput[]): Promise<{ items: PreparedItem[] } | { title: string; details: string[] }> {
  const groupIds = await getOrgGroupIds(ownerOrgId);
  const problems: string[] = [];
  const out: PreparedItem[] = [];
  const needByKey = new Map<string, number>(); // product|lot → total requested

  for (const it of items) {
    const [p] = await db.select({
      id: product.id, productCode: product.productCode, description: product.description, uom: product.uom,
      serial: product.requiresSerialTracking,
    }).from(product).where(and(eq(product.id, it.productId), inArray(product.organizationId, groupIds))).limit(1);
    if (!p) { problems.push(`Product not found (${it.productId})`); continue; }

    const [lvl] = await db.select({ unitCost: stockLevel.unitCost }).from(stockLevel)
      .where(and(eq(stockLevel.organizationId, ownerOrgId), eq(stockLevel.productId, p.id), eq(stockLevel.warehouseLabel, sourceLabel))).limit(1);

    if (p.serial || (it.unitIds?.length ?? 0) > 0) {
      const ids = [...new Set(it.unitIds ?? [])];
      if (ids.length === 0) { problems.push(`${p.productCode}: choose the serial number(s) to send`); continue; }
      const units = await db.select({ id: assetUnit.id, serialNo: assetUnit.serialNo, status: assetUnit.status, label: assetUnit.currentWarehouseLabel, org: assetUnit.currentOrgId })
        .from(assetUnit).where(and(inArray(assetUnit.id, ids), eq(assetUnit.productId, p.id)));
      for (const id of ids) {
        const u = units.find((x) => x.id === id);
        if (!u) problems.push(`${p.productCode}: serial unit not found`);
        else if (u.status !== ASSET_UNIT_STATUS.IN_STOCK || u.org !== ownerOrgId || (u.label ?? "Default") !== sourceLabel) {
          problems.push(`${p.productCode} SN ${u.serialNo}: not in stock at ${sourceLabel}`);
        }
      }
      const key = `${p.id}|`;
      needByKey.set(key, (needByKey.get(key) ?? 0) + ids.length);
      out.push({ productId: p.id, productCode: p.productCode, description: p.description, uom: p.uom, qty: ids.length, lotNo: null, expiryDate: null, unitCost: lvl?.unitCost ?? null, units: units.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id, serialNo: u.serialNo })) });
      continue;
    }

    const qty = Number(it.qty);
    if (!(qty > 0)) { problems.push(`${p.productCode}: enter a quantity above 0`); continue; }
    let expiryDate: Date | null = null;
    const lots = await db.select({ lotNo: stockLot.lotNo, q: stockLot.quantity, exp: stockLot.expiryDate }).from(stockLot)
      .where(and(eq(stockLot.organizationId, ownerOrgId), eq(stockLot.productId, p.id), eq(stockLot.warehouseLabel, sourceLabel)));
    const liveLots = lots.filter((l) => num(l.q) > 0);
    if (it.lotNo) {
      const lot = lots.find((l) => l.lotNo === it.lotNo);
      if (!lot) { problems.push(`${p.productCode}: lot ${it.lotNo} not found at ${sourceLabel}`); continue; }
      expiryDate = lot.exp;
    } else if (liveLots.length > 0) {
      problems.push(`${p.productCode}: choose which lot to send (${liveLots.map((l) => l.lotNo).join(", ")})`);
      continue;
    }
    const key = `${p.id}|${it.lotNo ?? ""}`;
    needByKey.set(key, (needByKey.get(key) ?? 0) + qty);
    out.push({ productId: p.id, productCode: p.productCode, description: p.description, uom: p.uom, qty, lotNo: it.lotNo ?? null, expiryDate, unitCost: lvl?.unitCost ?? null, units: [] });
  }

  // Aggregate availability check (same product/lot requested on several lines)
  for (const [key, need] of needByKey) {
    const [productId, lotNo] = key.split("|");
    const item = out.find((o) => o.productId === productId);
    if (!item) continue;
    const have = lotNo ? await lotQty(ownerOrgId, productId, sourceLabel, lotNo) : await levelQty(ownerOrgId, productId, sourceLabel);
    if (have + 1e-9 < need) {
      problems.push(`${item.productCode}${lotNo ? ` lot ${lotNo}` : ""}: need ${fmtQty(need)}, only ${fmtQty(have)} available at ${sourceLabel}`);
    }
  }
  if (items.length === 0) problems.push("Add at least one item");
  if (problems.length) return { title: "Can't send this consignment", details: problems };
  return { items: out };
}

/** Send prepared items to a consignment's location (new or existing header). */
async function sendItems(header: typeof consignHeader.$inferSelect, items: PreparedItem[], userId: string, eventDate: Date) {
  for (const it of items) {
    const lines = it.units.length > 0
      ? it.units.map((u) => ({ unit: u, qty: 1 }))
      : [{ unit: null as { id: string; serialNo: string } | null, qty: it.qty }];
    for (const l of lines) {
      // Serial units get their own line; otherwise top up an existing line for the same product+lot
      let lineId: string;
      const [existing] = l.unit ? [] : await db.select().from(consignLine).where(and(
        eq(consignLine.consignmentId, header.id), eq(consignLine.productId, it.productId),
        it.lotNo ? eq(consignLine.lotNo, it.lotNo) : isNull(consignLine.lotNo), isNull(consignLine.unitId),
      )).limit(1);
      if (existing) {
        lineId = existing.id;
        await db.update(consignLine).set({ qtySent: (num(existing.qtySent) + l.qty).toFixed(4) }).where(eq(consignLine.id, existing.id));
      } else {
        lineId = nanoid();
        await db.insert(consignLine).values({
          id: lineId, consignmentId: header.id, organizationId: header.organizationId,
          productId: it.productId, productCode: it.productCode, description: it.description, uom: it.uom,
          lotNo: it.lotNo, expiryDate: it.expiryDate, unitId: l.unit?.id ?? null, serialNo: l.unit?.serialNo ?? null,
          unitCost: it.unitCost, qtySent: l.qty.toFixed(4),
        });
      }
      const mvId = await moveStock({
        ownerOrgId: header.organizationId, userId, productId: it.productId, productCode: it.productCode,
        from: header.sourceWarehouseLabel, to: header.locationLabel, qty: l.qty,
        lotNo: it.lotNo, expiryDate: it.expiryDate, unitCost: it.unitCost,
        unitId: l.unit?.id, serialNo: l.unit?.serialNo,
        movementType: MOVEMENT_TYPE.CONSIGN_SEND, referenceId: header.id, referenceNo: header.consignmentNo,
        notes: `Consignment sent — ${header.consignmentNo}`,
      });
      if (l.unit) {
        const loc = parseLocation(header.locationLabel);
        await db.update(assetUnit).set({
          status: loc?.kind === "agent-rep" ? ASSET_UNIT_STATUS.WITH_REP : ASSET_UNIT_STATUS.CONSIGNED,
          currentWarehouseLabel: header.locationLabel,
          currentHolderUserId: loc?.kind === "agent-rep" ? loc.repUserId : null,
        }).where(eq(assetUnit.id, l.unit.id));
      }
      await db.insert(consignEvent).values({
        id: nanoid(), consignmentId: header.id, lineId, organizationId: header.organizationId,
        type: "send", qty: l.qty.toFixed(4), eventDate, stockMovementId: mvId, createdBy: userId,
      });
    }
  }
}

function revalidateConsignment(id?: string) {
  revalidatePath("/dashboard/consignment");
  if (id) revalidatePath(`/dashboard/consignment/${id}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/field-stock");
}

// ── Form options ─────────────────────────────────────────────────────────────

export async function getConsignmentFormOptions() {
  const { orgId } = await ctx("consignment:manage");
  const groupIds = await getOrgGroupIds(orgId);
  const [orgs, warehouses, pairs] = await Promise.all([
    db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, groupIds)),
    getWarehouseLabels(orgId),
    db.select().from(consignPairSetting).where(eq(consignPairSetting.ownerOrgId, orgId)),
  ]);
  const agentIds = groupIds.filter((id) => id !== orgId);
  const reps = agentIds.length
    ? await db.select({ orgId: member.organizationId, id: user.id, name: user.name }).from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(inArray(member.organizationId, agentIds), isNull(member.deletedAt)))
        .orderBy(asc(user.name))
    : [];
  return {
    ownerOrgId: orgId,
    ownerName: orgs.find((o) => o.id === orgId)?.name ?? "",
    warehouses,
    agents: orgs.filter((o) => o.id !== orgId).map((o) => ({ ...o, reps: reps.filter((r) => r.orgId === o.id).map((r) => ({ id: r.id, name: r.name ?? r.id })) })),
    pairSettings: pairs,
    partners: await db.select({ id: consignPartner.id, name: consignPartner.name, model: consignPartner.model }).from(consignPartner)
      .where(and(eq(consignPartner.organizationId, orgId), eq(consignPartner.active, true))).orderBy(asc(consignPartner.name)),
  };
}

/** Products with stock at the owner's source warehouse, with lots and serial units. */
export async function searchSendableStock(query: string, sourceWarehouseLabel: string) {
  const { orgId } = await ctx("consignment:manage");
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db.select({
    productId: product.id, productCode: product.productCode, description: product.description, uom: product.uom,
    serial: product.requiresSerialTracking, qty: stockLevel.quantity,
  }).from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(
      eq(stockLevel.organizationId, orgId), eq(stockLevel.warehouseLabel, sourceWarehouseLabel),
      sql`${stockLevel.quantity}::numeric > 0`,
      or(sql`${product.productCode} ILIKE ${`%${q}%`}`, sql`${product.description} ILIKE ${`%${q}%`}`),
    ))
    .orderBy(asc(product.productCode)).limit(20);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.productId);
  const [lots, units] = await Promise.all([
    db.select({ productId: stockLot.productId, lotNo: stockLot.lotNo, qty: stockLot.quantity, expiryDate: stockLot.expiryDate }).from(stockLot)
      .where(and(eq(stockLot.organizationId, orgId), eq(stockLot.warehouseLabel, sourceWarehouseLabel), inArray(stockLot.productId, ids), sql`${stockLot.quantity}::numeric > 0`))
      .orderBy(asc(stockLot.expiryDate)),
    db.select({ productId: assetUnit.productId, id: assetUnit.id, serialNo: assetUnit.serialNo, intendedUse: assetUnit.intendedUse }).from(assetUnit)
      .where(and(eq(assetUnit.currentOrgId, orgId), eq(assetUnit.status, ASSET_UNIT_STATUS.IN_STOCK), inArray(assetUnit.productId, ids),
        or(eq(assetUnit.currentWarehouseLabel, sourceWarehouseLabel), sourceWarehouseLabel === "Default" ? isNull(assetUnit.currentWarehouseLabel) : sql`false`)))
      .orderBy(asc(assetUnit.serialNo)),
  ]);
  return rows.map((r) => ({
    productId: r.productId, productCode: r.productCode, description: r.description, uom: r.uom,
    // Registered serial numbers make it a pick-by-serial item even if the product isn't flagged
    serial: r.serial || units.some((u) => u.productId === r.productId), available: num(r.qty),
    lots: lots.filter((l) => l.productId === r.productId).map((l) => ({ lotNo: l.lotNo, qty: num(l.qty), expiryDate: l.expiryDate })),
    units: units.filter((u) => u.productId === r.productId).map((u) => ({ id: u.id, serialNo: u.serialNo, intendedUse: u.intendedUse })),
  }));
}

// ── Send ─────────────────────────────────────────────────────────────────────

export async function createConsignment(input: CreateConsignmentInput): Promise<ActionResult<{ id: string; consignmentNo: string }>> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:manage");
    const warehouses = await getWarehouseLabels(orgId);
    if (!warehouses.includes(input.sourceWarehouseLabel)) return fail(`Unknown source warehouse "${input.sourceWarehouseLabel}"`);

    const loc = await resolveLocation(orgId, input);
    if ("error" in loc) return fail(loc.error);

    if (input.soId) {
      const [so] = await db.select({ id: salesOrder.id }).from(salesOrder)
        .where(and(eq(salesOrder.id, input.soId), eq(salesOrder.organizationId, orgId))).limit(1);
      if (!so) return fail("Sales order not found in this company");
    }

    const prepared = await prepareItems(orgId, input.sourceWarehouseLabel, input.items);
    if ("title" in prepared) return fail(prepared.title, prepared.details);

    const sentDate = input.sentDate ? new Date(input.sentDate) : new Date();
    const consignmentNo = await generateConsignmentNo(orgId);
    const [header] = await db.insert(consignHeader).values({
      id: nanoid(), organizationId: orgId, consignmentNo,
      consigneeType: input.consigneeType,
      agentOrgId: input.consigneeType === "agent" ? input.agentOrgId! : null,
      partnerId: input.consigneeType === "partner" ? input.partnerId! : null,
      agentRepId: input.consigneeType === "agent" ? (input.agentRepId || null) : null,
      customerId: input.consigneeType === "customer" ? (input.customerId || null) : null,
      customerOrgId: input.consigneeType === "customer" ? input.customerOrgId! : null,
      soId: input.soId || null,
      sourceWarehouseLabel: input.sourceWarehouseLabel, locationLabel: loc.label,
      status: "open", sentDate, reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
      notes: input.notes?.trim() || null, createdBy: userId,
    }).returning();

    await sendItems(header, prepared.items, userId, sentDate);
    revalidateConsignment(header.id);
    return { ok: true, id: header.id, consignmentNo };
  });
}

export async function sendMoreToConsignment(consignmentId: string, items: ConsignItemInput[]): Promise<ActionResult> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:manage");
    const [header] = await db.select().from(consignHeader).where(and(eq(consignHeader.id, consignmentId), eq(consignHeader.organizationId, orgId))).limit(1);
    if (!header) return fail("Consignment not found — only the owner company can send more");
    if (header.status !== "open") return fail(`${header.consignmentNo} is closed`);
    const prepared = await prepareItems(orgId, header.sourceWarehouseLabel, items);
    if ("title" in prepared) return fail(prepared.title, prepared.details);
    await sendItems(header, prepared.items, userId, new Date());
    revalidateConsignment(header.id);
    return { ok: true };
  });
}

// ── Return & Adjust ──────────────────────────────────────────────────────────

const onHand = (l: typeof consignLine.$inferSelect) =>
  num(l.qtySent) - num(l.qtyConsumed) - num(l.qtyReturned) - num(l.qtyAdjusted) - num(l.qtyMoved);

async function loadOwnedHeader(consignmentId: string, orgId: string) {
  const [header] = await db.select().from(consignHeader).where(and(eq(consignHeader.id, consignmentId), eq(consignHeader.organizationId, orgId))).limit(1);
  return header ?? null;
}

async function validateLineQtys(header: typeof consignHeader.$inferSelect, items: { lineId: string; qty: number }[]) {
  const lines = await db.select().from(consignLine).where(eq(consignLine.consignmentId, header.id));
  const problems: string[] = [];
  const picked: { line: typeof consignLine.$inferSelect; qty: number }[] = [];
  for (const it of items) {
    if (!(it.qty > 0)) continue;
    const line = lines.find((l) => l.id === it.lineId);
    if (!line) { problems.push("Line not found"); continue; }
    const left = onHand(line);
    if (it.qty > left + 1e-9) problems.push(`${line.productCode}${line.serialNo ? ` SN ${line.serialNo}` : line.lotNo ? ` lot ${line.lotNo}` : ""}: only ${fmtQty(left)} on hand`);
    else picked.push({ line, qty: it.qty });
  }
  if (!picked.length && !problems.length) problems.push("Enter a quantity for at least one line");
  return { picked, problems };
}

export async function returnConsignmentStock(consignmentId: string, items: { lineId: string; qty: number }[]): Promise<ActionResult> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:manage");
    const header = await loadOwnedHeader(consignmentId, orgId);
    if (!header) return fail("Consignment not found — only the owner company can return stock");
    const { picked, problems } = await validateLineQtys(header, items);
    if (problems.length) return fail("Can't return this stock", problems);

    for (const { line, qty } of picked) {
      const mvId = await moveStock({
        ownerOrgId: orgId, userId, productId: line.productId, productCode: line.productCode,
        from: header.locationLabel, to: header.sourceWarehouseLabel, qty,
        lotNo: line.lotNo, expiryDate: line.expiryDate, unitCost: line.unitCost,
        unitId: line.unitId, serialNo: line.serialNo,
        movementType: MOVEMENT_TYPE.CONSIGN_BACK, referenceId: header.id, referenceNo: header.consignmentNo,
        notes: `Consignment returned — ${header.consignmentNo}`,
      });
      await db.update(consignLine).set({ qtyReturned: (num(line.qtyReturned) + qty).toFixed(4) }).where(eq(consignLine.id, line.id));
      if (line.unitId) {
        await db.update(assetUnit).set({
          status: ASSET_UNIT_STATUS.IN_STOCK, currentWarehouseLabel: header.sourceWarehouseLabel, currentHolderUserId: null,
        }).where(eq(assetUnit.id, line.unitId));
      }
      await db.insert(consignEvent).values({
        id: nanoid(), consignmentId: header.id, lineId: line.id, organizationId: orgId,
        type: "return", qty: qty.toFixed(4), eventDate: new Date(), stockMovementId: mvId, createdBy: userId,
      });
    }
    revalidateConsignment(header.id);
    return { ok: true };
  });
}

export async function adjustConsignmentStock(
  consignmentId: string,
  items: { lineId: string; qty: number }[],
  reason: "lost" | "damaged" | "expired" | "count",
  chargeConsignee: boolean,
): Promise<ActionResult> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:adjust");
    const header = await loadOwnedHeader(consignmentId, orgId);
    if (!header) return fail("Consignment not found — only the owner company can post adjustments");
    const { picked, problems } = await validateLineQtys(header, items);
    if (problems.length) return fail("Can't post this adjustment", problems);

    for (const { line, qty } of picked) {
      const mvId = await moveStock({
        ownerOrgId: orgId, userId, productId: line.productId, productCode: line.productCode,
        from: header.locationLabel, to: null, qty,
        lotNo: line.lotNo, expiryDate: line.expiryDate, unitCost: line.unitCost,
        unitId: line.unitId, serialNo: line.serialNo,
        movementType: MOVEMENT_TYPE.CONSIGN_ADJUST, referenceId: header.id, referenceNo: header.consignmentNo,
        notes: `Consignment adjustment (${reason}) — ${header.consignmentNo}`,
      });
      await db.update(consignLine).set({ qtyAdjusted: (num(line.qtyAdjusted) + qty).toFixed(4) }).where(eq(consignLine.id, line.id));
      if (line.unitId) {
        await db.update(assetUnit).set({ status: ASSET_UNIT_STATUS.DISPOSED, currentHolderUserId: null }).where(eq(assetUnit.id, line.unitId));
      }
      await db.insert(consignEvent).values({
        id: nanoid(), consignmentId: header.id, lineId: line.id, organizationId: orgId,
        type: "adjust", qty: qty.toFixed(4), eventDate: new Date(), reason,
        billable: chargeConsignee, stockMovementId: mvId, createdBy: userId,
      });
    }
    revalidateConsignment(header.id);
    return { ok: true };
  });
}

export async function closeConsignment(consignmentId: string): Promise<ActionResult> {
  return guarded(async () => {
    const { orgId } = await ctx("consignment:manage");
    const header = await loadOwnedHeader(consignmentId, orgId);
    if (!header) return fail("Consignment not found");
    const lines = await db.select().from(consignLine).where(eq(consignLine.consignmentId, header.id));
    const left = lines.filter((l) => onHand(l) > 1e-9);
    if (left.length) {
      return fail(`${header.consignmentNo} still has stock on hand — return, consume or adjust it first`,
        left.map((l) => `${l.productCode}${l.serialNo ? ` SN ${l.serialNo}` : ""}: ${fmtQty(onHand(l))} on hand`));
    }
    await db.update(consignHeader).set({ status: "closed" }).where(eq(consignHeader.id, header.id));
    revalidateConsignment(header.id);
    return { ok: true };
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────

async function nameMaps(orgIds: string[], userIds: string[], customerOrgIds: string[], customerIds: string[], partnerIds: string[] = []) {
  const [orgs, users, cOrgs, custs, partners] = await Promise.all([
    orgIds.length ? db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, orgIds)) : [],
    userIds.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)) : [],
    customerOrgIds.length ? db.select({ id: customerOrganization.id, name: customerOrganization.name }).from(customerOrganization).where(inArray(customerOrganization.id, customerOrgIds)) : [],
    customerIds.length ? db.select({ id: customer.id, name: customer.name, title: customer.title }).from(customer).where(inArray(customer.id, customerIds)) : [],
    partnerIds.length ? db.select({ id: consignPartner.id, name: consignPartner.name, model: consignPartner.model }).from(consignPartner).where(inArray(consignPartner.id, partnerIds)) : [],
  ]);
  return {
    org: new Map(orgs.map((o) => [o.id, o.name])),
    user: new Map(users.map((u) => [u.id, u.name ?? u.id])),
    cOrg: new Map(cOrgs.map((o) => [o.id, o.name])),
    cust: new Map(custs.map((c) => [c.id, [c.title, c.name].filter(Boolean).join(" ")])),
    partner: new Map(partners.map((x) => [x.id, x])),
  };
}

export type ConsignmentListRow = Awaited<ReturnType<typeof listConsignments>>[number];

/** Consignments where the active company is the owner OR the agent. */
export async function listConsignments() {
  const { orgId } = await ctx("consignment:read");
  const headers = await db.select().from(consignHeader)
    .where(or(eq(consignHeader.organizationId, orgId), eq(consignHeader.agentOrgId, orgId)))
    .orderBy(desc(consignHeader.sentDate), desc(consignHeader.createdAt));
  if (!headers.length) return [];
  const lines = await db.select().from(consignLine).where(inArray(consignLine.consignmentId, headers.map((h) => h.id)));
  const names = await nameMaps(
    [...new Set(headers.flatMap((h) => [h.organizationId, h.agentOrgId].filter(Boolean) as string[]))],
    [...new Set(headers.map((h) => h.agentRepId).filter(Boolean) as string[])],
    [...new Set(headers.map((h) => h.customerOrgId).filter(Boolean) as string[])],
    [...new Set(headers.map((h) => h.customerId).filter(Boolean) as string[])],
    [...new Set(headers.map((h) => h.partnerId).filter(Boolean) as string[])],
  );
  return headers.map((h) => {
    const ls = lines.filter((l) => l.consignmentId === h.id);
    return {
      id: h.id, consignmentNo: h.consignmentNo, status: h.status, consigneeType: h.consigneeType as "agent" | "customer" | "partner",
      sentDate: h.sentDate, isOwner: h.organizationId === orgId,
      ownerName: names.org.get(h.organizationId) ?? "",
      consigneeName: h.consigneeType === "agent" ? names.org.get(h.agentOrgId ?? "") ?? ""
        : h.consigneeType === "partner" ? names.partner.get(h.partnerId ?? "")?.name ?? ""
        : names.cOrg.get(h.customerOrgId ?? "") ?? "",
      subName: h.consigneeType === "agent" ? (h.agentRepId ? names.user.get(h.agentRepId) ?? "" : "Warehouse")
        : h.consigneeType === "partner" ? (names.partner.get(h.partnerId ?? "")?.model === "dealer" ? "Dealer" : "Sales agent")
        : (h.customerId ? names.cust.get(h.customerId) ?? "" : ""),
      lineCount: ls.length,
      qtySent: ls.reduce((s, l) => s + num(l.qtySent), 0),
      qtyOnHand: ls.reduce((s, l) => s + onHand(l), 0),
      qtyConsumed: ls.reduce((s, l) => s + num(l.qtyConsumed), 0),
    };
  });
}

export type ConsignmentDetail = NonNullable<Awaited<ReturnType<typeof getConsignment>>>;

export async function getConsignment(id: string) {
  const { orgId, perms } = await ctx("consignment:read");
  const [h] = await db.select().from(consignHeader)
    .where(and(eq(consignHeader.id, id), or(eq(consignHeader.organizationId, orgId), eq(consignHeader.agentOrgId, orgId)))).limit(1);
  if (!h) return null;
  const [lines, events] = await Promise.all([
    db.select().from(consignLine).where(eq(consignLine.consignmentId, id)).orderBy(asc(consignLine.productCode), asc(consignLine.serialNo)),
    db.select().from(consignEvent).where(eq(consignEvent.consignmentId, id)).orderBy(desc(consignEvent.createdAt)),
  ]);
  const names = await nameMaps(
    [h.organizationId, h.agentOrgId].filter(Boolean) as string[],
    [...new Set([h.agentRepId, h.createdBy, ...events.map((e) => e.createdBy)].filter(Boolean) as string[])],
    h.customerOrgId ? [h.customerOrgId] : [],
    h.customerId ? [h.customerId] : [],
    h.partnerId ? [h.partnerId] : [],
  );
  const [so] = h.soId ? await db.select({ soNo: salesOrder.soNo }).from(salesOrder).where(eq(salesOrder.id, h.soId)).limit(1) : [];
  const hospIds = [...new Set(events.map((e) => e.endCustomerOrgId).filter(Boolean) as string[])];
  const hospitalNames = new Map((hospIds.length ? await db.select({ id: customerOrganization.id, name: customerOrganization.name }).from(customerOrganization).where(inArray(customerOrganization.id, hospIds)) : []).map((x) => [x.id, x.name]));
  const unitIds = lines.map((l) => l.unitId).filter(Boolean) as string[];
  const machineUnits = new Set((unitIds.length ? await db.select({ id: assetUnit.id }).from(assetUnit)
    .where(and(inArray(assetUnit.id, unitIds), inArray(assetUnit.intendedUse, [...LENDABLE_USES]))) : []).map((u) => u.id));
  const isOwner = h.organizationId === orgId;
  const can = (p: string) => hasAccess(perms, p);
  return {
    header: {
      ...h,
      ownerName: names.org.get(h.organizationId) ?? "",
      agentName: h.agentOrgId ? names.org.get(h.agentOrgId) ?? "" : null,
      repName: h.agentRepId ? names.user.get(h.agentRepId) ?? "" : null,
      customerOrgName: h.customerOrgId ? names.cOrg.get(h.customerOrgId) ?? "" : null,
      customerName: h.customerId ? names.cust.get(h.customerId) ?? "" : null,
      partnerName: h.partnerId ? names.partner.get(h.partnerId)?.name ?? "" : null,
      partnerModel: h.partnerId ? (names.partner.get(h.partnerId)?.model as "dealer" | "sales_agent" | undefined) ?? null : null,
      soNo: so?.soNo ?? null,
      createdByName: names.user.get(h.createdBy) ?? "",
    },
    // isMachine: a rental unit — used on cases and returned, never consumed
    lines: lines.map((l) => ({ ...l, onHand: onHand(l), isMachine: !!l.unitId && machineUnits.has(l.unitId) })),
    events: events.map((e) => {
      const line = lines.find((l) => l.id === e.lineId);
      return { ...e, productCode: line?.productCode ?? "", serialNo: line?.serialNo ?? null, lotNo: line?.lotNo ?? null, byName: names.user.get(e.createdBy) ?? "", hospitalName: e.endCustomerOrgId ? hospitalNames.get(e.endCustomerOrgId) ?? null : null };
    }),
    permissions: {
      isOwner,
      canManage: isOwner && can("consignment:manage"),
      canAdjust: isOwner && can("consignment:adjust"),
    },
  };
}

/** The owner's stock by location: own warehouses + every consignment location. */
export async function getConsignmentBalance() {
  const { orgId } = await ctx("consignment:read");
  const rows = await db.select({
    label: stockLevel.warehouseLabel, productId: stockLevel.productId, qty: stockLevel.quantity, unitCost: stockLevel.unitCost,
    productCode: product.productCode, description: product.description, uom: product.uom,
  }).from(stockLevel).innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(eq(stockLevel.organizationId, orgId), like(stockLevel.warehouseLabel, "CS:%"), sql`${stockLevel.quantity}::numeric <> 0`))
    .orderBy(asc(stockLevel.warehouseLabel), asc(product.productCode));
  const parsed = rows.map((r) => ({ r, loc: parseLocation(r.label) }));
  const names = await nameMaps(
    [...new Set(parsed.map((p) => (p.loc && "agentOrgId" in p.loc ? p.loc.agentOrgId : null)).filter(Boolean) as string[])],
    [...new Set(parsed.map((p) => (p.loc?.kind === "agent-rep" ? p.loc.repUserId : null)).filter(Boolean) as string[])],
    [...new Set(parsed.map((p) => (p.loc?.kind === "customer" ? p.loc.customerOrgId : null)).filter(Boolean) as string[])],
    [],
    [...new Set(parsed.map((p) => (p.loc?.kind === "partner" ? p.loc.partnerId : null)).filter(Boolean) as string[])],
  );
  const locName = (loc: ReturnType<typeof parseLocation>) => {
    if (!loc) return "Unknown location";
    if (loc.kind === "agent") return `${names.org.get(loc.agentOrgId) ?? "Agent"} — warehouse`;
    if (loc.kind === "agent-rep") return `${names.org.get(loc.agentOrgId) ?? "Agent"} — ${names.user.get(loc.repUserId) ?? "specialist"}`;
    if (loc.kind === "partner") {
      const pt = names.partner.get(loc.partnerId);
      return `${pt?.name ?? "External agent"} — ${pt?.model === "dealer" ? "dealer" : "sales agent"}`;
    }
    return names.cOrg.get(loc.customerOrgId) ?? "Customer";
  };
  const byLoc = new Map<string, { label: string; name: string; kind: string; items: { productCode: string; description: string | null; uom: string | null; qty: number; value: number }[] }>();
  for (const { r, loc } of parsed) {
    const e = byLoc.get(r.label) ?? { label: r.label, name: locName(loc), kind: loc?.kind ?? "unknown", items: [] };
    const qty = num(r.qty);
    e.items.push({ productCode: r.productCode, description: r.description, uom: r.uom, qty, value: qty * num(r.unitCost) });
    byLoc.set(r.label, e);
  }
  return [...byLoc.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Consigned IN — stock other companies of the group placed with the ACTIVE
 * company (its warehouse or its specialists). It stays on the owner's books
 * (MFRS 15: the consignee doesn't control it until used), so it's shown to the
 * agent by quantity only — no value — and never counted in its own stock.
 * Moved only through the consignment (use / return / adjust).
 */
export async function getConsignedInStock() {
  const session = await getCachedSession();
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "inventory:read") && !hasAccess(perms, "consignment:read")) return [];
  const owners = (await getOrgGroupIds(orgId)).filter((id) => id !== orgId);
  if (!owners.length) return [];
  const here = or(eq(stockLevel.warehouseLabel, agentLocation(orgId)), like(stockLevel.warehouseLabel, `${agentLocation(orgId)}:REP:%`));
  const rows = await db.select({
    ownerOrgId: stockLevel.organizationId, label: stockLevel.warehouseLabel, productId: stockLevel.productId, qty: stockLevel.quantity,
    productCode: product.productCode, description: product.description, uom: product.uom,
  }).from(stockLevel).innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(inArray(stockLevel.organizationId, owners), here, sql`${stockLevel.quantity}::numeric <> 0`))
    .orderBy(asc(product.productCode));
  if (!rows.length) return [];
  const labels = [...new Set(rows.map((r) => r.label))];
  const [lots, units] = await Promise.all([
    db.select({ org: stockLot.organizationId, label: stockLot.warehouseLabel, productId: stockLot.productId, lotNo: stockLot.lotNo, expiryDate: stockLot.expiryDate, qty: stockLot.quantity })
      .from(stockLot).where(and(inArray(stockLot.organizationId, owners), inArray(stockLot.warehouseLabel, labels), sql`${stockLot.quantity}::numeric > 0`))
      .orderBy(asc(stockLot.expiryDate)),
    db.select({ org: assetUnit.organizationId, label: assetUnit.currentWarehouseLabel, productId: assetUnit.productId, id: assetUnit.id, serialNo: assetUnit.serialNo, intendedUse: assetUnit.intendedUse })
      .from(assetUnit).where(and(inArray(assetUnit.organizationId, owners), inArray(assetUnit.currentWarehouseLabel, labels), inArray(assetUnit.status, [ASSET_UNIT_STATUS.CONSIGNED, ASSET_UNIT_STATUS.WITH_REP])))
      .orderBy(asc(assetUnit.serialNo)),
  ]);
  const parsed = rows.map((r) => ({ r, loc: parseLocation(r.label) }));
  const names = await nameMaps(
    [...new Set(rows.map((r) => r.ownerOrgId))],
    [...new Set(parsed.map((p) => (p.loc?.kind === "agent-rep" ? p.loc.repUserId : null)).filter(Boolean) as string[])],
    [], [],
  );
  const memberOf = await groupIdsByProduct(rows.map((r) => r.productId));
  const same = (o: string, l: string | null, pid: string) => (x: { org: string; label: string | null; productId: string }) => x.org === o && x.label === l && x.productId === pid;
  return parsed.map(({ r, loc }) => ({
    key: `${r.ownerOrgId}|${r.label}|${r.productId}`,
    ownerOrgId: r.ownerOrgId,
    ownerName: names.org.get(r.ownerOrgId) ?? "Sister company",
    label: r.label,
    // where it physically is inside this company
    locationName: loc?.kind === "agent-rep" ? `With ${names.user.get(loc.repUserId) ?? "specialist"}` : "Warehouse",
    productId: r.productId, productCode: r.productCode, description: r.description, uom: r.uom, itemGroupIds: memberOf.get(r.productId) ?? [],
    qty: num(r.qty),
    lots: lots.filter(same(r.ownerOrgId, r.label, r.productId)).map((l) => ({ lotNo: l.lotNo, expiryDate: l.expiryDate, qty: num(l.qty) })),
    serials: units.filter(same(r.ownerOrgId, r.label, r.productId)).map((u) => u.serialNo),
    units: units.filter(same(r.ownerOrgId, r.label, r.productId)).map((u) => ({ id: u.id, serialNo: u.serialNo, intendedUse: u.intendedUse })),
  }));
}
export type ConsignedInMovement = Awaited<ReturnType<typeof getConsignedInMovements>>[number];
export type ConsignedInRow = Awaited<ReturnType<typeof getConsignedInStock>>[number];

/**
 * Movement history of consigned-IN stock, seen from the agent's side: every
 * owner movement into, out of or at this company's consignment locations
 * (sent, used, returned, counted, reversed). Read-only, no cost — the rows
 * belong to the owner's ledger. `delta` is the change at this company.
 */
export async function getConsignedInMovements(limit = 200) {
  const session = await getCachedSession();
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "inventory:read") && !hasAccess(perms, "consignment:read")) return [];
  const owners = (await getOrgGroupIds(orgId)).filter((id) => id !== orgId);
  if (!owners.length) return [];
  const base = agentLocation(orgId);
  const at = (col: typeof stockMovement.warehouseLabel | typeof stockMovement.warehouseTo | typeof stockLevel.warehouseLabel) => or(eq(col, base), like(col, `${base}:REP:%`));
  const rows = await db.select({ sm: stockMovement, byName: user.name }).from(stockMovement)
    .leftJoin(user, eq(user.id, stockMovement.createdBy))
    .where(and(inArray(stockMovement.organizationId, owners), or(at(stockMovement.warehouseLabel), at(stockMovement.warehouseTo))))
    .orderBy(desc(stockMovement.createdAt)).limit(limit);
  if (!rows.length) return [];
  const isHere = (l: string | null) => !!l && (l === base || l.startsWith(`${base}:REP:`));
  const reps = [...new Set(rows.flatMap(({ sm }) => [sm.warehouseLabel, sm.warehouseTo]).map((l) => (l && isHere(l) ? /:REP:([^:]+)$/.exec(l)?.[1] : null)).filter(Boolean) as string[])];
  const names = await nameMaps(owners, reps, [], []);
  const place = (l: string | null, owner: string) => {
    if (!l) return null;
    if (isHere(l)) { const rep = /:REP:([^:]+)$/.exec(l)?.[1]; return rep ? `With ${names.user.get(rep) ?? "specialist"} (consigned)` : "Warehouse (consigned)"; }
    return `${names.org.get(owner) ?? "Owner"} — ${l.startsWith("CS:") ? "consignment" : l}`;
  };
  // Our running balance per location: start from what's held now and walk
  // back through the movements (newest first), undoing each one.
  const levels = await db.select({ org: stockLevel.organizationId, label: stockLevel.warehouseLabel, productId: stockLevel.productId, qty: stockLevel.quantity })
    .from(stockLevel).where(and(inArray(stockLevel.organizationId, owners), at(stockLevel.warehouseLabel)));
  const held = new Map(levels.map((l) => [`${l.org}|${l.label}|${l.productId}`, num(l.qty)]));
  const key = (org: string, label: string, pid: string) => `${org}|${label}|${pid}`;
  const walk = (k: string, undo: number) => { const now = held.get(k) ?? 0; held.set(k, now - undo); return now; };
  return rows.map(({ sm, byName }) => {
    const q = num(sm.quantity);
    // Recorded from the owner's "from" location: if that's here, the sign is
    // already ours; if stock arrived here (to), it's the opposite.
    const fromHere = isHere(sm.warehouseLabel);
    const internal = fromHere && isHere(sm.warehouseTo); // e.g. warehouse → specialist, both here
    const delta = internal ? Math.abs(q) : fromHere ? q : -q;
    const ourLabel = (fromHere && !internal ? sm.warehouseLabel : sm.warehouseTo)!;
    const balance = walk(key(sm.organizationId, ourLabel, sm.productId), delta);
    if (internal) walk(key(sm.organizationId, sm.warehouseLabel, sm.productId), -Math.abs(q));
    return {
      ...sm, createdByName: byName,
      unitCost: null, // the owner's cost isn't the agent's business
      consignedIn: {
        ownerName: names.org.get(sm.organizationId) ?? "Sister company",
        fromName: place(sm.warehouseLabel, sm.organizationId) ?? "",
        toName: place(sm.warehouseTo, sm.organizationId),
        delta, internal,
        balance: String(balance), // held at that location right after this movement
      },
    };
  });
}

// ── Agent: move consigned stock inside the company ──────────────────────────
//
// The agent may move stock consigned to it between its own locations —
// warehouse ⇄ specialist, specialist ⇄ specialist — without asking the owner:
// it's still the owner's stock and still with the agent, only the shelf
// changes (the owner sees the new location). The quantity leaves the source
// consignment line (qty_moved) and lands on the owner's open consignment for
// the destination — created when there's none — so Case DOs, returns,
// counts and settlement all keep working per location. Placing it with
// anyone OUTSIDE the agent company is the owner's decision (pass-on).

export interface MoveConsignedInput {
  ownerOrgId: string;
  fromLabel: string;
  toLabel: string;
  items: { productId: string; lotNo?: string | null; unitIds?: string[]; qty: number }[];
}

/** Where this company can move consigned stock to: its warehouse and its specialists. */
export async function getConsignMoveTargets() {
  const session = await getCachedSession();
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  const reps = await db.select({ id: user.id, name: user.name }).from(member).innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt))).orderBy(asc(user.name));
  return {
    canMove: hasAccess(perms, "inventory:create"),
    targets: [
      { label: agentLocation(orgId), name: "Warehouse" },
      ...reps.map((r) => ({ label: agentRepLocation(orgId, r.id), name: r.name ?? r.id })),
    ],
  };
}

export async function moveConsignedStock(input: MoveConsignedInput): Promise<ActionResult<{ moved: number }>> {
  return guarded(async () => {
    const session = await getCachedSession();
    const orgId = session?.session.activeOrganizationId;
    if (!session || !orgId) return fail("Not signed in");
    const userId = session.user.id;
    const perms = await getUserPermissions(userId, orgId);
    if (!hasAccess(perms, "inventory:create")) return fail("You don't have permission to transfer stock");

    const groupIds = await getOrgGroupIds(orgId);
    if (input.ownerOrgId === orgId || !groupIds.includes(input.ownerOrgId)) return fail("This stock isn't consigned to your company");
    const from = parseLocation(input.fromLabel), to = parseLocation(input.toLabel);
    const ours = (l: ReturnType<typeof parseLocation>) => (l?.kind === "agent" || l?.kind === "agent-rep") && l.agentOrgId === orgId;
    if (!ours(from) || !ours(to)) return fail("Consigned stock can only be moved between your own warehouse and specialists");
    if (input.fromLabel === input.toLabel) return fail("Choose a different destination");
    if (to?.kind === "agent-rep") {
      const [m] = await db.select({ id: member.id }).from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, to.repUserId), isNull(member.deletedAt))).limit(1);
      if (!m) return fail("That person is not a member of your company");
    }

    // Open consignment lines holding this stock at the source, oldest first
    const srcLines = await db.select({ line: consignLine, header: consignHeader }).from(consignLine)
      .innerJoin(consignHeader, eq(consignHeader.id, consignLine.consignmentId))
      .where(and(eq(consignHeader.organizationId, input.ownerOrgId), eq(consignHeader.agentOrgId, orgId),
        eq(consignHeader.locationLabel, input.fromLabel), eq(consignHeader.status, "open")))
      .orderBy(asc(consignHeader.sentDate), asc(consignLine.expiryDate), asc(consignLine.createdAt));

    // Plan every draw before moving anything
    const problems: string[] = [];
    const plan: { line: typeof consignLine.$inferSelect; header: typeof consignHeader.$inferSelect; qty: number }[] = [];
    for (const it of input.items) {
      const unitIds = [...new Set(it.unitIds ?? [])];
      if (unitIds.length) {
        for (const uid of unitIds) {
          const hit = srcLines.find(({ line }) => line.unitId === uid && line.productId === it.productId && onHand(line) > 1e-9);
          if (!hit) { problems.push(`A selected serial unit is no longer at this location`); continue; }
          const [u] = await db.select({ status: assetUnit.status, label: assetUnit.currentWarehouseLabel }).from(assetUnit).where(eq(assetUnit.id, uid)).limit(1);
          if (u?.label !== input.fromLabel || ![ASSET_UNIT_STATUS.CONSIGNED, ASSET_UNIT_STATUS.WITH_REP].includes(u.status as "CONSIGNED")) {
            problems.push(`${hit.line.productCode} SN ${hit.line.serialNo}: not on the shelf here (e.g. out at a hospital) — it can't be moved now`);
            continue;
          }
          plan.push({ ...hit, qty: 1 });
        }
        continue;
      }
      const qty = Number(it.qty);
      if (!(qty > 0)) continue;
      const lines = srcLines.filter(({ line }) => line.productId === it.productId && !line.unitId && (it.lotNo ? line.lotNo === it.lotNo : true));
      let left = qty;
      for (const l of lines) {
        if (left <= 1e-9) break;
        const already = plan.filter((p) => p.line.id === l.line.id).reduce((a, p) => a + p.qty, 0);
        const take = Math.min(onHand(l.line) - already, left);
        if (take <= 1e-9) continue;
        plan.push({ ...l, qty: take });
        left -= take;
      }
      if (left > 1e-9) {
        const code = lines[0]?.line.productCode ?? "Item";
        problems.push(`${code}${it.lotNo ? ` lot ${it.lotNo}` : ""}: only ${fmtQty(qty - left)} here, asked to move ${fmtQty(qty)}`);
      }
    }
    if (!plan.length && !problems.length) problems.push("Enter a quantity for at least one item");
    if (problems.length) return fail("Can't move this stock", problems);

    const [agentOrg] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)).limit(1);
    const now = new Date();
    const destHeaders = new Map<string, typeof consignHeader.$inferSelect>(); // by owner source warehouse
    const destFor = async (src: typeof consignHeader.$inferSelect) => {
      const cached = destHeaders.get(src.sourceWarehouseLabel);
      if (cached) return cached;
      let [h] = await db.select().from(consignHeader).where(and(
        eq(consignHeader.organizationId, input.ownerOrgId), eq(consignHeader.agentOrgId, orgId), eq(consignHeader.consigneeType, "agent"),
        eq(consignHeader.locationLabel, input.toLabel), eq(consignHeader.sourceWarehouseLabel, src.sourceWarehouseLabel), eq(consignHeader.status, "open"),
      )).orderBy(asc(consignHeader.sentDate)).limit(1);
      if (!h) {
        [h] = await db.insert(consignHeader).values({
          id: nanoid(), organizationId: input.ownerOrgId, consignmentNo: await generateConsignmentNo(input.ownerOrgId),
          consigneeType: "agent", agentOrgId: orgId, agentRepId: to?.kind === "agent-rep" ? to.repUserId : null,
          sourceWarehouseLabel: src.sourceWarehouseLabel, locationLabel: input.toLabel,
          status: "open", sentDate: now, notes: `Moved within ${agentOrg?.name ?? "the agent"} from ${src.consignmentNo}`, createdBy: userId,
        }).returning();
      }
      destHeaders.set(src.sourceWarehouseLabel, h);
      return h;
    };

    let moved = 0;
    for (const { line, header, qty } of plan) {
      const dest = await destFor(header);
      const mvId = await moveStock({
        ownerOrgId: input.ownerOrgId, userId, productId: line.productId, productCode: line.productCode,
        from: input.fromLabel, to: input.toLabel, qty, lotNo: line.lotNo, expiryDate: line.expiryDate,
        unitCost: line.unitCost, unitId: line.unitId, serialNo: line.serialNo,
        movementType: MOVEMENT_TYPE.CONSIGN_MOVE, referenceId: dest.id, referenceNo: dest.consignmentNo,
        notes: `Consigned stock moved by ${agentOrg?.name ?? "agent"} — ${header.consignmentNo} → ${dest.consignmentNo}`,
      });
      // Source line gives it up…
      await db.update(consignLine).set({ qtyMoved: (num(line.qtyMoved) + qty).toFixed(4) }).where(eq(consignLine.id, line.id));
      line.qtyMoved = (num(line.qtyMoved) + qty).toFixed(4);
      await db.insert(consignEvent).values({
        id: nanoid(), consignmentId: header.id, lineId: line.id, organizationId: input.ownerOrgId,
        type: "move_out", qty: qty.toFixed(4), eventDate: now, sourceType: "MOVE", sourceId: dest.id, sourceNo: dest.consignmentNo,
        reason: `to ${dest.consignmentNo}`, stockMovementId: mvId, createdBy: userId,
      });
      // …the destination consignment takes it (serial units: a line each; else top up the same product+lot)
      const [existing] = line.unitId ? [] : await db.select().from(consignLine).where(and(
        eq(consignLine.consignmentId, dest.id), eq(consignLine.productId, line.productId),
        line.lotNo ? eq(consignLine.lotNo, line.lotNo) : isNull(consignLine.lotNo), isNull(consignLine.unitId),
      )).limit(1);
      let destLineId: string;
      if (existing) {
        destLineId = existing.id;
        await db.update(consignLine).set({ qtySent: (num(existing.qtySent) + qty).toFixed(4) }).where(eq(consignLine.id, existing.id));
      } else {
        destLineId = nanoid();
        await db.insert(consignLine).values({
          id: destLineId, consignmentId: dest.id, organizationId: input.ownerOrgId,
          productId: line.productId, productCode: line.productCode, description: line.description, uom: line.uom,
          lotNo: line.lotNo, expiryDate: line.expiryDate, unitId: line.unitId, serialNo: line.serialNo,
          unitCost: line.unitCost, qtySent: qty.toFixed(4),
        });
      }
      await db.insert(consignEvent).values({
        id: nanoid(), consignmentId: dest.id, lineId: destLineId, organizationId: input.ownerOrgId,
        type: "move_in", qty: qty.toFixed(4), eventDate: now, sourceType: "MOVE", sourceId: header.id, sourceNo: header.consignmentNo,
        reason: `from ${header.consignmentNo}`, stockMovementId: mvId, createdBy: userId,
      });
      if (line.unitId) {
        await db.update(assetUnit).set({
          status: to?.kind === "agent-rep" ? ASSET_UNIT_STATUS.WITH_REP : ASSET_UNIT_STATUS.CONSIGNED,
          currentWarehouseLabel: input.toLabel, currentHolderUserId: to?.kind === "agent-rep" ? to.repUserId : null,
        }).where(eq(assetUnit.id, line.unitId));
      }
      moved += qty;
    }
    revalidateConsignment();
    revalidatePath("/dashboard/inventory/movements");
    revalidatePath("/dashboard/consignment/balance");
    return { ok: true, moved };
  });
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getConsignmentSettings() {
  const { orgId, perms } = await ctx("consignment:read");
  const groupIds = await getOrgGroupIds(orgId);
  const [[own], pairs, orgs] = await Promise.all([
    db.select().from(consignSetting).where(eq(consignSetting.organizationId, orgId)).limit(1),
    db.select().from(consignPairSetting).where(eq(consignPairSetting.ownerOrgId, orgId)),
    db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, groupIds)),
  ]);
  return {
    orgId,
    orgName: orgs.find((o) => o.id === orgId)?.name ?? "",
    canEdit: hasAccess(perms, "consignment:manage"),
    setting: {
      consumeOrder: (own?.consumeOrder ?? "consigned_first") as "consigned_first" | "own_first",
      countFrequency: (own?.countFrequency ?? "monthly") as "monthly" | "quarterly" | "none",
    },
    pairs: orgs.filter((o) => o.id !== orgId).map((o) => {
      const p = pairs.find((x) => x.agentOrgId === o.id);
      return {
        agentOrgId: o.id, agentName: o.name,
        allowPassOn: p?.allowPassOn ?? false,
        settlementMode: (p?.settlementMode ?? "manual") as "manual" | "auto",
        settlementFrequency: (p?.settlementFrequency ?? "monthly") as "monthly" | "per_use",
        priceMethod: (p?.priceMethod ?? "cost_plus") as "cost_plus" | "price_list" | "pct_of_sale",
        markupPct: p?.markupPct ?? "0",
        sharePct: p?.sharePct ?? "0",
        machineMethod: (p?.machineMethod ?? "free") as MachineMethod,
        machineFee: p?.machineFee ?? "0",
        machineSharePct: p?.machineSharePct ?? "0",
      };
    }),
  };
}

export async function saveConsignmentSetting(input: { consumeOrder: "consigned_first" | "own_first"; countFrequency: "monthly" | "quarterly" | "none" }): Promise<ActionResult> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:manage");
    if (!["consigned_first", "own_first"].includes(input.consumeOrder)) return fail("Invalid consumption order");
    if (!["monthly", "quarterly", "none"].includes(input.countFrequency)) return fail("Invalid count frequency");
    await db.insert(consignSetting).values({ organizationId: orgId, ...input, updatedBy: userId })
      .onConflictDoUpdate({ target: consignSetting.organizationId, set: { ...input, updatedBy: userId, updatedAt: new Date() } });
    revalidatePath("/dashboard/consignment/settings");
    return { ok: true };
  });
}

export type MachineMethod = "free" | "per_case" | "share_of_fee" | "monthly_rental" | "hospital_fee";
const MACHINE_METHODS: Record<"agent" | "dealer" | "sales_agent", MachineMethod[]> = {
  agent: ["free", "per_case", "share_of_fee", "monthly_rental"],
  dealer: ["free", "per_case", "share_of_fee", "monthly_rental"],
  sales_agent: ["free", "hospital_fee"],
};
function checkMachine(kind: keyof typeof MACHINE_METHODS, method: string, fee: string, share: string) {
  if (!MACHINE_METHODS[kind].includes(method as MachineMethod)) throw new Error("Choose how machines are charged");
  const f = Number(fee || 0), sh = Number(share || 0);
  if ((method === "per_case" || method === "monthly_rental") && !(f > 0)) throw new Error(method === "per_case" ? "Enter the fee per case for machines" : "Enter the monthly rental for machines");
  if (method === "share_of_fee" && !(sh > 0 && sh <= 100)) throw new Error("Machine share % must be between 0 and 100");
  return { machineMethod: method, machineFee: String(f >= 0 ? f : 0), machineSharePct: String(sh >= 0 ? sh : 0) };
}

export async function saveConsignmentPairSetting(input: {
  agentOrgId: string; allowPassOn: boolean;
  settlementMode: "manual" | "auto"; settlementFrequency: "monthly" | "per_use";
  priceMethod: "cost_plus" | "price_list" | "pct_of_sale"; markupPct: string; sharePct: string;
  machineMethod?: MachineMethod; machineFee?: string; machineSharePct?: string;
}): Promise<ActionResult> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:manage");
    const groupIds = await getOrgGroupIds(orgId);
    if (input.agentOrgId === orgId || !groupIds.includes(input.agentOrgId)) return fail("The agent must be another of your companies");
    const markup = Number(input.markupPct), share = Number(input.sharePct);
    if (!(markup >= 0 && markup <= 1000)) return fail("Markup % must be between 0 and 1000");
    if (!(share >= 0 && share <= 100)) return fail("Share % must be between 0 and 100");
    const values = {
      allowPassOn: input.allowPassOn, settlementMode: input.settlementMode, settlementFrequency: input.settlementFrequency,
      priceMethod: input.priceMethod, markupPct: String(markup), sharePct: String(share), updatedBy: userId,
      ...checkMachine("agent", input.machineMethod ?? "free", input.machineFee ?? "0", input.machineSharePct ?? "0"),
    };
    await db.insert(consignPairSetting).values({ id: nanoid(), ownerOrgId: orgId, agentOrgId: input.agentOrgId, ...values })
      .onConflictDoUpdate({ target: [consignPairSetting.ownerOrgId, consignPairSetting.agentOrgId], set: { ...values, updatedAt: new Date() } });
    revalidatePath("/dashboard/consignment/settings");
    return { ok: true };
  });
}

// ── Customer usage (consumption at a customer site) ──────────────────────────

export interface UsageReportInput {
  consignmentId: string;
  usageDate: string;
  reference: string;
  // where it was used — required for sales-agent partners; customer consignments use their own hospital
  hospitalOrgId?: string | null;
  customerId?: string | null;
  items: { lineId: string; qty: number; unitPrice?: string | null; purpose?: "RENTAL" | "LOAN" | "DEMO" | null }[];
}

/** Usage at a customer site or by an external agent (dealer sell-through / sales-agent report). */
export async function recordUsage(input: UsageReportInput): Promise<ActionResult<{ settledInvoices?: string[] }>> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:manage");
    const header = await loadOwnedHeader(input.consignmentId, orgId);
    if (!header) return fail("Consignment not found — only the owner company records usage");
    if (header.consigneeType === "agent") return fail("Agent consumption is recorded through the agent's Case DOs");
    const [partner] = header.partnerId ? await db.select().from(consignPartner).where(eq(consignPartner.id, header.partnerId)).limit(1) : [];
    const isSalesAgent = partner?.model === "sales_agent";
    const hospitalOrgId = header.consigneeType === "customer" ? header.customerOrgId : input.hospitalOrgId || null;
    if (isSalesAgent && !hospitalOrgId) return fail("Choose the hospital where the sales agent's stock was used — it is invoiced to them");
    const { picked, problems } = await validateLineQtys(header, input.items);
    if (problems.length) return fail("Can't record this usage", problems);
    const priceFor = (lineId: string) => {
      const v = input.items.find((i) => i.lineId === lineId)?.unitPrice;
      return v !== undefined && v !== null && v !== "" && Number(v) >= 0 ? Number(v).toFixed(2) : null;
    };
    const ref = input.reference.trim() || `${header.consignmentNo} usage ${new Date(input.usageDate || Date.now()).toLocaleDateString("en-MY")}`;
    const source = { type: "USAGE_REPORT" as const, id: nanoid(), no: ref };
    const pickedUnitIds = picked.map((x) => x.line.unitId).filter(Boolean) as string[];
    const machineUnits = new Set((pickedUnitIds.length ? await db.select({ id: assetUnit.id }).from(assetUnit)
      .where(and(inArray(assetUnit.id, pickedUnitIds), inArray(assetUnit.intendedUse, [...LENDABLE_USES]))) : []).map((u) => u.id));
    for (const { line, qty } of picked) {
      // A machine was used on a case — it stays at the location; only the use is recorded
      if (line.unitId && machineUnits.has(line.unitId)) {
        const fee = priceFor(line.id);
        await recordMachineUse({
          header, line, qty, source, userId, eventDate: input.usageDate ? new Date(input.usageDate) : new Date(),
          hospitalFee: fee !== null ? Number(fee) : null,
          endCustomerOrgId: hospitalOrgId, endCustomerId: header.consigneeType === "customer" ? header.customerId : input.customerId || null,
          purpose: input.items.find((i) => i.lineId === line.id)?.purpose ?? "RENTAL",
        });
        continue;
      }
      const used = await consumeConsigned({
        ownerOrgId: orgId, locationLabel: header.locationLabel, productId: line.productId, qty,
        unitId: line.unitId, source, userId, eventDate: input.usageDate ? new Date(input.usageDate) : new Date(),
        endCustomerOrgId: hospitalOrgId, endCustomerId: header.consigneeType === "customer" ? header.customerId : input.customerId || null,
        unitPrice: priceFor(line.id), lineId: line.id,
      });
      if (used + 1e-9 < qty) return fail(`Only ${fmtQty(used)} of ${line.productCode} could be recorded`);
      if (line.unitId) {
        await db.update(assetUnit).set({ status: ASSET_UNIT_STATUS.SOLD, currentHolderUserId: null, currentCustomerId: header.customerId ?? input.customerId ?? null }).where(eq(assetUnit.id, line.unitId));
      }
    }
    let settledInvoices: string[] | undefined;
    if (partner) {
      const res = await autoSettlePartnerPerUse({ ownerOrgId: orgId, partnerId: partner.id, sourceId: source.id, sourceNo: ref, userId });
      settledInvoices = res?.invoiceNos;
    }
    revalidateConsignment(header.id);
    return { ok: true, settledInvoices };
  });
}

// ── Settlement ───────────────────────────────────────────────────────────────

function monthRange(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const from = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const to = new Date(Number(m[1]), Number(m[2]), 1);
  return { from, to };
}

export async function getSettlementOverview() {
  const { orgId } = await ctx("consignment:settle");
  const groupIds = await getOrgGroupIds(orgId);
  const agents = await db.select({ id: organization.id, name: organization.name }).from(organization)
    .where(and(inArray(organization.id, groupIds), sql`${organization.id} <> ${orgId}`));
  const customerConsignments = await db.select({ id: consignHeader.id, no: consignHeader.consignmentNo, customerOrgId: consignHeader.customerOrgId })
    .from(consignHeader).where(and(eq(consignHeader.organizationId, orgId), eq(consignHeader.consigneeType, "customer")));
  const cOrgs = customerConsignments.length
    ? await db.select({ id: customerOrganization.id, name: customerOrganization.name }).from(customerOrganization)
        .where(inArray(customerOrganization.id, customerConsignments.map((c) => c.customerOrgId).filter(Boolean) as string[]))
    : [];
  const customers = [];
  for (const c of customerConsignments) {
    const lines = await priceUnsettled({ kind: "customer", ownerOrgId: orgId, consignmentId: c.id });
    if (lines.length) customers.push({ consignmentId: c.id, consignmentNo: c.no, hospital: cOrgs.find((o) => o.id === c.customerOrgId)?.name ?? "", lines, total: lines.reduce((s, l) => s + l.amount, 0) });
  }
  const history = await db.select({
    id: consignSettlement.id, type: consignSettlement.consigneeType, total: consignSettlement.total, createdAt: consignSettlement.createdAt,
    periodFrom: consignSettlement.periodFrom, agentOrgId: consignSettlement.agentOrgId,
    invoiceNo: invoice.invoiceNo, invoiceId: invoice.id, poNo: purchaseOrder.poNo, poId: purchaseOrder.id,
  }).from(consignSettlement)
    .leftJoin(invoice, eq(invoice.id, consignSettlement.invoiceId))
    .leftJoin(purchaseOrder, eq(purchaseOrder.id, consignSettlement.purchaseOrderId))
    .where(eq(consignSettlement.organizationId, orgId))
    .orderBy(desc(consignSettlement.createdAt)).limit(50);
  const partners = await db.select({ id: consignPartner.id, name: consignPartner.name, model: consignPartner.model, commissionPct: consignPartner.commissionPct })
    .from(consignPartner).where(eq(consignPartner.organizationId, orgId)).orderBy(asc(consignPartner.name));
  const partnerHist = await db.select({ id: consignSettlement.id, partnerId: consignSettlement.partnerId, invoiceIds: consignSettlement.invoiceIds, commissionTotal: consignSettlement.commissionTotal })
    .from(consignSettlement).where(and(eq(consignSettlement.organizationId, orgId), eq(consignSettlement.consigneeType, "partner")));
  const allInvIds = [...new Set(partnerHist.flatMap((h) => h.invoiceIds ?? []))];
  const invNos = new Map((allInvIds.length ? await db.select({ id: invoice.id, no: invoice.invoiceNo }).from(invoice).where(inArray(invoice.id, allInvIds)) : []).map((x) => [x.id, x.no]));
  return {
    orgId, agents, customers, partners,
    history: history.map((h) => {
      const ph = partnerHist.find((x) => x.id === h.id);
      return {
        ...h, total: num(h.total),
        agentName: h.type === "partner" ? partners.find((x) => x.id === ph?.partnerId)?.name ?? null : agents.find((a) => a.id === h.agentOrgId)?.name ?? null,
        commission: ph?.commissionTotal ? num(ph.commissionTotal) : null,
        invoices: (ph?.invoiceIds ?? []).map((id) => ({ id, no: invNos.get(id) ?? id })),
      };
    }),
  };
}

export async function previewAgentSettlement(agentOrgId: string, month: string): Promise<ActionResult<{ lines: PricedLine[] }>> {
  return guarded(async () => {
    const { orgId } = await ctx("consignment:settle");
    const groupIds = await getOrgGroupIds(orgId);
    if (!groupIds.includes(agentOrgId) || agentOrgId === orgId) return fail("Choose one of your other companies");
    const range = month ? monthRange(month) : null;
    if (month && !range) return fail("Invalid month");
    const lines = await priceUnsettled({ kind: "agent", ownerOrgId: orgId, agentOrgId, from: range?.from, to: range?.to });
    return { ok: true, lines };
  });
}

export async function generateAgentSettlement(agentOrgId: string, month: string): Promise<ActionResult<{ invoiceNo: string; poNo: string; total: number; skipped: number }>> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:settle");
    const groupIds = await getOrgGroupIds(orgId);
    if (!groupIds.includes(agentOrgId) || agentOrgId === orgId) return fail("Choose one of your other companies");
    const range = month ? monthRange(month) : null;
    if (month && !range) return fail("Invalid month");
    const label = range ? range.from.toLocaleDateString("en-MY", { month: "long", year: "numeric" }) : "all unsettled";
    const res = await settleAgent({ ownerOrgId: orgId, agentOrgId, userId, from: range?.from, to: range?.to, label });
    if (!res) return fail("Nothing to settle for this period");
    revalidatePath("/dashboard/consignment/settlement");
    revalidatePath("/dashboard/fulfillment/invoice");
    revalidatePath("/dashboard/procurement/purchase-order");
    return { ok: true, invoiceNo: res.invoiceNo, poNo: res.poNo ?? "", total: res.total, skipped: res.skipped.length };
  });
}

export async function generateCustomerInvoice(consignmentId: string): Promise<ActionResult<{ invoiceNo: string; total: number }>> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:settle");
    const res = await settleCustomer({ ownerOrgId: orgId, consignmentId, userId });
    if (!res) return fail("No unbilled usage on this consignment");
    revalidatePath("/dashboard/consignment/settlement");
    revalidateConsignment(consignmentId);
    revalidatePath("/dashboard/fulfillment/invoice");
    return { ok: true, invoiceNo: res.invoiceNo, total: res.total };
  });
}

// ── Transfer price list (price_method = "price_list") ────────────────────────

export async function getPriceList(agentOrgId: string) {
  const { orgId } = await ctx("consignment:read");
  const [pair] = await db.select().from(consignPairSetting)
    .where(and(eq(consignPairSetting.ownerOrgId, orgId), eq(consignPairSetting.agentOrgId, agentOrgId))).limit(1);
  if (!pair) return [];
  return db.select({ productId: consignPriceItem.productId, price: consignPriceItem.price, productCode: product.productCode, description: product.description })
    .from(consignPriceItem).innerJoin(product, eq(product.id, consignPriceItem.productId))
    .where(eq(consignPriceItem.pairSettingId, pair.id)).orderBy(asc(product.productCode));
}

export async function setPriceListItem(agentOrgId: string, productId: string, price: string | null): Promise<ActionResult> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:manage");
    const groupIds = await getOrgGroupIds(orgId);
    if (!groupIds.includes(agentOrgId) || agentOrgId === orgId) return fail("Choose one of your other companies");
    let [pair] = await db.select().from(consignPairSetting)
      .where(and(eq(consignPairSetting.ownerOrgId, orgId), eq(consignPairSetting.agentOrgId, agentOrgId))).limit(1);
    if (!pair) {
      [pair] = await db.insert(consignPairSetting).values({ id: nanoid(), ownerOrgId: orgId, agentOrgId, priceMethod: "price_list", updatedBy: userId }).returning();
    }
    if (price === null) {
      await db.delete(consignPriceItem).where(and(eq(consignPriceItem.pairSettingId, pair.id), eq(consignPriceItem.productId, productId)));
    } else {
      const v = Number(price);
      if (!(v >= 0)) return fail("Enter a price of 0 or more");
      await db.insert(consignPriceItem).values({ id: nanoid(), pairSettingId: pair.id, productId, price: v.toFixed(2) })
        .onConflictDoUpdate({ target: [consignPriceItem.pairSettingId, consignPriceItem.productId], set: { price: v.toFixed(2) } });
    }
    revalidatePath("/dashboard/consignment/settings");
    return { ok: true };
  });
}

export async function searchProductsForPriceList(query: string) {
  const { orgId } = await ctx("consignment:manage");
  const q = query.trim();
  if (q.length < 2) return [];
  const groupIds = await getOrgGroupIds(orgId);
  return db.select({ id: product.id, productCode: product.productCode, description: product.description, costUnitPrice: product.costUnitPrice })
    .from(product)
    .where(and(inArray(product.organizationId, groupIds), or(sql`${product.productCode} ILIKE ${`%${q}%`}`, sql`${product.description} ILIKE ${`%${q}%`}`)))
    .orderBy(asc(product.productCode)).limit(15);
}

// ── External agents (partners) ───────────────────────────────────────────────

export type PartnerRow = typeof consignPartner.$inferSelect;

export async function listPartners() {
  const { orgId, perms } = await ctx("consignment:read");
  const rows = await db.select().from(consignPartner).where(eq(consignPartner.organizationId, orgId)).orderBy(asc(consignPartner.name));
  const onHand = await db.select({ label: stockLevel.warehouseLabel, qty: sql<string>`sum(${stockLevel.quantity}::numeric)` })
    .from(stockLevel).where(and(eq(stockLevel.organizationId, orgId), like(stockLevel.warehouseLabel, "CS:EXT:%"))).groupBy(stockLevel.warehouseLabel);
  return {
    canEdit: hasAccess(perms, "consignment:manage"),
    partners: rows.map((r) => ({ ...r, onHand: num(onHand.find((o) => o.label === partnerLocation(r.id))?.qty) })),
  };
}

export interface SavePartnerInput {
  id?: string;
  name: string;
  model: "dealer" | "sales_agent";
  contactPerson?: string; phone?: string; email?: string; address?: string;
  priceMethod: "discount" | "price_list" | "cost_plus";
  discountPct: string; markupPct: string; commissionPct: string;
  settlementMode: "manual" | "auto"; settlementFrequency: "monthly" | "per_use";
  active: boolean;
  machineMethod?: MachineMethod; machineFee?: string; machineSharePct?: string; machineCommission?: boolean;
}

export async function savePartner(input: SavePartnerInput): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:manage");
    const name = input.name.trim();
    if (!name) return fail("Enter the agent's name");
    if (!["dealer", "sales_agent"].includes(input.model)) return fail("Choose dealer or sales agent");
    const pct = (v: string, max: number, label: string) => { const n = Number(v || 0); if (!(n >= 0 && n <= max)) throw new Error(`${label} must be between 0 and ${max}`); return String(n); };
    const values = {
      name, model: input.model,
      contactPerson: input.contactPerson?.trim() || null, phone: input.phone?.trim() || null,
      email: input.email?.trim() || null, address: input.address?.trim() || null,
      priceMethod: input.priceMethod, discountPct: pct(input.discountPct, 100, "Discount %"),
      markupPct: pct(input.markupPct, 1000, "Markup %"), commissionPct: pct(input.commissionPct, 100, "Commission %"),
      settlementMode: input.settlementMode, settlementFrequency: input.settlementFrequency, active: input.active,
      ...checkMachine(input.model, input.machineMethod ?? "free", input.machineFee ?? "0", input.machineSharePct ?? "0"),
      machineCommission: input.machineCommission ?? true,
    };
    const [dup] = await db.select({ id: consignPartner.id }).from(consignPartner)
      .where(and(eq(consignPartner.organizationId, orgId), sql`lower(${consignPartner.name}) = lower(${name})`)).limit(1);
    if (dup && dup.id !== input.id) return fail(`An external agent named "${name}" already exists`);
    let id = input.id;
    if (id) {
      const [ex] = await db.select({ id: consignPartner.id, model: consignPartner.model }).from(consignPartner).where(and(eq(consignPartner.id, id), eq(consignPartner.organizationId, orgId))).limit(1);
      if (!ex) return fail("External agent not found");
      if (ex.model !== input.model) {
        const [open] = await db.select({ id: consignEvent.id }).from(consignEvent).innerJoin(consignHeader, eq(consignHeader.id, consignEvent.consignmentId))
          .where(and(eq(consignHeader.partnerId, id), eq(consignEvent.billable, true), isNull(consignEvent.settlementId))).limit(1);
        if (open) return fail("Settle this agent's unbilled usage before switching between dealer and sales agent");
      }
      await db.update(consignPartner).set(values).where(eq(consignPartner.id, id));
    } else {
      id = nanoid();
      await db.insert(consignPartner).values({ id, organizationId: orgId, ...values, createdBy: userId });
    }
    revalidatePath("/dashboard/consignment/partners");
    return { ok: true, id };
  });
}

export async function getPartnerPriceList(partnerId: string) {
  const { orgId } = await ctx("consignment:read");
  return db.select({ productId: consignPartnerPriceItem.productId, price: consignPartnerPriceItem.price, productCode: product.productCode, description: product.description })
    .from(consignPartnerPriceItem).innerJoin(product, eq(product.id, consignPartnerPriceItem.productId))
    .innerJoin(consignPartner, eq(consignPartner.id, consignPartnerPriceItem.partnerId))
    .where(and(eq(consignPartnerPriceItem.partnerId, partnerId), eq(consignPartner.organizationId, orgId)))
    .orderBy(asc(product.productCode));
}

export async function setPartnerPriceItem(partnerId: string, productId: string, price: string | null): Promise<ActionResult> {
  return guarded(async () => {
    const { orgId } = await ctx("consignment:manage");
    const [pt] = await db.select({ id: consignPartner.id }).from(consignPartner).where(and(eq(consignPartner.id, partnerId), eq(consignPartner.organizationId, orgId))).limit(1);
    if (!pt) return fail("External agent not found");
    if (price === null) {
      await db.delete(consignPartnerPriceItem).where(and(eq(consignPartnerPriceItem.partnerId, partnerId), eq(consignPartnerPriceItem.productId, productId)));
    } else {
      const v = Number(price);
      if (!(v >= 0)) return fail("Enter a price of 0 or more");
      await db.insert(consignPartnerPriceItem).values({ id: nanoid(), partnerId, productId, price: v.toFixed(2) })
        .onConflictDoUpdate({ target: [consignPartnerPriceItem.partnerId, consignPartnerPriceItem.productId], set: { price: v.toFixed(2) } });
    }
    revalidatePath("/dashboard/consignment/partners");
    return { ok: true };
  });
}

export async function previewPartnerSettlement(partnerId: string, month: string): Promise<ActionResult<{ lines: PricedLine[] }>> {
  return guarded(async () => {
    const { orgId } = await ctx("consignment:settle");
    const range = month ? monthRange(month) : null;
    if (month && !range) return fail("Invalid month");
    const lines = await priceUnsettled({ kind: "partner", ownerOrgId: orgId, partnerId, from: range?.from, to: range?.to });
    return { ok: true, lines };
  });
}

export async function generatePartnerSettlement(partnerId: string, month: string): Promise<ActionResult<{ invoiceNos: string[]; poNo: string | null; total: number; commission: number; skipped: number }>> {
  return guarded(async () => {
    const { orgId, userId } = await ctx("consignment:settle");
    const range = month ? monthRange(month) : null;
    if (month && !range) return fail("Invalid month");
    const label = range ? range.from.toLocaleDateString("en-MY", { month: "long", year: "numeric" }) : "all unsettled";
    const res = await settlePartner({ ownerOrgId: orgId, partnerId, userId, from: range?.from, to: range?.to, label });
    if (!res) return fail("Nothing to settle for this period");
    revalidatePath("/dashboard/consignment/settlement");
    revalidatePath("/dashboard/fulfillment/invoice");
    revalidatePath("/dashboard/procurement/purchase-order");
    return { ok: true, invoiceNos: res.invoiceNos, poNo: res.poNo ?? null, total: res.total, commission: res.commission, skipped: res.skipped.length };
  });
}
