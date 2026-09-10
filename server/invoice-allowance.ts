"use server";

import { db } from "@/db";
import {
  invoice,
  invoiceAllowance,
  categoryAllowanceRate,
  memberAllowanceRate,
  documentCategory,
  organizationProfile,
  publicHoliday,
  member,
  organization,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, inArray, desc, getTableColumns } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { MultiSalesPersonMode } from "./category-allowance-rate";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  const userId = session.user.id;
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId };
}

// A case's sales person / application specialist is often someone from a
// sibling organization covering for that org (the FK is to a global user
// account, not scoped to org membership — see recomputeInvoiceAllowances).
// So the earner may have no membership in the org whose invoice generated
// the allowance, and can't switch their active org to it. Statements must
// therefore span every org sharing the same owner, not just the caller's
// single active org — same "resolve every org sharing the owner" pattern
// used elsewhere in the app (e.g. app/api/products/picture-ref/route.ts).
async function getOwnerOrgIds(orgId: string): Promise<string[]> {
  const [ownerRow] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerRow) return [orgId];
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerRow.userId), eq(member.role, "owner")));
  return [...new Set([orgId, ...rows.map((r) => r.organizationId)])];
}

// Resolves which org each user "belongs to" for allowance purposes: anyone
// with a currently-active membership counts for that org (and only that
// org — a removed/soft-deleted membership elsewhere never also counts, which
// is what caused a resigned-and-rejoined-under-a-new-account person to
// appear to belong to two orgs). Someone with NO active membership left
// anywhere in the group (fully resigned, member row soft-deleted, but the
// underlying user account itself is never deleted by this app) falls back
// to their most recent membership — so a resigned person's already-earned
// allowance stays discoverable on their last org's statement instead of
// disappearing from every view once they leave. The `invoice_allowance` row
// itself is never at risk either way: its `userId` FK has no cascade, and
// nothing in this app ever deletes a `user` row.
type EffectiveMembership = { userId: string; userName: string; organizationId: string; organizationName: string | null };

async function getEffectiveOrgMemberships(orgIds: string[]): Promise<EffectiveMembership[]> {
  const rows = await db
    .select({
      userId: member.userId,
      userName: user.name,
      organizationId: member.organizationId,
      organizationName: organization.name,
      deletedAt: member.deletedAt,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(inArray(member.organizationId, orgIds));

  const byUser = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId)!.push(r);
  }

  const result: EffectiveMembership[] = [];
  for (const memberships of byUser.values()) {
    const active = memberships.filter((m) => !m.deletedAt);
    if (active.length > 0) {
      for (const m of active) {
        result.push({ userId: m.userId, userName: m.userName, organizationId: m.organizationId, organizationName: m.organizationName });
      }
    } else {
      const lastKnown = [...memberships].sort((a, b) =>
        (b.deletedAt ?? b.createdAt).getTime() - (a.deletedAt ?? a.createdAt).getTime())[0];
      result.push({ userId: lastKnown.userId, userName: lastKnown.userName, organizationId: lastKnown.organizationId, organizationName: lastKnown.organizationName });
    }
  }
  return result;
}

type DayType = "weekday" | "weekend" | "holiday";
type Role = "sales_person" | "app_specialist";

// Day-of-week from LOCAL calendar date components, not Date#getUTCDay() —
// caseDate round-trips through a plain <input type="date"> as a local
// midnight value, so deriving weekday/weekend from the UTC day risks
// misclassifying dates near a UTC offset boundary. A date on the org's
// public holiday calendar always wins, even over a weekend.
function resolveDayType(d: Date, holidayDates: Set<string>): DayType {
  const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD, as originally entered
  if (holidayDates.has(iso)) return "holiday";
  const [y, m, day] = iso.split("-").map(Number);
  const localMidnight = new Date(y, m - 1, day);
  const dow = localMidnight.getDay(); // 0 = Sun, 6 = Sat
  return dow === 0 || dow === 6 ? "weekend" : "weekday";
}

