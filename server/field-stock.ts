"use server";

import { db } from "@/db";
import { stockLevel, stockMovement, member, user, product, staffStockLimit, organizationProfile, stockLot, organization, assetUnit, consignPairSetting } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { eq, and, inArray, sql, desc, isNull, asc, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { MOVEMENT_TYPE, REF_TYPE, fieldWarehouseLabel, consignedWarehouseLabel, consignedFieldWarehouseLabel } from "@/lib/inventory/constants";
import { agentRepLocation } from "@/lib/consignment/labels";
import { nonMemberFieldHolders } from "@/lib/inventory/field-holder";
import { applyToLot } from "@/lib/inventory/apply-to-lot";
import { revalidatePath } from "next/cache";

async function getSession() {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("No active organization");
  return { orgId: session.session.activeOrganizationId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Access denied");
  return { orgId, userId };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RepStockItem {
  productId: string;
  productCode: string;
  description: string;
  uom: string | null;
  qty: number;
  unitCost: string | null;
  isRental: boolean;
  itemGroupIds?: string[]; // user-defined item groups (Inventory → Item Groups), can be several
  sellingPrice?: string | null; // product's selling price (Case DO itemized price default)
  lots: { lotNo: string; expiryDate: Date | null; quantity: string }[];
  // Present (non-empty) only for serial-tracked products: the specific
  // physical units this rep currently holds, each with its own fixed
  // Sale/Rental designation — Case DO reads this instead of asking the
  // person creating the DO to classify the item themselves.
  units: { id: string; serialNo: string; intendedUse: string }[];
  // qty above is the combined total (owned + consigned); this breaks it
  // down for visibility only — Case DO deduction (server/delivery-order.ts)
  // depletes these consigned buckets before the plain owned holding.
  // noTerms: the owner hasn't set consignment terms for this company — not usable on a Case DO
  consignedBreakdown?: { sourceOrgId: string; sourceOrgName: string; qty: number; noTerms?: boolean }[];
}

export interface RepSummary {
  repId: string;
  repName: string;
  warehouseLabel: string;
  items: RepStockItem[];
  totalItems: number;
  // Machines this specialist lent out on a Case DO that are still at the
  // hospital — not in the qty above (they left the holding), but theirs to bring back
  onLoan?: OnLoanMachine[];
}

export interface OnLoanMachine {
  unitId: string;
  serialNo: string;
  productCode: string;
  description: string;
  intendedUse: string;
  purpose: string | null; // RENTAL | LOAN | DEMO, as chosen on the Case DO
  doId: string | null;
  doNo: string | null;
  since: Date | null;
  customerName: string | null;
  consignedFrom: string | null; // owner company, when it's another company's machine
}

export interface OrgMember {
  id: string;
  name: string;
  role: string;
  // Set only when this person's membership comes from a sibling org (same
  // owner group) rather than the caller's own active org — a shared staff
  // member (e.g. a sales rep or application specialist covering several
  // group companies) who doesn't belong to the active org directly. Lets
  // pickers show which org they actually belong to instead of silently
  // treating them as local.
  otherOrgName?: string;
}

export interface FieldTransferItem {
  productId: string;
  qty: number;
  // Serial-tracked items (machines): the exact units moved — qty follows
  unitIds?: string[];
  lotId?: string;
  lotNo?: string;
  expiryDate?: Date | null;
  // Set when moving stock that's still owned by a sibling org (consigned in
  // via server/consignment-transfer.ts) rather than this org's own stock —
  // source/destination become the compound "Consigned:<orgId>" labels
  // instead of the plain main/field warehouse, preserving the ownership tag
  // through the hop. See lib/inventory/constants.ts.
  consignedFromOrgId?: string;
}

export interface FieldTransferInput {
  repId: string;
  repName: string;
  items: FieldTransferItem[];
  notes?: string;
}

export interface FieldMovementRow {
  id: string;
  productId: string;
  productCode: string;
  warehouseLabel: string;
  warehouseTo: string | null;
  movementType: string;
  quantity: string;
  referenceNo: string;
  notes: string | null;
  lotNo: string | null;
  expiryDate: Date | null;
  serialNo: string | null;
  status: string;
  createdAt: Date;
  // Seen from one specialist's holding (a movement between two specialists
  // appears once for each): the change to what they hold, and what they
  // held of that product (same owner) right after it.
  repId: string;
  delta: number;
  balance: number | null; // null while pending / rejected — it didn't change stock
  consignedFrom: string | null; // owner company, for another company's consigned stock
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getMainWarehouseLabel(): Promise<string> {
  const { orgId } = await requireAccess("inventory:read");
  return getMainWarehouseLabelInternal(orgId);
}

// Members of every sibling org under the same owner, not just the active
// org — a sales person / application specialist / field rep is often shared
// across group companies (see resolveMainWarehouseLabel-style owner-group
// pattern used throughout this file), and without this they were only
// reachable by typing their name as free text, which never links to their
// real user id — silently skipping CASE_USE stock deduction and leaving
// them unpickable on the Field Stock transfer page for any org but their own.
export async function getFieldReps(): Promise<OrgMember[]> {
  const { orgId } = await requireAccess("inventory:read");
  const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);
  const rows = await db
    .select({ id: member.userId, name: user.name, role: member.role, organizationId: member.organizationId, orgName: organization.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(inArray(member.organizationId, ownerOrgIds), isNull(member.deletedAt)))
    .orderBy(user.name);

  // The same person can hold a membership row in more than one sibling org —
  // keep a single entry per person, preferring their own membership in the
  // CURRENT org (so role reflects that) over a sibling-org one when both exist.
  const byUser = new Map<string, OrgMember>();
  for (const r of rows) {
    const isCurrentOrg = r.organizationId === orgId;
    const already = byUser.get(r.id);
    if (already && !already.otherOrgName) continue;
    byUser.set(r.id, {
      id: r.id,
      name: r.name ?? r.id,
      role: r.role,
      otherOrgName: isCurrentOrg ? undefined : r.orgName,
    });
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Field stock locations of the active company for stock movements: its own
 * members only, plus anyone outside it who still holds a balance on its
 * books (flagged, so that balance can be cleared — nothing new can go to them).
 */
export async function getFieldLocations(): Promise<{ label: string; address: string; notMember?: boolean }[]> {
  const { orgId } = await requireAccess("inventory:read");
  const [own, leftover] = await Promise.all([
    db.select({ id: member.userId, name: user.name }).from(member).innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt))).orderBy(user.name),
    nonMemberFieldHolders(orgId),
  ]);
  return [
    ...own.map((m) => ({ label: `Field:${m.id}`, address: m.name ?? m.id })),
    ...leftover.map((m) => ({ label: `Field:${m.id}`, address: `${m.name} (not a member — clear this balance)`, notMember: true })),
  ];
}

// A rep's field stock for a given product can live under whichever sibling
// org actually transferred it to them (see resolveFieldStockOrg's twin logic
// in server/delivery-order.ts) — not necessarily the org the caller is
// currently viewing from. Searching only the active org here is what made a
// Case DO's item picker show nothing for an application specialist whose
// stock was transferred to them under a different org: their balance was
// real, just invisible from this org's query. Search the whole owner group
// and merge, so what's shown here always matches what the deduction side can
// actually find and consume.
export async function getRepFieldStock(repId: string): Promise<RepStockItem[]> {
  const { orgId } = await requireAccess("inventory:read");
  const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);
  const label = fieldWarehouseLabel(repId);
  const rows = await db
    .select({
      productId: stockLevel.productId,
      qty: stockLevel.quantity,
      unitCost: stockLevel.unitCost,
      productCode: product.productCode,
      description: product.description,
      uom: product.uom,
      isRental: product.isRental,
    })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(inArray(stockLevel.organizationId, ownerOrgIds), eq(stockLevel.warehouseLabel, label)));

  const lots = await db
    .select({ productId: stockLot.productId, lotNo: stockLot.lotNo, expiryDate: stockLot.expiryDate, quantity: stockLot.quantity })
    .from(stockLot)
    .where(and(inArray(stockLot.organizationId, ownerOrgIds), eq(stockLot.warehouseLabel, label)))
    .orderBy(asc(stockLot.expiryDate), asc(stockLot.lotNo));
  const lotsByProduct = new Map<string, RepStockItem["lots"]>();
  for (const l of lots) {
    if (parseFloat(l.quantity) <= 0) continue;
    const arr = lotsByProduct.get(l.productId) ?? [];
    arr.push({ lotNo: l.lotNo, expiryDate: l.expiryDate, quantity: l.quantity });
    lotsByProduct.set(l.productId, arr);
  }

  const heldUnits = await db
    .select({ id: assetUnit.id, productId: assetUnit.productId, serialNo: assetUnit.serialNo, intendedUse: assetUnit.intendedUse })
    .from(assetUnit)
    .where(and(
      inArray(assetUnit.currentOrgId, ownerOrgIds),
      eq(assetUnit.currentHolderUserId, repId),
      eq(assetUnit.status, "WITH_REP"),
    ));
  const unitsByProduct = new Map<string, RepStockItem["units"]>();
  for (const u of heldUnits) {
    const arr = unitsByProduct.get(u.productId) ?? [];
    arr.push({ id: u.id, serialNo: u.serialNo, intendedUse: u.intendedUse });
    unitsByProduct.set(u.productId, arr);
  }

  // Consigned stock (Consignment module): another company's stock placed
  // with this specialist stays on the OWNER's books at the location
  // "CS:ORG:<thisCompany>:REP:<repId>" (lib/consignment/labels.ts). Shown
  // here so a Case DO can pick it; the deduction side consumes it through
  // the consignment engine (and bills it to this company at settlement).
  const csLabel = agentRepLocation(orgId, repId);
  const consignedRows = await db
    .select({ productId: stockLevel.productId, ownerOrgId: stockLevel.organizationId, qty: stockLevel.quantity })
    .from(stockLevel)
    .where(and(inArray(stockLevel.organizationId, ownerOrgIds), ne(stockLevel.organizationId, orgId), eq(stockLevel.warehouseLabel, csLabel)));
  const csLots = await db
    .select({ productId: stockLot.productId, lotNo: stockLot.lotNo, expiryDate: stockLot.expiryDate, quantity: stockLot.quantity })
    .from(stockLot)
    .where(and(inArray(stockLot.organizationId, ownerOrgIds), ne(stockLot.organizationId, orgId), eq(stockLot.warehouseLabel, csLabel)))
    .orderBy(asc(stockLot.expiryDate), asc(stockLot.lotNo));
  for (const l of csLots) {
    if (parseFloat(l.quantity) <= 0) continue;
    const arr = lotsByProduct.get(l.productId) ?? [];
    arr.push({ lotNo: l.lotNo, expiryDate: l.expiryDate, quantity: l.quantity });
    lotsByProduct.set(l.productId, arr);
  }
  const consignedSourceOrgIds = [...new Set(consignedRows.map((r) => r.ownerOrgId))];
  const sourceOrgNames = consignedSourceOrgIds.length
    ? await db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, consignedSourceOrgIds))
    : [];
  const orgNameById = new Map(sourceOrgNames.map((o) => [o.id, o.name]));
  // Owners with consignment terms for this company — without them their stock can't be used
  const termed = consignedSourceOrgIds.length
    ? new Set((await db.select({ owner: consignPairSetting.ownerOrgId }).from(consignPairSetting)
        .where(and(inArray(consignPairSetting.ownerOrgId, consignedSourceOrgIds), eq(consignPairSetting.agentOrgId, orgId)))).map((r) => r.owner))
    : new Set<string>();
  const consignedByProduct = new Map<string, RepStockItem["consignedBreakdown"]>();
  for (const r of consignedRows) {
    const qty = parseFloat(r.qty);
    if (qty <= 0) continue;
    const arr = consignedByProduct.get(r.productId) ?? [];
    arr.push({ sourceOrgId: r.ownerOrgId, sourceOrgName: orgNameById.get(r.ownerOrgId) ?? r.ownerOrgId, qty, noTerms: !termed.has(r.ownerOrgId) });
    consignedByProduct.set(r.productId, arr);
  }

  // Same rep + product can have separate balances under more than one
  // sibling org (rare, but possible) — merge into one pickable line so the
  // qty shown is the true total this person is actually holding.
  const byProduct = new Map<string, RepStockItem>();
  for (const r of rows) {
    const qty = parseFloat(r.qty);
    if (qty <= 0) continue;
    const existing = byProduct.get(r.productId);
    if (existing) {
      existing.qty += qty;
      existing.lots = [...existing.lots, ...(lotsByProduct.get(r.productId) ?? [])];
      // units aren't per-org — already the full set for this product, added once below.
      continue;
    }
    byProduct.set(r.productId, {
      productId: r.productId,
      productCode: r.productCode,
      description: r.description ?? "",
      uom: r.uom ?? null,
      qty,
      unitCost: r.unitCost,
      isRental: r.isRental,
      lots: lotsByProduct.get(r.productId) ?? [],
      units: unitsByProduct.get(r.productId) ?? [],
    });
  }

  // Fold consigned qty into the same rows (total qty includes it; the
  // breakdown is additive detail) — some products may be held ONLY as
  // consigned stock (no owned qty at all), so those need a fresh product
  // lookup since they never went through the `rows` loop above.
  const missingProductIds = [...consignedByProduct.keys()].filter((id) => !byProduct.has(id));
  if (missingProductIds.length > 0) {
    const missingProducts = await db
      .select({ id: product.id, productCode: product.productCode, description: product.description, uom: product.uom, isRental: product.isRental })
      .from(product)
      .where(inArray(product.id, missingProductIds));
    for (const p of missingProducts) {
      byProduct.set(p.id, {
        productId: p.id, productCode: p.productCode, description: p.description ?? "", uom: p.uom ?? null,
        qty: 0, unitCost: null, isRental: p.isRental,
        lots: lotsByProduct.get(p.id) ?? [], units: unitsByProduct.get(p.id) ?? [],
      });
    }
  }
  for (const [productId, breakdown] of consignedByProduct) {
    const item = byProduct.get(productId);
    if (!item || !breakdown) continue;
    item.consignedBreakdown = breakdown;
    item.qty += breakdown.reduce((sum, b) => sum + b.qty, 0);
  }

  // Item groups (user-defined) — the Case DO lists the holding under them
  const { groupIdsByProduct } = await import("@/lib/inventory/item-groups");
  const memberOf = await groupIdsByProduct([...byProduct.values()].map((i) => i.productId));
  const priceIds = [...byProduct.keys()];
  const prices = new Map((priceIds.length ? await db.select({ id: product.id, price: product.sellingUnitPrice }).from(product).where(inArray(product.id, priceIds)) : []).map((p) => [p.id, p.price]));
  // Fixed order (product code) — rows come back from the database in no
  // particular order, so lists would otherwise shuffle after every change
  return [...byProduct.values()]
    .sort((a, b) => a.productCode.localeCompare(b.productCode, undefined, { numeric: true }))
    .map((i) => ({ ...i, itemGroupIds: memberOf.get(i.productId) ?? [], sellingPrice: prices.get(i.productId) ?? null }));
}

