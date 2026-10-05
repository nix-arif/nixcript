// Consignment engine — stock mechanics shared by the Consignment module
// (server/consign.ts) and Case DOs (server/delivery-order.ts).
//
// NOT a "use server" module on purpose: these functions trust their inputs
// (owner org, location, quantities) and do no permission checks. Only call
// them from server code that has already checked access and scope.

import { db } from "@/db";
import { assetUnit, consignEvent, consignHeader, consignLine, consignPairSetting, consignPartner, consignSetting, stockLevel, stockMovement } from "@/db/schema";
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { applyToLot } from "@/lib/inventory/apply-to-lot";
import { ASSET_UNIT_STATUS, MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";
import { agentRepLocation } from "@/lib/consignment/labels";

const num = (s: string | null | undefined) => parseFloat(s ?? "0") || 0;

/** Apply a signed delta to one (org, product, label) balance; returns the new balance. */
export async function bumpLevel(orgId: string, productId: string, label: string, delta: number, unitCost: string | null): Promise<number> {
  const [l] = await db.select().from(stockLevel)
    .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.productId, productId), eq(stockLevel.warehouseLabel, label))).limit(1);
  const next = num(l?.quantity) + delta;
  if (next < -1e-9) throw new Error(`Not enough stock in ${label}`);
  if (l) {
    await db.update(stockLevel).set({ quantity: next.toFixed(4), updatedAt: new Date() }).where(eq(stockLevel.id, l.id));
  } else {
    await db.insert(stockLevel).values({
      id: nanoid(), organizationId: orgId, productId, warehouseLabel: label,
      quantity: next.toFixed(4), reservedQty: "0", unitCost, updatedAt: new Date(),
    });
  }
  return next;
}

/** Move qty of one product (optionally one lot) between two labels of the owner (to = null: out of stock). */
export async function moveStock(p: {
  ownerOrgId: string; userId: string; productId: string; productCode: string;
  from: string; to: string | null; qty: number; lotNo?: string | null; expiryDate?: Date | null;
  unitCost: string | null; unitId?: string | null; serialNo?: string | null;
  movementType: string; referenceId: string; referenceNo: string; notes: string;
}): Promise<string> {
  let lotId: string | undefined;
  if (p.lotNo) {
    await applyToLot({ orgId: p.ownerOrgId, productId: p.productId, warehouseLabel: p.from, lotNo: p.lotNo, expiryDate: p.expiryDate, signed: -p.qty });
    if (p.to) {
      const dest = await applyToLot({ orgId: p.ownerOrgId, productId: p.productId, warehouseLabel: p.to, lotNo: p.lotNo, expiryDate: p.expiryDate, signed: p.qty, unitCost: p.unitCost });
      lotId = dest.lotId;
    }
  }
  const balance = await bumpLevel(p.ownerOrgId, p.productId, p.from, -p.qty, p.unitCost);
  if (p.to) await bumpLevel(p.ownerOrgId, p.productId, p.to, p.qty, p.unitCost);
  const id = nanoid();
  const now = new Date();
  await db.insert(stockMovement).values({
    id, organizationId: p.ownerOrgId, productId: p.productId, productCode: p.productCode,
    warehouseLabel: p.from, warehouseTo: p.to,
    movementType: p.movementType, quantity: (-p.qty).toFixed(4), balanceAfter: balance.toFixed(4),
    unitCost: p.unitCost,
    referenceType: REF_TYPE.CONSIGNMENT, referenceId: p.referenceId, referenceNo: p.referenceNo,
    notes: p.notes, lotNo: p.lotNo ?? null, expiryDate: p.expiryDate ?? null, lotId: lotId ?? null,
    unitId: p.unitId ?? null, serialNo: p.serialNo ?? null,
    status: "APPROVED", reviewedBy: p.userId, reviewedAt: now, createdBy: p.userId, createdAt: now,
  });
  return id;
}

/** Which stock a Case DO uses first — set by the agent company (default: consigned first). */
export async function getConsumeOrder(agentOrgId: string): Promise<"consigned_first" | "own_first"> {
  const [s] = await db.select({ o: consignSetting.consumeOrder }).from(consignSetting).where(eq(consignSetting.organizationId, agentOrgId)).limit(1);
  return s?.o === "own_first" ? "own_first" : "consigned_first";
}