function rateForDayType(
  dayType: DayType,
  weekday: string | null,
  weekend: string | null,
  holiday: string | null,
): string | null {
  if (dayType === "holiday") return holiday;
  if (dayType === "weekend") return weekend;
  return weekday;
}

// Regenerates the pending invoice_allowance rows for one invoice from its
// current category/sales-person/app-specialist/case-date. Internal engine —
// not permission-gated itself, since it's only ever called from
// server/invoice.ts after that code's own permission check has passed.
export async function recomputeInvoiceAllowances(invoiceId: string): Promise<void> {
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId));
  if (!inv) return;

  // Once any row for this invoice is paid, leave it alone entirely — a
  // later edit shouldn't silently erase a real payment record.
  const [paidRow] = await db
    .select({ id: invoiceAllowance.id })
    .from(invoiceAllowance)
    .where(and(eq(invoiceAllowance.invoiceId, invoiceId), eq(invoiceAllowance.status, "paid")))
    .limit(1);
  if (paidRow) return;

  await db.delete(invoiceAllowance).where(and(eq(invoiceAllowance.invoiceId, invoiceId), eq(invoiceAllowance.status, "pending")));

  if (inv.status === "cancelled") return;
  if (!inv.categoryIds || inv.categoryIds.length === 0) return;

  const rates = await db
    .select()
    .from(categoryAllowanceRate)
    .where(and(
      eq(categoryAllowanceRate.organizationId, inv.organizationId),
      inArray(categoryAllowanceRate.categoryId, inv.categoryIds),
      eq(categoryAllowanceRate.isActive, true),
    ));
  if (rates.length === 0) return;

  const categories = await db
    .select({ id: documentCategory.id, name: documentCategory.name })
    .from(documentCategory)
    .where(inArray(documentCategory.id, rates.map((r) => r.categoryId)));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const [profile] = await db
    .select({ mode: organizationProfile.allowanceMultiSalesPersonMode })
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, inv.organizationId));
  const multiMode = (profile?.mode as MultiSalesPersonMode) ?? "full_each";

  const holidays = await db
    .select({ date: publicHoliday.date })
    .from(publicHoliday)
    .where(eq(publicHoliday.organizationId, inv.organizationId));
  const holidayDates = new Set(holidays.map((h) => h.date));

  const dayType = resolveDayType(inv.caseDate ?? inv.invoiceDate ?? new Date(), holidayDates);

  // Sales-person earners: primary + associates, deduped by userId, and
  // filtered to entries with a linked user account — a free-text/"external"
  // name has nobody to credit or show a statement to.
  const rawSalesPersons: { id: string; name: string }[] = [];
  if (inv.salesPersonId) rawSalesPersons.push({ id: inv.salesPersonId, name: inv.salesPersonName ?? "" });
  for (const p of inv.associateSalesPersons ?? []) {
    if (p.id) rawSalesPersons.push({ id: p.id, name: p.name });
  }
  const seen = new Set<string>();
  const salesEarners = rawSalesPersons.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));

  const appSpecEarner = inv.applicationSpecialistId
    ? { id: inv.applicationSpecialistId, name: inv.applicationSpecialistName ?? "" }
    : null;

  // Per-member rate overrides — bypass the category default entirely for
  // whichever earner/category/role/day-type they're configured for. A null
  // field on the override row falls back to the category default (the
  // override table only ever narrows which rate applies, it never disables
  // an allowance the way a null category rate does).
  const overrideUserIds = [...new Set([...salesEarners.map((p) => p.id), ...(appSpecEarner ? [appSpecEarner.id] : [])])];
  const overrides = overrideUserIds.length > 0
    ? await db.select().from(memberAllowanceRate).where(and(
        eq(memberAllowanceRate.organizationId, inv.organizationId),
        inArray(memberAllowanceRate.categoryId, rates.map((r) => r.categoryId)),
        inArray(memberAllowanceRate.userId, overrideUserIds),
        eq(memberAllowanceRate.isActive, true),
      ))
    : [];
  const overrideByUserCategory = new Map(overrides.map((o) => [`${o.userId}|${o.categoryId}`, o]));

  function effectiveRate(userId: string, categoryId: string, defaultRow: typeof rates[number], role: Role): string | null {
    const override = overrideByUserCategory.get(`${userId}|${categoryId}`);
    if (override) {
      const overrideVal = role === "sales_person"
        ? rateForDayType(dayType, override.salesPersonWeekdayRate, override.salesPersonWeekendRate, override.salesPersonHolidayRate)
        : rateForDayType(dayType, override.appSpecialistWeekdayRate, override.appSpecialistWeekendRate, override.appSpecialistHolidayRate);
      if (overrideVal) return overrideVal;
    }
    return role === "sales_person"
      ? rateForDayType(dayType, defaultRow.salesPersonWeekdayRate, defaultRow.salesPersonWeekendRate, defaultRow.salesPersonHolidayRate)
      : rateForDayType(dayType, defaultRow.appSpecialistWeekdayRate, defaultRow.appSpecialistWeekendRate, defaultRow.appSpecialistHolidayRate);
  }

  type NewRow = typeof invoiceAllowance.$inferInsert;
  const newRows: NewRow[] = [];

  function pushRow(person: { id: string; name: string }, role: Role, categoryId: string, rate: string) {
    newRows.push({
      id: nanoid(),
      organizationId: inv.organizationId,
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      userId: person.id,
      userName: person.name,
      role,
      categoryId,
      categoryName: categoryNameById.get(categoryId) ?? "",
      dayType,
      rate,
      amount: rate,
      caseDate: inv.caseDate ?? inv.invoiceDate ?? null,
      status: "pending",
    });
  }

  for (const rate of rates) {
    if (salesEarners.length > 0) {
      if (multiMode === "primary_only") {
        const primary = salesEarners.find((p) => p.id === inv.salesPersonId) ?? salesEarners[0];
        const r = effectiveRate(primary.id, rate.categoryId, rate, "sales_person");
        if (r) pushRow(primary, "sales_person", rate.categoryId, r);
      } else if (multiMode === "split") {
        // Only earners on the plain category default share the split; anyone
        // with their own override keeps their full negotiated rate — it
        // isn't diluted just because other sales persons are also listed.
        const defaultRate = rateForDayType(dayType, rate.salesPersonWeekdayRate, rate.salesPersonWeekendRate, rate.salesPersonHolidayRate);
        const defaultEarners = salesEarners.filter((p) => {
          const o = overrideByUserCategory.get(`${p.id}|${rate.categoryId}`);
          const overrideVal = o ? rateForDayType(dayType, o.salesPersonWeekdayRate, o.salesPersonWeekendRate, o.salesPersonHolidayRate) : null;
          return !overrideVal;
        });
        const splitRate = defaultRate && defaultEarners.length > 0 ? (Number(defaultRate) / defaultEarners.length).toFixed(2) : null;
        for (const p of salesEarners) {
          const r = effectiveRate(p.id, rate.categoryId, rate, "sales_person");
          const isDefault = defaultEarners.includes(p);
          const finalRate = isDefault ? splitRate : r;
          if (finalRate) pushRow(p, "sales_person", rate.categoryId, finalRate);
        }
      } else {
        for (const p of salesEarners) {
          const r = effectiveRate(p.id, rate.categoryId, rate, "sales_person");
          if (r) pushRow(p, "sales_person", rate.categoryId, r);
        }
      }
    }

    if (appSpecEarner) {
      const r = effectiveRate(appSpecEarner.id, rate.categoryId, rate, "app_specialist");
      if (r) pushRow(appSpecEarner, "app_specialist", rate.categoryId, r);
    }
  }

  if (newRows.length > 0) await db.insert(invoiceAllowance).values(newRows);
}