export async function getWarehouseStockQty(productId: string, warehouseLabel: string): Promise<number> {
  const { orgId } = await requireAccess("inventory:read");
  const [row] = await db
    .select({ quantity: stockLevel.quantity })
    .from(stockLevel)
    .where(and(
      eq(stockLevel.organizationId, orgId),
      eq(stockLevel.productId, productId),
      eq(stockLevel.warehouseLabel, warehouseLabel),
    ))
    .limit(1);
  return row ? parseFloat(row.quantity) : 0;
}

export async function getAllRepFieldStock(): Promise<RepSummary[]> {
  const { orgId } = await requireAccess("inventory:read");

  const rows = await db
    .select({
      productId: stockLevel.productId,
      qty: stockLevel.quantity,
      unitCost: stockLevel.unitCost,
      warehouseLabel: stockLevel.warehouseLabel,
      productCode: product.productCode,
      description: product.description,
      uom: product.uom,
      isRental: product.isRental,
    })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(
      eq(stockLevel.organizationId, orgId),
      sql`${stockLevel.warehouseLabel} LIKE 'Field:%'`,
    ));

  const repIds = [...new Set(rows.map((r) => r.warehouseLabel.replace("Field:", "")))];
  const repUsers = repIds.length > 0
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, repIds))
    : [];
  const userMap = Object.fromEntries(repUsers.map((u) => [u.id, u.name ?? u.id]));

  const lotRows = await db
    .select({ productId: stockLot.productId, warehouseLabel: stockLot.warehouseLabel, lotNo: stockLot.lotNo, expiryDate: stockLot.expiryDate, quantity: stockLot.quantity })
    .from(stockLot)
    .where(and(
      eq(stockLot.organizationId, orgId),
      sql`${stockLot.warehouseLabel} LIKE 'Field:%'`,
    ))
    .orderBy(asc(stockLot.expiryDate), asc(stockLot.lotNo));
  const lotsByKey = new Map<string, RepStockItem["lots"]>();
  for (const l of lotRows) {
    if (parseFloat(l.quantity) <= 0) continue;
    const key = `${l.warehouseLabel}:${l.productId}`;
    const arr = lotsByKey.get(key) ?? [];
    arr.push({ lotNo: l.lotNo, expiryDate: l.expiryDate, quantity: l.quantity });
    lotsByKey.set(key, arr);
  }

  // Serial numbers held at each holding (own field stock + consigned with a rep)
  const ownerGroup = await getOwnerOrgIdsInternal(orgId);
  const heldUnits = await db.select({ id: assetUnit.id, serialNo: assetUnit.serialNo, intendedUse: assetUnit.intendedUse, label: assetUnit.currentWarehouseLabel, productId: assetUnit.productId })
    .from(assetUnit)
    .where(and(inArray(assetUnit.organizationId, ownerGroup), eq(assetUnit.status, "WITH_REP"),
      sql`(${assetUnit.currentWarehouseLabel} LIKE 'Field:%' OR ${assetUnit.currentWarehouseLabel} LIKE ${`CS:ORG:${orgId}:REP:%`})`))
    .orderBy(asc(assetUnit.serialNo));
  const unitsAt = (label: string, productId: string) =>
    heldUnits.filter((u) => u.label === label && u.productId === productId).map(({ id, serialNo, intendedUse }) => ({ id, serialNo, intendedUse }));

  const repMap = new Map<string, RepSummary>();
  for (const row of rows) {
    const repId = row.warehouseLabel.replace("Field:", "");
    const qty = parseFloat(row.qty);
    if (qty <= 0) continue;
    if (!repMap.has(repId)) {
      repMap.set(repId, {
        repId,
        repName: userMap[repId] ?? repId,
        warehouseLabel: row.warehouseLabel,
        items: [],
        totalItems: 0,
      });
    }
    const rep = repMap.get(repId)!;
    rep.items.push({
      productId: row.productId,
      productCode: row.productCode,
      description: row.description ?? "",
      uom: row.uom ?? null,
      qty,
      unitCost: row.unitCost,
      isRental: row.isRental,
      itemGroupIds: [],
      lots: lotsByKey.get(`${row.warehouseLabel}:${row.productId}`) ?? [],
      units: unitsAt(row.warehouseLabel, row.productId),
    });
    rep.totalItems += qty;
  }

  // Consigned stock held by this company's specialists: another company's
  // stock on consignment stays on the OWNER's books at
  // "CS:ORG:<thisCompany>:REP:<repId>" (Consignment module). Shown per rep as
  // separate lines tagged with the owner, so holdings match what they carry.
  const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);
  const csPrefix = `CS:ORG:${orgId}:REP:`;
  const csRows = await db
    .select({
      label: stockLevel.warehouseLabel, ownerOrgId: stockLevel.organizationId, productId: stockLevel.productId,
      qty: stockLevel.quantity, unitCost: stockLevel.unitCost,
      productCode: product.productCode, description: product.description, uom: product.uom, isRental: product.isRental,
    })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(inArray(stockLevel.organizationId, ownerOrgIds), ne(stockLevel.organizationId, orgId), sql`${stockLevel.warehouseLabel} LIKE ${csPrefix + "%"}`));
  const live = csRows.filter((r) => parseFloat(r.qty) > 0);
  if (live.length) {
    const newRepIds = [...new Set(live.map((r) => r.label.slice(csPrefix.length)))].filter((id) => !repMap.has(id));
    const [owners, newReps] = await Promise.all([
      db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, [...new Set(live.map((r) => r.ownerOrgId))])),
      newRepIds.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, newRepIds)) : Promise.resolve([] as { id: string; name: string | null }[]),
    ]);
    const ownerName = new Map(owners.map((o) => [o.id, o.name]));
    const repName = new Map(newReps.map((u) => [u.id, u.name ?? u.id]));
    for (const r of live) {
      const repId = r.label.slice(csPrefix.length);
      if (!repMap.has(repId)) {
        repMap.set(repId, { repId, repName: repName.get(repId) ?? repId, warehouseLabel: fieldWarehouseLabel(repId), items: [], totalItems: 0 });
      }
      const rep = repMap.get(repId)!;
      const qty = parseFloat(r.qty);
      const csLots = await db.select({ lotNo: stockLot.lotNo, expiryDate: stockLot.expiryDate, quantity: stockLot.quantity }).from(stockLot)
        .where(and(eq(stockLot.organizationId, r.ownerOrgId), eq(stockLot.productId, r.productId), eq(stockLot.warehouseLabel, r.label)))
        .orderBy(asc(stockLot.expiryDate), asc(stockLot.lotNo));
      rep.items.push({
        productId: r.productId, productCode: r.productCode, description: r.description ?? "", uom: r.uom ?? null,
        qty, unitCost: r.unitCost, isRental: r.isRental, itemGroupIds: [],
        lots: csLots.filter((l) => parseFloat(l.quantity) > 0), units: unitsAt(r.label, r.productId),
        consignedBreakdown: [{ sourceOrgId: r.ownerOrgId, sourceOrgName: ownerName.get(r.ownerOrgId) ?? r.ownerOrgId, qty }],
      });
      rep.totalItems += qty;
    }
  }

  // Machines out at hospitals, per specialist
  const loaned = await db.select({
    unitId: assetUnit.id, serialNo: assetUnit.serialNo, intendedUse: assetUnit.intendedUse, holder: assetUnit.currentHolderUserId,
    label: assetUnit.currentWarehouseLabel, unitOrg: assetUnit.organizationId, customerId: assetUnit.currentCustomerId,
    productCode: product.productCode, description: product.description,
  }).from(assetUnit).innerJoin(product, eq(product.id, assetUnit.productId))
    .where(and(inArray(assetUnit.organizationId, ownerGroup), eq(assetUnit.status, "ON_LOAN"), sql`${assetUnit.currentHolderUserId} IS NOT NULL`));
  // This company's own machines lent from field stock, and other companies' machines consigned to its specialists
  const visible = loaned.filter((u) => ((u.label ?? "").startsWith("Field:") && u.unitOrg === orgId) || (u.label ?? "").startsWith(`CS:ORG:${orgId}:REP:`));
  if (visible.length) {
    const ids = visible.map((u) => u.unitId);
    const loans = await db.select({ unitId: stockMovement.unitId, doId: stockMovement.referenceId, doNo: stockMovement.referenceNo, at: stockMovement.createdAt })
      .from(stockMovement).where(and(inArray(stockMovement.unitId, ids), eq(stockMovement.movementType, MOVEMENT_TYPE.LOAN_OUT)))
      .orderBy(desc(stockMovement.createdAt));
    const { customer, deliveryOrderItem } = await import("@/db/schema");
    const doItems = await db.select({ unitId: deliveryOrderItem.unitId, doId: deliveryOrderItem.deliveryOrderId, purpose: deliveryOrderItem.loanPurpose })
      .from(deliveryOrderItem).where(inArray(deliveryOrderItem.unitId, ids));
    const custIds = [...new Set(visible.map((u) => u.customerId).filter(Boolean) as string[])];
    const custs = custIds.length ? await db.select({ id: customer.id, name: customer.name, org: customer.organizationName }).from(customer).where(inArray(customer.id, custIds)) : [];
    const orgNames = new Map((await db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, ownerGroup))).map((o) => [o.id, o.name]));
    const missingReps = [...new Set(visible.map((u) => u.holder!))].filter((id) => !repMap.has(id));
    const extraNames = missingReps.length ? new Map((await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, missingReps))).map((u) => [u.id, u.name ?? u.id])) : new Map<string, string>();
    for (const u of visible) {
      const repId = u.holder!;
      if (!repMap.has(repId)) repMap.set(repId, { repId, repName: extraNames.get(repId) ?? repId, warehouseLabel: fieldWarehouseLabel(repId), items: [], totalItems: 0 });
      const loan = loans.find((l) => l.unitId === u.unitId);
      const c = custs.find((x) => x.id === u.customerId);
      const rep = repMap.get(repId)!;
      (rep.onLoan ??= []).push({
        unitId: u.unitId, serialNo: u.serialNo, productCode: u.productCode, description: u.description ?? "", intendedUse: u.intendedUse,
        purpose: doItems.find((d) => d.unitId === u.unitId && d.doId === loan?.doId)?.purpose ?? null,
        doId: loan?.doId ?? null, doNo: loan?.doNo ?? null, since: loan?.at ?? null,
        customerName: c ? (c.org ? `${c.name} · ${c.org}` : c.name) : null,
        consignedFrom: u.unitOrg !== orgId ? orgNames.get(u.unitOrg) ?? null : null,
      });
    }
  }

  // Item groups of every product held (filled in once for all specialists)
  const { groupIdsByProduct } = await import("@/lib/inventory/item-groups");
  const memberOf = await groupIdsByProduct([...repMap.values()].flatMap((r) => r.items.map((i) => i.productId)));
  for (const r of repMap.values()) for (const i of r.items) i.itemGroupIds = memberOf.get(i.productId) ?? [];
  // Fixed order: product code, then own stock before consigned (by owner) —
  // the database returns rows in no particular order
  for (const r of repMap.values()) {
    r.items.sort((a, b) => a.productCode.localeCompare(b.productCode, undefined, { numeric: true })
      || (a.consignedBreakdown?.[0]?.sourceOrgName ?? "").localeCompare(b.consignedBreakdown?.[0]?.sourceOrgName ?? ""));
    r.onLoan?.sort((a, b) => a.productCode.localeCompare(b.productCode, undefined, { numeric: true }) || a.serialNo.localeCompare(b.serialNo));
  }

  return [...repMap.values()].sort((a, b) => a.repName.localeCompare(b.repName));
}