/** Consigned stock a specialist of `agentOrgId` holds for a product, per owner company. */
export async function consignedHeldByRep(agentOrgId: string, repUserId: string, productId: string) {
  const label = agentRepLocation(agentOrgId, repUserId);
  const rows = await db.select({ ownerOrgId: stockLevel.organizationId, qty: stockLevel.quantity }).from(stockLevel)
    .where(and(eq(stockLevel.productId, productId), eq(stockLevel.warehouseLabel, label), ne(stockLevel.organizationId, agentOrgId)));
  return { label, owners: rows.map((r) => ({ ownerOrgId: r.ownerOrgId, qty: num(r.qty) })).filter((r) => r.qty > 0) };
}

export interface ConsumeSource { type: "CASE_DO" | "USAGE_REPORT"; id: string; no: string }

/**
 * Consume consigned stock at a location (ownership passes to the consignee).
 * Draws from the owner's open consignments at that location, oldest first,
 * lots earliest-expiry first; each draw becomes a billable `consume` event
 * linked to the source document. Returns how much was consumed (≤ qty).
 */
export async function consumeConsigned(p: {
  ownerOrgId: string; locationLabel: string; productId: string; qty: number;
  unitId?: string | null; source: ConsumeSource; userId: string; eventDate?: Date;
  // Partner usage reports: where it was used and the price actually charged
  endCustomerOrgId?: string | null; endCustomerId?: string | null; unitPrice?: string | null;
  // Usage reports name the exact consignment line (and so the lot) that was used
  lineId?: string;
}): Promise<number> {
  const lines = await db.select({ line: consignLine, header: consignHeader })
    .from(consignLine).innerJoin(consignHeader, eq(consignHeader.id, consignLine.consignmentId))
    .where(and(
      eq(consignHeader.organizationId, p.ownerOrgId), eq(consignHeader.locationLabel, p.locationLabel),
      eq(consignHeader.status, "open"), eq(consignLine.productId, p.productId),
      p.unitId ? eq(consignLine.unitId, p.unitId) : isNull(consignLine.unitId),
      p.lineId ? eq(consignLine.id, p.lineId) : undefined,
    ))
    .orderBy(asc(consignHeader.sentDate), asc(consignLine.expiryDate), asc(consignLine.createdAt));

  let remaining = p.qty;
  for (const { line, header } of lines) {
    if (remaining <= 1e-9) break;
    const onHand = num(line.qtySent) - num(line.qtyConsumed) - num(line.qtyReturned) - num(line.qtyAdjusted) - num(line.qtyMoved);
    if (onHand <= 1e-9) continue;
    const take = Math.min(onHand, remaining);
    const mvId = await moveStock({
      ownerOrgId: p.ownerOrgId, userId: p.userId, productId: p.productId, productCode: line.productCode,
      from: p.locationLabel, to: null, qty: take, lotNo: line.lotNo, expiryDate: line.expiryDate,
      unitCost: line.unitCost, unitId: line.unitId, serialNo: line.serialNo,
      movementType: MOVEMENT_TYPE.CONSIGN_USE, referenceId: header.id, referenceNo: header.consignmentNo,
      notes: `Consignment used — ${p.source.no} (${header.consignmentNo})`,
    });
    await db.update(consignLine).set({ qtyConsumed: (num(line.qtyConsumed) + take).toFixed(4) }).where(eq(consignLine.id, line.id));
    await db.insert(consignEvent).values({
      id: nanoid(), consignmentId: header.id, lineId: line.id, organizationId: p.ownerOrgId,
      type: "consume", qty: take.toFixed(4), eventDate: p.eventDate ?? new Date(),
      sourceType: p.source.type, sourceId: p.source.id, sourceNo: p.source.no,
      endCustomerOrgId: p.endCustomerOrgId ?? null, endCustomerId: p.endCustomerId ?? null, unitPrice: p.unitPrice ?? null,
      billable: true, stockMovementId: mvId, createdBy: p.userId,
    });
    remaining -= take;
  }
  return p.qty - remaining;
}

/**
 * Undo every consumption recorded against a source document (a Case DO being
 * deleted or returned): stock goes back to the consignment location it was
 * used from, and the consume events stop being billable. Refuses when any of
 * them is already settled (billed) — that needs a credit, not a silent undo.
 */