export type InvoiceAllowanceRow = typeof invoiceAllowance.$inferSelect & { organizationName: string | null };

export async function getMyAllowances(): Promise<InvoiceAllowanceRow[]> {
  const { orgId, userId } = await requireAccess("allowance:read:own");
  const orgIds = await getOwnerOrgIds(orgId);
  return db
    .select({ ...getTableColumns(invoiceAllowance), organizationName: organization.name })
    .from(invoiceAllowance)
    .leftJoin(organization, eq(organization.id, invoiceAllowance.organizationId))
    .where(and(inArray(invoiceAllowance.organizationId, orgIds), eq(invoiceAllowance.userId, userId)))
    .orderBy(desc(invoiceAllowance.caseDate), desc(invoiceAllowance.createdAt));
}

export async function getAllAllowances(filters: { userId?: string; status?: string; organizationId?: string } = {}): Promise<InvoiceAllowanceRow[]> {
  const { orgId } = await requireAccess("allowance:read:all");
  const orgIds = await getOwnerOrgIds(orgId);

  // A row belongs on THIS org's statement only if the earner is actually one
  // of this org's own people — regardless of which sibling org's invoice
  // generated it. Tracking and paying out a person's allowance is their home
  // org's responsibility, even when the underlying case was billed by a
  // different org in the group (e.g. Syahidah, an Innosys member, covering
  // an Affirma case — that allowance is Innosys's to track, not Affirma's).
  const effectiveMemberships = await getEffectiveOrgMemberships(orgIds);
  const memberIds = effectiveMemberships.filter((m) => m.organizationId === orgId).map((m) => m.userId);
  if (memberIds.length === 0) return [];

  const conditions = [
    inArray(invoiceAllowance.organizationId, orgIds),
    inArray(invoiceAllowance.userId, memberIds),
  ];
  if (filters.organizationId) conditions.push(eq(invoiceAllowance.organizationId, filters.organizationId));
  if (filters.userId) conditions.push(eq(invoiceAllowance.userId, filters.userId));
  if (filters.status) conditions.push(eq(invoiceAllowance.status, filters.status));
  return db
    .select({ ...getTableColumns(invoiceAllowance), organizationName: organization.name })
    .from(invoiceAllowance)
    .leftJoin(organization, eq(organization.id, invoiceAllowance.organizationId))
    .where(and(...conditions))
    .orderBy(desc(invoiceAllowance.caseDate), desc(invoiceAllowance.createdAt));
}