export async function getFieldMovements(repId?: string): Promise<FieldMovementRow[]> {
  const { orgId } = await requireAccess("inventory:read");
  const owners = (await getOwnerOrgIdsInternal(orgId)).filter((id) => id !== orgId);
  const cs = `CS:ORG:${orgId}:REP:`;
  // Every movement that touches a specialist's holding — the same buckets
  // Current Holdings adds up: this company's "Field:<rep>" stock and other
  // companies' stock consigned to its specialists ("CS:ORG:<us>:REP:<rep>",
  // on the owner's books).
  const touches = (pattern: string) => sql`(${stockMovement.warehouseLabel} LIKE ${pattern} OR ${stockMovement.warehouseTo} LIKE ${pattern})`;
  const rows = await db
    .select({
      id: stockMovement.id, org: stockMovement.organizationId,
      productId: stockMovement.productId, productCode: stockMovement.productCode,
      warehouseLabel: stockMovement.warehouseLabel, warehouseTo: stockMovement.warehouseTo,
      movementType: stockMovement.movementType, quantity: stockMovement.quantity,
      referenceNo: stockMovement.referenceNo, notes: stockMovement.notes,
      lotNo: stockMovement.lotNo, expiryDate: stockMovement.expiryDate, serialNo: stockMovement.serialNo,
      status: stockMovement.status, createdAt: stockMovement.createdAt,
    })
    .from(stockMovement)
    .where(sql`((${stockMovement.organizationId} = ${orgId} AND ${touches("Field:%")})${owners.length
      ? sql` OR (${inArray(stockMovement.organizationId, owners)} AND ${touches(cs + "%")})` : sql``})`)
    .orderBy(desc(stockMovement.createdAt), asc(stockMovement.productCode), asc(stockMovement.id)) // same-time rows keep their order
    .limit(500);

  // Which specialist a label belongs to ("Field:<rep>[:…]" ours, "CS:ORG:<us>:REP:<rep>" consigned)
  const repOf = (label: string | null, org: string): string | null => {
    if (!label) return null;
    if (org === orgId && label.startsWith("Field:")) return label.slice(6).split(":")[0] || null;
    if (org !== orgId && label.startsWith(cs)) return label.slice(cs.length) || null;
    return null;
  };

  // Running balance per holding: start from what is held now, walk back
  const [ownLevels, csLevels] = await Promise.all([
    db.select({ org: stockLevel.organizationId, label: stockLevel.warehouseLabel, productId: stockLevel.productId, qty: stockLevel.quantity })
      .from(stockLevel).where(and(eq(stockLevel.organizationId, orgId), sql`${stockLevel.warehouseLabel} LIKE 'Field:%'`)),
    owners.length
      ? db.select({ org: stockLevel.organizationId, label: stockLevel.warehouseLabel, productId: stockLevel.productId, qty: stockLevel.quantity })
          .from(stockLevel).where(and(inArray(stockLevel.organizationId, owners), sql`${stockLevel.warehouseLabel} LIKE ${cs + "%"}`))
      : Promise.resolve([]),
  ]);
  const held = new Map([...ownLevels, ...csLevels].map((l) => [`${l.org}|${l.label}|${l.productId}`, parseFloat(l.qty) || 0]));
  const ownerNames = owners.length
    ? new Map((await db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, owners))).map((o) => [o.id, o.name]))
    : new Map<string, string>();

  const out: FieldMovementRow[] = [];
  for (const { org, ...m } of rows) {
    const q = parseFloat(m.quantity) || 0;
    const approved = m.status === "APPROVED";
    // Recorded from the "from" label's side. A manual TRANSFER also writes its
    // own row for the destination, so only its from-side is taken from this row.
    const sides: { label: string; delta: number }[] = [];
    if (repOf(m.warehouseLabel, org)) sides.push({ label: m.warehouseLabel, delta: q });
    if (m.warehouseTo && repOf(m.warehouseTo, org) && m.movementType !== MOVEMENT_TYPE.TRANSFER) sides.push({ label: m.warehouseTo, delta: -q });
    for (const side of sides) {
      const rep = repOf(side.label, org)!;
      if (repId && rep !== repId) continue;
      const key = `${org}|${side.label}|${m.productId}`;
      let balance: number | null = null;
      if (approved) {
        balance = held.get(key) ?? 0;
        held.set(key, balance - side.delta);
      }
      out.push({
        ...m, referenceNo: m.referenceNo ?? "", repId: rep, delta: side.delta, balance,
        consignedFrom: org !== orgId ? ownerNames.get(org) ?? "Sister company" : null,
      });
    }
  }
  return out;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