export async function reverseConsumption(p: { sourceType: ConsumeSource["type"]; sourceId: string; userId: string; reason: string }): Promise<void> {
  const events = await db.select({ ev: consignEvent, line: consignLine, header: consignHeader })
    .from(consignEvent)
    .innerJoin(consignLine, eq(consignLine.id, consignEvent.lineId))
    .innerJoin(consignHeader, eq(consignHeader.id, consignEvent.consignmentId))
    .where(and(eq(consignEvent.type, "consume"), eq(consignEvent.sourceType, p.sourceType), eq(consignEvent.sourceId, p.sourceId), eq(consignEvent.billable, true), gt(sql`${consignEvent.qty}::numeric`, 0)));
  const settled = events.filter((e) => e.ev.settlementId);
  if (settled.length) {
    throw new Error(`Consigned stock used here is already settled (${[...new Set(settled.map((e) => e.header.consignmentNo))].join(", ")}) — it can't be reversed automatically`);
  }
  for (const { ev, line, header } of events) {
    const qty = num(ev.qty);
    // Put the stock back at the consignment location it was used from
    let lotId: string | undefined;
    if (line.lotNo) {
      const dest = await applyToLot({ orgId: header.organizationId, productId: line.productId, warehouseLabel: header.locationLabel, lotNo: line.lotNo, expiryDate: line.expiryDate, signed: qty, unitCost: line.unitCost });
      lotId = dest.lotId;
    }
    const balance = await bumpLevel(header.organizationId, line.productId, header.locationLabel, qty, line.unitCost);
    const now = new Date();
    await db.insert(stockMovement).values({
      id: nanoid(), organizationId: header.organizationId, productId: line.productId, productCode: line.productCode,
      warehouseLabel: header.locationLabel, warehouseTo: null,
      movementType: MOVEMENT_TYPE.CONSIGN_REVERSE, quantity: qty.toFixed(4), balanceAfter: balance.toFixed(4),
      unitCost: line.unitCost, referenceType: REF_TYPE.CONSIGNMENT, referenceId: header.id, referenceNo: header.consignmentNo,
      notes: `Consignment use reversed — ${ev.sourceNo ?? ""} (${p.reason})`, lotNo: line.lotNo, expiryDate: line.expiryDate, lotId: lotId ?? null,
      unitId: line.unitId, serialNo: line.serialNo,
      status: "APPROVED", reviewedBy: p.userId, reviewedAt: now, createdBy: p.userId, createdAt: now,
    });
    await db.update(consignLine).set({ qtyConsumed: Math.max(0, num(line.qtyConsumed) - qty).toFixed(4) }).where(eq(consignLine.id, line.id));
    await db.update(consignEvent).set({ billable: false, reason: `reversed: ${p.reason}` }).where(eq(consignEvent.id, ev.id));
    await db.insert(consignEvent).values({
      id: nanoid(), consignmentId: header.id, lineId: line.id, organizationId: header.organizationId,
      type: "reverse", qty: qty.toFixed(4), eventDate: now, sourceType: ev.sourceType, sourceId: ev.sourceId, sourceNo: ev.sourceNo,
      reason: p.reason, billable: false, createdBy: p.userId,
    });
    if (line.unitId) {
      const loc = header.locationLabel;
      const rep = /:REP:([^:]+)$/.exec(loc)?.[1] ?? null;
      await db.update(assetUnit).set({
        status: rep ? ASSET_UNIT_STATUS.WITH_REP : ASSET_UNIT_STATUS.CONSIGNED,
        currentWarehouseLabel: loc, currentHolderUserId: rep, currentCustomerId: null,
      }).where(eq(assetUnit.id, line.unitId));
    }
  }
}

/** Owners' consigned units held by a specialist (serial-tracked), for Case DO pickers. */
export async function consignedUnitIdsAtRep(agentOrgId: string, repUserId: string): Promise<Set<string>> {
  const label = agentRepLocation(agentOrgId, repUserId);
  const rows = await db.select({ id: assetUnit.id }).from(assetUnit)
    .where(and(eq(assetUnit.currentWarehouseLabel, label), inArray(assetUnit.status, [ASSET_UNIT_STATUS.WITH_REP, ASSET_UNIT_STATUS.CONSIGNED])));
  return new Set(rows.map((r) => r.id));
}


// ── Machines (rental units) ──────────────────────────────────────────────────
// A consigned machine is never consumed: it is used on a case and stays the
// owner's. Each use is a `machine_use` event; what the owner charges for it
// follows the consignee's machine setting, fixed at the moment of use.

export interface MachinePolicy {
  method: "free" | "per_case" | "share_of_fee" | "monthly_rental" | "hospital_fee";
  fee: number;       // per case (per_case) or per month (monthly_rental)
  sharePct: number;  // share_of_fee
  commission: boolean; // sales agent: commission on the hospital fee
}