export async function setAllowancePaid(ids: string[], paid: boolean): Promise<void> {
  const { orgId, userId } = await requireAccess("allowance:read:all");
  if (ids.length === 0) return;
  const orgIds = await getOwnerOrgIds(orgId);
  const effectiveMemberships = await getEffectiveOrgMemberships(orgIds);
  const memberIds = effectiveMemberships.filter((m) => m.organizationId === orgId).map((m) => m.userId);
  if (memberIds.length === 0) return;

  await db
    .update(invoiceAllowance)
    .set({
      status: paid ? "paid" : "pending",
      paidAt: paid ? new Date() : null,
      paidBy: paid ? userId : null,
    })
    .where(and(
      inArray(invoiceAllowance.id, ids),
      inArray(invoiceAllowance.userId, memberIds),
    ));
  revalidatePath("/dashboard/human-resources/allowance/all");
  revalidatePath("/dashboard/human-resources/allowance");
}

// Every member across the owner's whole org group (not just the caller's
// active org) — the "employee" filter on the cross-org statement needs to
// include people like a sibling-org sales person who covered a case here.
export type OwnerOrgMember = { userId: string; name: string; organizationName: string | null };

export async function getOwnerOrgMembers(): Promise<OwnerOrgMember[]> {
  const { orgId } = await requireAccess("allowance:read:all");
  const orgIds = await getOwnerOrgIds(orgId);
  const rows = await getEffectiveOrgMemberships(orgIds);
  const seen = new Map<string, OwnerOrgMember>();
  for (const r of rows) if (!seen.has(r.userId)) seen.set(r.userId, { userId: r.userId, name: r.userName, organizationName: r.organizationName });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
