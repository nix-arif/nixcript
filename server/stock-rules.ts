"use server";

import { db } from "@/db";
import { itemGroup, member, organization, product, stockLevel, stockMovement, stockRuleLog, stockRuleSetting, stockShortfall, user } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getStockRules, modeNow, type StockRuleMode, type StockRules } from "@/lib/inventory/stock-rules";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

// Inventory → Stock Rules: how strictly Case DOs must be covered by stock that
// is held, the shortfalls recorded while it isn't enforced, and whether the
// company is ready to enforce.

async function ctx() {
  const session = await getCachedSession();
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId) throw new Error("Not signed in");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "inventory:read")) throw new Error("You don't have permission to view inventory");
  return { orgId, userId: session.user.id, userName: session.user.name ?? null, canEdit: hasAccess(perms, "inventory:manage") };
}

const MODE_LABEL: Record<StockRuleMode, string> = { record_flag: "Record & flag", warn: "Warn", enforce: "Enforce" };
const COUNT_DAYS = 90;

export type ShortfallRow = typeof stockShortfall.$inferSelect & { locationName: string; recordedByName: string | null; resolvedByName: string | null };

export async function getStockRulesPage() {
  const { orgId, canEdit } = await ctx();
  const rules = await getStockRules(orgId);
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)).limit(1);
  const [shortfalls, log, groups, exemptProducts] = await Promise.all([
    db.select().from(stockShortfall).where(eq(stockShortfall.organizationId, orgId)).orderBy(desc(stockShortfall.createdAt)).limit(300),
    db.select().from(stockRuleLog).where(eq(stockRuleLog.organizationId, orgId)).orderBy(desc(stockRuleLog.createdAt)).limit(30),
    db.select({ id: itemGroup.id, name: itemGroup.name }).from(itemGroup).where(eq(itemGroup.organizationId, orgId)).orderBy(asc(itemGroup.sortOrder)),
    rules.exemptProductIds.length
      ? db.select({ id: product.id, code: product.productCode, description: product.description }).from(product).where(inArray(product.id, rules.exemptProductIds))
      : Promise.resolve([] as { id: string; code: string; description: string | null }[]),
  ]);

  // names for locations and people
  const userIds = new Set<string>();
  for (const s of shortfalls) {
    if (s.locationLabel.startsWith("Field:")) userIds.add(s.locationLabel.slice(6).split(":")[0]);
    if (s.recordedBy) userIds.add(s.recordedBy);
    if (s.resolvedBy) userIds.add(s.resolvedBy);
  }
  const people = userIds.size ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...userIds])) : [];
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? null : null);
  const locName = (l: string) => (l.startsWith("Field:") ? nameOf(l.slice(6).split(":")[0]) ?? "Specialist" : l === "Default" ? "Main warehouse" : l);

  // Readiness — open shortfalls, field stock not counted lately, negative balances
  const fieldRows = await db.select({ label: stockLevel.warehouseLabel, qty: stockLevel.quantity }).from(stockLevel)
    .where(and(eq(stockLevel.organizationId, orgId), like(stockLevel.warehouseLabel, "Field:%")));
  const holders = [...new Set(fieldRows.filter((r) => parseFloat(r.qty) > 0).map((r) => r.label.split(":").slice(0, 2).join(":")))];
  const members = await db.select({ id: member.userId, name: user.name }).from(member).innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt)));
  const lastCount = holders.length
    ? await db.select({ label: stockMovement.warehouseLabel, at: sql<string>`max(${stockMovement.createdAt})` }).from(stockMovement)
        .where(and(eq(stockMovement.organizationId, orgId), inArray(stockMovement.warehouseLabel, holders),
          inArray(stockMovement.movementType, ["ADJUSTMENT", "OPENING"]), eq(stockMovement.status, "APPROVED")))
        .groupBy(stockMovement.warehouseLabel)
    : [];
  const cutoff = Date.now() - COUNT_DAYS * 86_400_000;
  const notCounted = holders
    .map((l) => ({ label: l, name: members.find((m) => `Field:${m.id}` === l)?.name ?? "Former member", last: lastCount.find((c) => c.label === l)?.at ?? null }))
    .filter((h) => !h.last || new Date(h.last).getTime() < cutoff)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [neg] = await db.select({ n: sql<number>`count(*)::int` }).from(stockLevel)
    .where(and(eq(stockLevel.organizationId, orgId), sql`${stockLevel.quantity}::numeric < 0`));

  return {
    orgName: org?.name ?? "",
    canEdit,
    rules,
    modeNow: modeNow(rules),
    groups,
    exemptProducts,
    shortfalls: shortfalls.map((s) => ({ ...s, locationName: locName(s.locationLabel), recordedByName: nameOf(s.recordedBy), resolvedByName: nameOf(s.resolvedBy) })) as ShortfallRow[],
    readiness: {
      openShortfalls: shortfalls.filter((s) => s.status === "open").length,
      notCounted: notCounted.map((h) => ({ ...h, last: h.last ? new Date(h.last).toISOString() : null })),
      countDays: COUNT_DAYS,
      negativeBalances: neg?.n ?? 0,
    },
    log,
  };
}