/** The machine setting that applies to one consignment (agent pair, external agent, or hospital). */
export async function machinePolicyFor(header: typeof consignHeader.$inferSelect): Promise<MachinePolicy> {
  if (header.consigneeType === "agent" && header.agentOrgId) {
    const [pair] = await db.select().from(consignPairSetting)
      .where(and(eq(consignPairSetting.ownerOrgId, header.organizationId), eq(consignPairSetting.agentOrgId, header.agentOrgId))).limit(1);
    return { method: (pair?.machineMethod ?? "free") as MachinePolicy["method"], fee: num(pair?.machineFee), sharePct: num(pair?.machineSharePct), commission: false };
  }
  if (header.consigneeType === "partner" && header.partnerId) {
    const [pt] = await db.select().from(consignPartner).where(eq(consignPartner.id, header.partnerId)).limit(1);
    return { method: (pt?.machineMethod ?? "free") as MachinePolicy["method"], fee: num(pt?.machineFee), sharePct: num(pt?.machineSharePct), commission: pt?.machineCommission ?? true };
  }
  // A machine kept at a hospital: the hospital pays the per-case fee recorded with each use
  return { method: "hospital_fee", fee: 0, sharePct: 0, commission: false };
}

/** What the owner bills for one use, given the fee charged to the hospital (null = nothing to bill). */
export function machineCharge(policy: MachinePolicy, hospitalFee: number | null): number | null {
  const fee = hospitalFee ?? 0;
  switch (policy.method) {
    case "per_case": return policy.fee > 0 ? policy.fee : null;
    case "share_of_fee": return fee > 0 && policy.sharePct > 0 ? Math.round(fee * policy.sharePct) / 100 : null;
    case "hospital_fee": return fee > 0 ? fee : null;
    default: return null; // free, or monthly_rental (billed per month, not per case)
  }
}

/** Record one use of a consigned machine (no stock leaves the owner). */
export async function recordMachineUse(p: {
  header: typeof consignHeader.$inferSelect; line: typeof consignLine.$inferSelect; qty: number;
  source: ConsumeSource; userId: string; eventDate?: Date;
  hospitalFee: number | null; endCustomerOrgId?: string | null; endCustomerId?: string | null;
  purpose?: string | null; // RENTAL | LOAN | DEMO — why it went out this time
}) {
  const policy = await machinePolicyFor(p.header);
  const charge = machineCharge(policy, p.hospitalFee);
  await db.insert(consignEvent).values({
    id: nanoid(), consignmentId: p.header.id, lineId: p.line.id, organizationId: p.header.organizationId,
    type: "machine_use", qty: p.qty.toFixed(4), eventDate: p.eventDate ?? new Date(),
    sourceType: p.source.type, sourceId: p.source.id, sourceNo: p.source.no,
    endCustomerOrgId: p.endCustomerOrgId ?? null, endCustomerId: p.endCustomerId ?? null,
    unitPrice: p.hospitalFee !== null && p.hospitalFee > 0 ? p.hospitalFee.toFixed(2) : null,
    chargePrice: charge !== null ? charge.toFixed(2) : null,
    purpose: p.purpose ?? null,
    reason: policy.method === "hospital_fee" && !policy.commission ? "no-commission" : null,
    billable: charge !== null && charge > 0, createdBy: p.userId,
  });
  return { charge, method: policy.method };
}

/** The open consignment line a specialist's consigned unit belongs to. */
export async function consignedLineForUnit(unitId: string) {
  const [row] = await db.select({ line: consignLine, header: consignHeader }).from(consignLine)
    .innerJoin(consignHeader, eq(consignHeader.id, consignLine.consignmentId))
    .where(and(eq(consignLine.unitId, unitId), eq(consignHeader.status, "open"))).limit(1);
  return row ?? null;
}

/** Undo the machine uses of a deleted/returned Case DO or usage report — refused once settled. */
export async function reverseMachineUse(p: { sourceType: ConsumeSource["type"]; sourceId: string; reason: string }): Promise<void> {
  const events = await db.select({ ev: consignEvent, no: consignHeader.consignmentNo }).from(consignEvent)
    .innerJoin(consignHeader, eq(consignHeader.id, consignEvent.consignmentId))
    .where(and(eq(consignEvent.type, "machine_use"), eq(consignEvent.sourceType, p.sourceType), eq(consignEvent.sourceId, p.sourceId)));
  const live = events.filter((e) => !(e.ev.reason ?? "").startsWith("reversed"));
  const settled = live.filter((e) => e.ev.settlementId);
  if (settled.length) {
    throw new Error(`Machine use here is already settled (${[...new Set(settled.map((e) => e.no))].join(", ")}) — it can't be reversed automatically`);
  }
  if (live.length) {
    await db.update(consignEvent).set({ billable: false, reason: `reversed: ${p.reason}` }).where(inArray(consignEvent.id, live.map((e) => e.ev.id)));
  }
}