// The org's primary warehouse — same resolution as getWarehouses() in
// server/inventory.ts (first configured warehouseAddresses entry, "Default"
// if none set up), duplicated here so transferToRep/returnFromRep don't need
// to double-gate on inventory:read just to find out their own org's label.
async function getMainWarehouseLabelInternal(orgId: string): Promise<string> {
  const [profile] = await db
    .select({ warehouseAddresses: organizationProfile.warehouseAddresses })
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId))
    .limit(1);
  const addresses = (profile?.warehouseAddresses as { label?: string }[] | null) ?? [];
  return addresses.find((w) => w.label?.trim())?.label ?? "Default";
}

// Product catalogues and physical stock can live under different sibling
// orgs in the same ownership group (e.g. products catalogued under one org,
// all physical stock centralized under another) — same "owner org group"
// concept searchProducts()/getInventory() already use in server/inventory.ts.
// Duplicated here (rather than importing that file's private helper) so the
// product lookup in transferToRep/returnFromRep can match products across
// the group instead of only the active org, which is what search already
// lets the user find and select in the first place.
async function getOwnerOrgIdsInternal(currentOrgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .limit(1);
  if (!ownerMember) return [currentOrgId];

  const ownedOrgs = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner"), isNull(member.deletedAt)));

  const ids = ownedOrgs.map((o) => o.organizationId);
  return ids.length ? ids : [currentOrgId];
}