export async function saveStockRules(input: StockRules): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId, userId, userName, canEdit } = await ctx();
    if (!canEdit) return { ok: false, title: "Changing the stock rules needs the Manage Inventory Settings permission" };
    if (!["record_flag", "warn", "enforce"].includes(input.mode)) return { ok: false, title: "Choose a mode" };
    const enforceFrom = input.mode === "enforce" && input.enforceFrom ? new Date(input.enforceFrom) : null;
    if (enforceFrom && isNaN(enforceFrom.getTime())) return { ok: false, title: "The start date isn't valid" };
    const before = await getStockRules(orgId);
    const after: StockRules = {
      mode: input.mode, enforceFrom, checkOnCreate: !!input.checkOnCreate, checkOnRecord: !!input.checkOnRecord,
      allowTakenFrom: !!input.allowTakenFrom, allowNegative: input.mode === "enforce" ? false : !!input.allowNegative,
      exemptGroupIds: [...new Set(input.exemptGroupIds ?? [])], exemptProductIds: [...new Set(input.exemptProductIds ?? [])],
    };
    const yn = (b: boolean) => (b ? "on" : "off");
    const day = (d: Date | null) => (d ? d.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "now");
    const changes: string[] = [];
    if (before.mode !== after.mode || (before.enforceFrom?.getTime() ?? 0) !== (after.enforceFrom?.getTime() ?? 0))
      changes.push(`Mode: ${MODE_LABEL[before.mode]}${before.mode === "enforce" ? ` from ${day(before.enforceFrom)}` : ""} → ${MODE_LABEL[after.mode]}${after.mode === "enforce" ? ` from ${day(after.enforceFrom)}` : ""}`);
    if (before.checkOnCreate !== after.checkOnCreate) changes.push(`Check when creating: ${yn(after.checkOnCreate)}`);
    if (before.checkOnRecord !== after.checkOnRecord) changes.push(`Check when recording: ${yn(after.checkOnRecord)}`);
    if (before.allowTakenFrom !== after.allowTakenFrom) changes.push(`Taken from another location: ${yn(after.allowTakenFrom)}`);
    if (before.allowNegative !== after.allowNegative) changes.push(`Negative balances: ${yn(after.allowNegative)}`);
    if (before.exemptGroupIds.join() !== after.exemptGroupIds.join() || before.exemptProductIds.join() !== after.exemptProductIds.join())
      changes.push(`Exceptions: ${after.exemptGroupIds.length} item group(s), ${after.exemptProductIds.length} product(s)`);
    if (!changes.length) return { ok: true };

    const values = { ...after, updatedBy: userId, updatedAt: new Date() };
    const [existing] = await db.select({ id: stockRuleSetting.id }).from(stockRuleSetting).where(eq(stockRuleSetting.organizationId, orgId)).limit(1);
    if (existing) await db.update(stockRuleSetting).set(values).where(eq(stockRuleSetting.id, existing.id));
    else await db.insert(stockRuleSetting).values({ id: nanoid(), organizationId: orgId, ...values });
    await db.insert(stockRuleLog).values({ id: nanoid(), organizationId: orgId, changedBy: userId, changedByName: userName, summary: changes.join(" · ") });
    revalidatePath("/dashboard/inventory/stock-rules");
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't save the stock rules" };
  }
}

export async function resolveShortfall(id: string, resolution: "transfer" | "adjustment" | "explained", note: string): Promise<{ ok: true } | { ok: false; title: string }> {
  try {
    const { orgId, userId, canEdit } = await ctx();
    if (!canEdit) return { ok: false, title: "Resolving shortfalls needs the Manage Inventory Settings permission" };
    if (!["transfer", "adjustment", "explained"].includes(resolution)) return { ok: false, title: "Choose how it was resolved" };
    if (resolution === "explained" && note.trim().length < 3) return { ok: false, title: "Explain the shortfall" };
    const [s] = await db.select({ status: stockShortfall.status }).from(stockShortfall)
      .where(and(eq(stockShortfall.id, id), eq(stockShortfall.organizationId, orgId))).limit(1);
    if (!s) return { ok: false, title: "Shortfall not found" };
    if (s.status !== "open") return { ok: false, title: "Already resolved" };
    await db.update(stockShortfall).set({ status: "resolved", resolution, resolutionNote: note.trim() || null, resolvedBy: userId, resolvedAt: new Date() })
      .where(eq(stockShortfall.id, id));
    revalidatePath("/dashboard/inventory/stock-rules");
    return { ok: true };
  } catch (e) {
    return { ok: false, title: e instanceof Error ? e.message : "Couldn't resolve the shortfall" };
  }
}