async function updateStockLevel(orgId: string, productId: string, warehouseLabel: string, delta: number, unitCost: string | null, now: Date) {
  const [existing] = await db.select().from(stockLevel)
    .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.productId, productId), eq(stockLevel.warehouseLabel, warehouseLabel)))
    .limit(1);

  const newQty = parseFloat(existing?.quantity ?? "0") + delta;
  if (newQty < 0) throw new Error(`Insufficient stock for ${productId} in ${warehouseLabel} (available: ${parseFloat(existing?.quantity ?? "0")})`);

  if (existing) {
    await db.update(stockLevel).set({ quantity: newQty.toFixed(4), updatedAt: now }).where(eq(stockLevel.id, existing.id));
  } else {
    if (delta < 0) throw new Error(`No stock found for ${productId} in ${warehouseLabel}`);
    await db.insert(stockLevel).values({
      id: nanoid(), organizationId: orgId, productId, warehouseLabel,
      quantity: newQty.toFixed(4), reservedQty: "0", unitCost, updatedAt: now,
    });
  }
  return newQty;
}

// Serial-tracked lines become one line per unit (qty 1), so each machine gets
// its own movement and its unit record follows it.
async function expandUnits(items: FieldTransferItem[], orgId: string) {
  const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);
  const out: (FieldTransferItem & { unit?: typeof assetUnit.$inferSelect })[] = [];
  for (const item of items) {
    if (!item.unitIds?.length) { out.push(item); continue; }
    const units = await db.select().from(assetUnit)
      .where(and(inArray(assetUnit.id, item.unitIds), eq(assetUnit.productId, item.productId), inArray(assetUnit.organizationId, ownerOrgIds)));
    if (units.length !== item.unitIds.length) throw new Error("A selected serial number was not found");
    for (const unit of units) out.push({ ...item, qty: 1, unitIds: undefined, unit });
  }
  return out;
}

export async function transferToRep(input: FieldTransferInput): Promise<string> {
  const { orgId, userId } = await requireAccess("inventory:create");
  // Field stock moves only within this company: the specialist must be its
  // own member. Another company's specialist (a sister company) gets stock
  // through Consignment (it stays this company's) or a sale between companies.
  const [own] = await db.select({ id: member.id }).from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, input.repId), isNull(member.deletedAt))).limit(1);
  if (!own) {
    throw new Error(`${input.repName || "This person"} isn't a member of this company — field stock only moves within the company. For a sister company's specialist use Consignment → New (the stock stays yours) or sell it to that company.`);
  }
  const transferId = nanoid();
  const year = new Date().getFullYear();
  const referenceNo = `FT-${year}-${transferId.slice(0, 6).toUpperCase()}`;
  const defaultMainLabel = await getMainWarehouseLabelInternal(orgId);
  const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);
  const now = new Date();
  let processedCount = 0;

  for (const item of await expandUnits(input.items, orgId)) {
    if (item.qty <= 0) continue;

    const mainLabel = item.consignedFromOrgId ? consignedWarehouseLabel(item.consignedFromOrgId) : defaultMainLabel;
    const fieldLabel = item.consignedFromOrgId ? consignedFieldWarehouseLabel(input.repId, item.consignedFromOrgId) : fieldWarehouseLabel(input.repId);
    if (item.unit && (item.unit.status !== "IN_STOCK" || item.unit.currentWarehouseLabel !== mainLabel)) {
      throw new Error(`Serial ${item.unit.serialNo} is not in ${mainLabel}`);
    }

    const [prod] = await db.select({ productCode: product.productCode, unitCost: stockLevel.unitCost })
      .from(product)
      .leftJoin(stockLevel, and(
        eq(stockLevel.productId, product.id),
        eq(stockLevel.organizationId, orgId),
        eq(stockLevel.warehouseLabel, mainLabel),
      ))
      .where(and(eq(product.id, item.productId), inArray(product.organizationId, ownerOrgIds)))
      .limit(1);
    if (!prod) continue;
    processedCount++;

    // Same per-person holding cap stock-request.ts enforces on staff
    // warehouse requests — a rep's field warehouse is the same kind of
    // personal holding, so it's checked against the same limit table.
    const [limit] = await db
      .select({ maxQty: staffStockLimit.maxQty })
      .from(staffStockLimit)
      .where(and(eq(staffStockLimit.organizationId, orgId), eq(staffStockLimit.userId, input.repId), eq(staffStockLimit.productId, item.productId)))
      .limit(1);
    if (limit) {
      const [currentField] = await db
        .select({ quantity: stockLevel.quantity })
        .from(stockLevel)
        .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.productId, item.productId), eq(stockLevel.warehouseLabel, fieldLabel)))
        .limit(1);
      const currentQty = parseFloat(currentField?.quantity ?? "0");
      if (currentQty + item.qty > parseFloat(limit.maxQty)) {
        throw new Error(`Transfer would exceed ${input.repName}'s holding limit of ${limit.maxQty} units for ${prod.productCode}. They currently hold ${currentQty} units.`);
      }
    }

    // The neon-http driver used by `db` has no transaction support, so these
    // writes can't be made atomic. The lot-specific check is the one most
    // likely to fail (insufficient quantity in that exact lot even though
    // the aggregate total looks fine) — running it first, before any
    // quantity is actually moved, keeps a failed transfer from leaving the
    // aggregate stockLevel and the per-lot stockLot out of sync with each
    // other.
    let lotId: string | undefined;
    if (item.lotNo) {
      await applyToLot({
        orgId, productId: item.productId, warehouseLabel: mainLabel,
        lotNo: item.lotNo, expiryDate: item.expiryDate, signed: -item.qty,
      });
      const dest = await applyToLot({
        orgId, productId: item.productId, warehouseLabel: fieldLabel,
        lotNo: item.lotNo, expiryDate: item.expiryDate, signed: item.qty, unitCost: prod.unitCost,
      });
      lotId = dest.lotId;
    }

    const srcBalance = await updateStockLevel(orgId, item.productId, mainLabel, -item.qty, null, now);
    await updateStockLevel(orgId, item.productId, fieldLabel, item.qty, prod.unitCost, now);

    await db.insert(stockMovement).values({
      id: nanoid(), organizationId: orgId, productId: item.productId,
      productCode: prod.productCode, warehouseLabel: mainLabel, warehouseTo: fieldLabel,
      movementType: MOVEMENT_TYPE.FIELD_OUT,
      quantity: (-item.qty).toFixed(4), balanceAfter: srcBalance.toFixed(4),
      referenceType: REF_TYPE.FIELD_TRANSFER, referenceId: transferId, referenceNo,
      notes: `Field transfer to ${input.repName}${input.notes ? ` — ${input.notes}` : ""}`,
      lotNo: item.lotNo, expiryDate: item.expiryDate, lotId,
      unitId: item.unit?.id ?? null, serialNo: item.unit?.serialNo ?? null,
      status: "APPROVED", reviewedBy: userId, reviewedAt: now, createdBy: userId, createdAt: now,
    });
    if (item.unit) {
      await db.update(assetUnit).set({
        status: "WITH_REP", currentOrgId: orgId, currentWarehouseLabel: fieldLabel, currentHolderUserId: input.repId, updatedAt: now,
      }).where(eq(assetUnit.id, item.unit.id));
    }
  }

  if (processedCount === 0) {
    throw new Error("No items were transferred — the selected product(s) could not be matched to this organization's catalogue.");
  }

  revalidatePath("/dashboard/inventory/field-stock");
  revalidatePath("/dashboard/inventory");
  return referenceNo;
}

export async function returnFromRep(input: FieldTransferInput): Promise<string> {
  const { orgId, userId } = await requireAccess("inventory:create");
  const transferId = nanoid();
  const year = new Date().getFullYear();
  const referenceNo = `FR-${year}-${transferId.slice(0, 6).toUpperCase()}`;
  const defaultMainLabel = await getMainWarehouseLabelInternal(orgId);
  const ownerOrgIds = await getOwnerOrgIdsInternal(orgId);
  const now = new Date();
  let processedCount = 0;

  for (const item of await expandUnits(input.items, orgId)) {
    if (item.qty <= 0) continue;

    const mainLabel = item.consignedFromOrgId ? consignedWarehouseLabel(item.consignedFromOrgId) : defaultMainLabel;
    const fieldLabel = item.consignedFromOrgId ? consignedFieldWarehouseLabel(input.repId, item.consignedFromOrgId) : fieldWarehouseLabel(input.repId);
    if (item.unit && (item.unit.status !== "WITH_REP" || item.unit.currentHolderUserId !== input.repId)) {
      throw new Error(`Serial ${item.unit.serialNo} is not held by ${input.repName}`);
    }

    const [prod] = await db.select({ productCode: product.productCode })
      .from(product)
      .where(and(eq(product.id, item.productId), inArray(product.organizationId, ownerOrgIds)))
      .limit(1);
    if (!prod) continue;
    processedCount++;

    const [fieldLevel] = await db.select({ unitCost: stockLevel.unitCost })
      .from(stockLevel)
      .where(and(eq(stockLevel.organizationId, orgId), eq(stockLevel.productId, item.productId), eq(stockLevel.warehouseLabel, fieldLabel)))
      .limit(1);

    // See the matching comment in transferToRep — no DB transactions
    // available, so the lot check (most likely failure) runs before any
    // quantity is actually moved.
    let lotId: string | undefined;
    if (item.lotNo) {
      await applyToLot({
        orgId, productId: item.productId, warehouseLabel: fieldLabel,
        lotNo: item.lotNo, expiryDate: item.expiryDate, signed: -item.qty,
      });
      const dest = await applyToLot({
        orgId, productId: item.productId, warehouseLabel: mainLabel,
        lotNo: item.lotNo, expiryDate: item.expiryDate, signed: item.qty, unitCost: fieldLevel?.unitCost ?? null,
      });
      lotId = dest.lotId;
    }

    const fieldBalance = await updateStockLevel(orgId, item.productId, fieldLabel, -item.qty, null, now);
    await updateStockLevel(orgId, item.productId, mainLabel, item.qty, fieldLevel?.unitCost ?? null, now);

    await db.insert(stockMovement).values({
      id: nanoid(), organizationId: orgId, productId: item.productId,
      productCode: prod.productCode, warehouseLabel: fieldLabel, warehouseTo: mainLabel,
      movementType: MOVEMENT_TYPE.FIELD_RETURN,
      quantity: (-item.qty).toFixed(4), balanceAfter: fieldBalance.toFixed(4),
      referenceType: REF_TYPE.FIELD_TRANSFER, referenceId: transferId, referenceNo,
      notes: `Field return from ${input.repName}${input.notes ? ` — ${input.notes}` : ""}`,
      lotNo: item.lotNo, expiryDate: item.expiryDate, lotId,
      unitId: item.unit?.id ?? null, serialNo: item.unit?.serialNo ?? null,
      status: "APPROVED", reviewedBy: userId, reviewedAt: now, createdBy: userId, createdAt: now,
    });
    if (item.unit) {
      await db.update(assetUnit).set({
        status: "IN_STOCK", currentOrgId: orgId, currentWarehouseLabel: mainLabel, currentHolderUserId: null, updatedAt: now,
      }).where(eq(assetUnit.id, item.unit.id));
    }
  }

  if (processedCount === 0) {
    throw new Error("No items were returned — the selected product(s) could not be matched to this organization's catalogue.");
  }

  revalidatePath("/dashboard/inventory/field-stock");
  revalidatePath("/dashboard/inventory");
  return referenceNo;
}
