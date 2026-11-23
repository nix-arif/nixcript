// Performance review service: all the rules, with the caller passed in so it can be tested without a login.
// The server actions in server/performance.ts only add the session and call these.
import { db } from "@/db";
import {
  review, reviewAnswer, reviewCriterion, reviewPeriod, reviewTemplate, reviewReviewer, reviewReviewerAnswer,
  member, memberDepartment, department, user, notification, userPermission, profile, organization,
  type ReviewQuestionSnapshot, type ReviewRound,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasAccess } from "@/lib/permissions/has-access";
import {
  canEditNow, combineScores, isOutcome, isPurpose, isValidWeight, sharePercent, templateNameKey, isValidRating, managerSideVisible, missingRatings, selfSideVisible, weightedScore,
  type ActionPlanRow, type Criterion, type PreviousGoal, type ReviewOutcome, type ReviewPurpose, type ReviewQuestion, type ReviewRole, type ReviewStatus,
} from "@/lib/performance/core";

export type Ctx = { orgId: string; userId: string; perms: string[] };
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

const can = (ctx: Ctx, key: string) => hasAccess(ctx.perms, key);

// a Postgres unique violation (23505) of the given index; drizzle wraps the driver's error in `cause`
function isUniqueViolation(e: unknown, index: string): boolean {
  for (let err: any = e; err; err = err.cause) {
    if (err.code === "23505") return err.constraint === index || String(err.message ?? "").includes(index);
  }
  return false;
}
const NO_ACCESS = fail("You don't have permission to do this.");
const SCALES = [3, 4, 5, 10];
const LINK = "/dashboard/human-resources/performance";

// The organizations owned by the same owner as this one (this one always first). One template and one review period
// can cover all of them: the owner runs several companies and HR does the reviews for the group.
async function ownerOrgsOf(orgId: string): Promise<{ id: string; name: string }[]> {
  const [ownerMember] = await db.select({ userId: member.userId }).from(member).where(and(eq(member.organizationId, orgId), eq(member.role, "owner"))).limit(1);
  const owned = ownerMember
    ? await db.select({ id: member.organizationId }).from(member).where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner"), isNull(member.deletedAt)))
    : [];
  const ids = [...new Set([orgId, ...owned.map((o) => o.id)])];
  const orgs = await db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, ids));
  // this one first, the others by name, so "the first company" a person is in is always the same one
  const self = orgs.filter((o) => o.id === orgId);
  return [...self, ...orgs.filter((o) => o.id !== orgId).sort((a, b) => a.name.localeCompare(b.name))];
}

// ── notifications ───────────────────────────────────────────────────────────
async function notifyUser(orgId: string, userId: string | null, n: { title: string; body: string; link: string }) {
  if (!userId) return;
  await db.insert(notification).values({ id: nanoid(), organizationId: orgId, userId, type: "review", ...n, isRead: 0, createdAt: new Date() });
}

// the people who handle reviews for HR: the owner(s) and everyone explicitly granted review:manage
async function reviewManagerIds(orgId: string): Promise<string[]> {
  const [owners, granted] = await Promise.all([
    db.select({ userId: member.userId }).from(member).where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt))),
    db.select({ userId: userPermission.userId }).from(userPermission).where(and(eq(userPermission.organizationId, orgId), eq(userPermission.permissionKey, "review:manage"), eq(userPermission.allowed, true))),
  ]);
  return [...new Set([...owners, ...granted].map((r) => r.userId))];
}

async function notifyManagers(orgId: string, n: { title: string; body: string; link: string }, except?: string) {
  for (const id of await reviewManagerIds(orgId)) if (id !== except) await notifyUser(orgId, id, n);
}

// HR of the company that opened the period and of the company the review is kept under (both can act on it), once each
async function notifyReviewHr(r: { organizationId: string }, periodOrgId: string, n: { title: string; body: string; link: string }, except: string[] = []) {
  const done = new Set(except);
  for (const orgId of [...new Set([periodOrgId, r.organizationId])]) {
    for (const id of await reviewManagerIds(orgId)) if (!done.has(id)) { done.add(id); await notifyUser(orgId, id, n); }
  }
}

// ── templates ───────────────────────────────────────────────────────────────
export type TemplateInput = {
  id?: string;
  name: string;
  description?: string;
  scaleMax: number;
  isActive?: boolean;
  criteria: { section?: string; name: string; description?: string; weight: number | string }[];
  // written questions the employee answers (achievements, challenges, career planning ...)
  questions?: { id?: string; label: string; help?: string }[];
};

export async function listTemplates(ctx: Ctx) {
  if (!can(ctx, "review:manage")) return [];
  // the templates of every company of this owner: any of them can be used for a period, only this company's can be edited
  const orgs = await ownerOrgsOf(ctx.orgId);
  const templates = await db.select().from(reviewTemplate).where(inArray(reviewTemplate.organizationId, orgs.map((o) => o.id))).orderBy(asc(reviewTemplate.name));
  const criteria = templates.length
    ? await db.select().from(reviewCriterion).where(inArray(reviewCriterion.templateId, templates.map((t) => t.id))).orderBy(asc(reviewCriterion.sortOrder))
    : [];
  // how many review periods use each template, in any company: a template in use can only be deactivated, not deleted
  const usage = templates.length
    ? await db.select({ templateId: reviewPeriod.templateId, n: sql<number>`count(*)::int` }).from(reviewPeriod).where(inArray(reviewPeriod.templateId, templates.map((t) => t.id))).groupBy(reviewPeriod.templateId)
    : [];
  return templates.map((t) => ({
    ...t, criteria: criteria.filter((c) => c.templateId === t.id), own: t.organizationId === ctx.orgId,
    organizationName: orgs.find((o) => o.id === t.organizationId)?.name ?? "",
    periodCount: usage.find((u) => u.templateId === t.id)?.n ?? 0,
  }));
}
export type TemplateWithCriteria = Awaited<ReturnType<typeof listTemplates>>[number];

export async function saveTemplate(ctx: Ctx, input: TemplateInput): Promise<Result<string>> {
  if (!can(ctx, "review:manage")) return NO_ACCESS;
  const name = input.name?.trim().replace(/\s+/g, " ");
  if (!name) return fail("Give the template a name.");
  const others = await db.select({ id: reviewTemplate.id, name: reviewTemplate.name }).from(reviewTemplate).where(eq(reviewTemplate.organizationId, ctx.orgId));
  if (others.some((t) => t.id !== input.id && templateNameKey(t.name) === templateNameKey(name))) {
    return fail(`This company already has a template called "${name}". Give it a different name.`);
  }
  if (!SCALES.includes(input.scaleMax)) return fail("Choose a rating scale of 3, 4, 5 or 10.");
  const criteria = (input.criteria ?? []).map((c) => ({ section: c.section?.trim() ?? "", name: c.name?.trim() ?? "", description: c.description?.trim() ?? "", weight: Number(c.weight) }));
  if (criteria.length === 0) return fail("Add at least one criterion.");
  const blank = criteria.findIndex((c) => !c.name);
  if (blank >= 0) return fail(`Criterion ${blank + 1} has no name.`);
  const badWeight = criteria.findIndex((c) => !(c.weight > 0));
  if (badWeight >= 0) return fail(`Criterion "${criteria[badWeight].name}" needs a weight greater than 0.`);
  const questions: ReviewQuestionSnapshot[] = [];
  for (const [i, q] of (input.questions ?? []).entries()) {
    const label = q.label?.trim();
    if (!label) return fail(`Question ${i + 1} is empty. Write the question or remove it.`);
    questions.push({ id: q.id || nanoid(), label, help: q.help?.trim() ?? "" });
  }

  let id = input.id;
  try {
    if (id) {
      const [t] = await db.select({ id: reviewTemplate.id }).from(reviewTemplate).where(and(eq(reviewTemplate.id, id), eq(reviewTemplate.organizationId, ctx.orgId)));
      if (!t) return fail("Template not found.");
      await db.update(reviewTemplate).set({ name, description: input.description?.trim() || null, scaleMax: input.scaleMax, questions, isActive: input.isActive ?? true }).where(eq(reviewTemplate.id, id));
      await db.delete(reviewCriterion).where(eq(reviewCriterion.templateId, id)); // reviews keep their own copy, so this changes nothing already opened
    } else {
      id = nanoid();
      await db.insert(reviewTemplate).values({ id, organizationId: ctx.orgId, name, description: input.description?.trim() || null, scaleMax: input.scaleMax, questions, isActive: input.isActive ?? true, createdBy: ctx.userId });
    }
  } catch (e) {
    // someone saved a template with the same name at the same moment: the unique index (0091) stops the second one
    if (isUniqueViolation(e, "review_template_org_name_uidx")) return fail(`This company already has a template called "${name}". Give it a different name.`);
    throw e;
  }
  await db.insert(reviewCriterion).values(criteria.map((c, i) => ({ id: nanoid(), templateId: id!, section: c.section, name: c.name, description: c.description || null, weight: String(c.weight), sortOrder: i })));
  return ok(id);
}

export async function setTemplateActive(ctx: Ctx, id: string, isActive: boolean): Promise<Result> {
  if (!can(ctx, "review:manage")) return NO_ACCESS;
  await db.update(reviewTemplate).set({ isActive }).where(and(eq(reviewTemplate.id, id), eq(reviewTemplate.organizationId, ctx.orgId)));
  return ok(undefined);
}

// Only a template no review period has used can be deleted (its criteria go with it). One that a period uses, in this
// company or another of the owner's, is kept so the period can still add employees: deactivate it instead.
export async function deleteTemplate(ctx: Ctx, id: string): Promise<Result> {
  if (!can(ctx, "review:template:delete")) return NO_ACCESS;
  const [t] = await db.select({ id: reviewTemplate.id }).from(reviewTemplate).where(and(eq(reviewTemplate.id, id), eq(reviewTemplate.organizationId, ctx.orgId)));
  if (!t) return fail("Template not found.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(reviewPeriod).where(eq(reviewPeriod.templateId, id));
  if (n > 0) return fail(`This template is used by ${n} review ${n === 1 ? "period" : "periods"}, so it can't be deleted. Deactivate it instead.`);
  await db.delete(reviewTemplate).where(eq(reviewTemplate.id, id));
  return ok(undefined);
}

// ── employees and periods ───────────────────────────────────────────────────
export type EligibleEmployee = {
  userId: string; name: string; email: string; departments: string[]; defaultReviewer: { userId: string; name: string } | null;
  organizationId: string; organizationName: string; // the company the review is kept under by default (the person's own)
  // every company of the owner the person belongs to; HR picks which one keeps the review. Each brings the manager of
  // the person's department there as its default reviewer.
  companies: { id: string; name: string; defaultReviewer: { userId: string; name: string } | null }[];
};

// everyone who can be reviewed, in every company of this owner, with the manager of their own department as the default reviewer
export async function listEligibleEmployees(ctx: Ctx): Promise<EligibleEmployee[]> {
  if (!can(ctx, "review:manage")) return [];
  const orgs = await ownerOrgsOf(ctx.orgId);
  const orgIds = orgs.map((o) => o.id);
  const members = await db
    .select({ memberId: member.id, organizationId: member.organizationId, userId: user.id, name: user.name, email: user.email })
    .from(member).innerJoin(user, eq(member.userId, user.id))
    .where(and(inArray(member.organizationId, orgIds), isNull(member.deletedAt)))
    .orderBy(asc(user.name));
  const assigns = await db
    .select({ memberId: memberDepartment.memberId, organizationId: memberDepartment.organizationId, role: memberDepartment.role, departmentId: memberDepartment.departmentId, departmentName: department.name })
    .from(memberDepartment).innerJoin(department, eq(memberDepartment.departmentId, department.id))
    .where(inArray(memberDepartment.organizationId, orgIds));
  const userOf = new Map(members.map((m) => [m.memberId, m]));
  // a person who belongs to several companies is listed once, under this company if they are in it, else the first one
  const rank = (o: string) => orgIds.indexOf(o);
  const first = new Map<string, (typeof members)[number]>();
  for (const m of members) {
    const cur = first.get(m.userId);
    if (!cur || rank(m.organizationId) < rank(cur.organizationId)) first.set(m.userId, m);
  }
  // the manager of the person's department in that company (one membership = one company)
  const managerOf = (m: (typeof members)[number]): EligibleEmployee["defaultReviewer"] => {
    for (const a of assigns.filter((x) => x.memberId === m.memberId)) {
      const mgr = assigns.find((x) => x.organizationId === m.organizationId && x.departmentId === a.departmentId && x.role === "manager" && x.memberId !== m.memberId);
      const u = mgr && userOf.get(mgr.memberId);
      if (u) return { userId: u.userId, name: u.name };
    }
    return null;
  };
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? "";
  return [...first.values()].map((m) => {
    const companies = members.filter((x) => x.userId === m.userId).sort((a, b) => rank(a.organizationId) - rank(b.organizationId))
      .map((x) => ({ id: x.organizationId, name: orgName(x.organizationId), defaultReviewer: managerOf(x) }));
    return {
      userId: m.userId, name: m.name, email: m.email, departments: assigns.filter((a) => a.memberId === m.memberId).map((a) => a.departmentName),
      defaultReviewer: managerOf(m), organizationId: m.organizationId, organizationName: orgName(m.organizationId), companies,
    };
  }).sort((a, b) => rank(a.organizationId) - rank(b.organizationId) || a.name.localeCompare(b.name));
}

export type PeriodInput = {
  name: string;
  startDate: string;
  endDate: string;
  templateId: string;
  // organizationId: the company the review is kept under; must be one the person belongs to. Left out = this company
  // when they are in it, else the first of theirs.
  // reviewerUserId is the lead reviewer; coReviewers rate alongside them. Weights are shares of the score (1-100 each).
  employees: {
    userId: string; reviewerUserId?: string | null; purpose?: ReviewPurpose | null; organizationId?: string | null;
    leadWeight?: number; coReviewers?: { userId: string; weight: number }[];
  }[];
  // whether the employee sees each reviewer's marks by name once completed (default), or only the combined marks
  showReviewerMarks?: boolean;
};

// The form every review of a period is filled in on: the template's name, scale, criteria and questions, copied into
// each review so that later edits to the template change nothing already opened.
type ReviewForm = { templateName: string; scaleMax: number; criteria: Criterion[]; questions: ReviewQuestionSnapshot[] };

// the form as the template is today; a new period may only be opened with an active template
async function formFromTemplate(orgIds: string[], templateId: string, opts: { requireActive: boolean }): Promise<Result<ReviewForm>> {
  const [tpl] = await db.select().from(reviewTemplate).where(and(eq(reviewTemplate.id, templateId), inArray(reviewTemplate.organizationId, orgIds)));
  if (!tpl) return fail("Choose a template.");
  if (opts.requireActive && !tpl.isActive) return fail(`The template "${tpl.name}" is inactive. Activate it or choose another one.`);
  const criteria = await db.select().from(reviewCriterion).where(eq(reviewCriterion.templateId, templateId)).orderBy(asc(reviewCriterion.sortOrder));
  if (criteria.length === 0) return fail("That template has no criteria.");
  return ok({
    templateName: tpl.name, scaleMax: tpl.scaleMax,
    criteria: criteria.map((c) => ({ id: c.id, section: c.section, name: c.name, description: c.description ?? "", weight: Number(c.weight) })),
    questions: (tpl.questions ?? []) as ReviewQuestionSnapshot[],
  });
}

// the form the period was opened with, taken from its first review (reviews are never deleted, only cancelled), so a
// late joiner is rated on the same criteria as everyone else even if the template was edited, deactivated or deleted since
async function formOfPeriod(periodId: string): Promise<ReviewForm | null> {
  const [first] = await db.select({ templateName: review.templateName, scaleMax: review.scaleMax, criteria: review.criteria, questions: review.questions })
    .from(review).where(eq(review.periodId, periodId)).orderBy(asc(review.createdAt)).limit(1);
  if (!first) return null;
  return { templateName: first.templateName, scaleMax: first.scaleMax, criteria: first.criteria as Criterion[], questions: (first.questions ?? []) as ReviewQuestionSnapshot[] };
}

// the lead reviewer and the others of one review: members of the owner's companies, nobody twice, nobody reviewing
// themselves, shares from 1 to 100
const MAX_CO_REVIEWERS = 5;
function checkReviewerSet(employeeId: string, leadId: string | null, leadWeight: number, co: { userId: string; weight: number }[], inOrg: Set<string>): string | null {
  if (!isValidWeight(leadWeight)) return "A reviewer's share is a whole number from 1 to 100.";
  if (co.length === 0) return null;
  if (!leadId) return "Choose the lead reviewer before adding other reviewers.";
  if (co.length > MAX_CO_REVIEWERS) return `A review can have at most ${MAX_CO_REVIEWERS + 1} reviewers.`;
  const seen = new Set([leadId]);
  for (const c of co) {
    if (!inOrg.has(c.userId)) return "A reviewer must be a member of one of your companies.";
    if (c.userId === employeeId) return "Nobody can be their own reviewer.";
    if (seen.has(c.userId)) return "The same person is chosen as a reviewer twice.";
    if (!isValidWeight(c.weight)) return "A reviewer's share is a whole number from 1 to 100.";
    seen.add(c.userId);
  }
  return null;
}

async function openReviews(ctx: Ctx, periodId: string, periodName: string, form: ReviewForm, employees: PeriodInput["employees"]): Promise<Result<number>> {
  const orgs = await ownerOrgsOf(ctx.orgId);
  const orgIds = orgs.map((o) => o.id);

  const ids = [...new Set([
    ...employees.map((e) => e.userId), ...employees.map((e) => e.reviewerUserId).filter((v): v is string => !!v),
    ...employees.flatMap((e) => (e.coReviewers ?? []).map((c) => c.userId)),
  ])];
  const members = await db.select({ userId: member.userId, organizationId: member.organizationId }).from(member).where(and(inArray(member.organizationId, orgIds), isNull(member.deletedAt), inArray(member.userId, ids)));
  const inOrg = new Set(members.map((m) => m.userId));
  // the review is kept under the company HR chose for the person, else their own (this one when they are in it)
  const orgsOf = (u: string) => members.filter((m) => m.userId === u).map((m) => m.organizationId);
  const orgOfEmployee = (e: PeriodInput["employees"][number]) => {
    const mine = orgsOf(e.userId);
    if (e.organizationId && mine.includes(e.organizationId)) return e.organizationId;
    return mine.includes(ctx.orgId) ? ctx.orgId : mine.sort((a, b) => orgIds.indexOf(a) - orgIds.indexOf(b))[0] ?? ctx.orgId;
  };
  for (const e of employees) {
    if (!inOrg.has(e.userId)) return fail("One of the selected employees is not a member of your companies.");
    if (e.organizationId && !orgsOf(e.userId).includes(e.organizationId)) return fail("A review can only be kept under a company the employee belongs to.");
    if (e.reviewerUserId && !inOrg.has(e.reviewerUserId)) return fail("A reviewer must be a member of one of your companies.");
    if (e.reviewerUserId === e.userId) return fail("Nobody can be their own reviewer.");
    const bad = checkReviewerSet(e.userId, e.reviewerUserId ?? null, e.leadWeight ?? 100, e.coReviewers ?? [], inOrg);
    if (bad) return fail(bad);
  }
  for (const e of employees) if (e.purpose && !isPurpose(e.purpose)) return fail("The purpose of a review is Annual Review or Confirmation.");
  // the header of the paper form: designation and department as they are on the staff profile today
  const profiles = await db.select({ userId: profile.userId, jobTitle: profile.jobTitle, department: profile.department }).from(profile).where(inArray(profile.userId, ids));
  const profileOf = (u: string | null | undefined) => profiles.find((p) => p.userId === u);
  // the goals set at the employee's last completed review are what they report progress on in this one
  const lastPlans = await db.select({ employeeUserId: review.employeeUserId, actionPlan: review.actionPlan, createdAt: review.createdAt }).from(review)
    .where(and(inArray(review.organizationId, orgIds), eq(review.status, "completed"), inArray(review.employeeUserId, employees.map((e) => e.userId)))).orderBy(desc(review.createdAt));
  const goalsOf = (u: string): PreviousGoal[] => {
    const plan = lastPlans.find((p) => p.employeeUserId === u && (p.actionPlan ?? []).length > 0)?.actionPlan ?? [];
    return plan.map((g) => ({ goal: g.goal, action: "", completed: "" as const, comments: "" }));
  };
  const rows = employees.map((e) => ({
    id: nanoid(), organizationId: orgOfEmployee(e), periodId, employeeUserId: e.userId, reviewerUserId: e.reviewerUserId || null, leadWeight: e.leadWeight ?? 100,
    status: "self" as const, templateName: form.templateName, scaleMax: form.scaleMax, criteria: form.criteria,
    questions: form.questions,
    purpose: e.purpose ?? null,
    employeeDesignation: profileOf(e.userId)?.jobTitle ?? null, employeeDepartment: profileOf(e.userId)?.department ?? null,
    reviewerDesignation: profileOf(e.reviewerUserId)?.jobTitle ?? null,
    previousGoals: goalsOf(e.userId),
  }));
  if (rows.length > 0) await db.insert(review).values(rows);
  const coRows = rows.flatMap((r, i) => (employees[i].coReviewers ?? []).map((c) => ({
    id: nanoid(), reviewId: r.id, userId: c.userId, weight: c.weight, designation: profileOf(c.userId)?.jobTitle ?? null,
  })));
  if (coRows.length > 0) await db.insert(reviewReviewer).values(coRows);
  for (const r of rows) {
    await notifyUser(r.organizationId, r.employeeUserId, { title: `Performance review: ${periodName}`, body: "Your self-assessment is waiting. Please complete it.", link: `${LINK}/review/${r.id}` });
  }
  return ok(rows.length);
}

export async function createPeriod(ctx: Ctx, input: PeriodInput): Promise<Result<string>> {
  if (!can(ctx, "review:manage")) return NO_ACCESS;
  const name = input.name?.trim();
  if (!name) return fail("Give the review period a name, e.g. 2026 H2.");
  if (!input.startDate || !input.endDate) return fail("Enter the start and end date of the period.");
  if (input.endDate < input.startDate) return fail("The end date cannot be before the start date.");
  if (!input.templateId) return fail("Choose a template.");
  if (!input.employees?.length) return fail("Select at least one employee.");
  const dup = input.employees.map((e) => e.userId).find((u, i, a) => a.indexOf(u) !== i);
  if (dup) return fail("An employee is selected twice.");
  const form = await formFromTemplate((await ownerOrgsOf(ctx.orgId)).map((o) => o.id), input.templateId, { requireActive: true });
  if (!form.ok) return form;

  const id = nanoid();
  await db.insert(reviewPeriod).values({ id, organizationId: ctx.orgId, name, startDate: input.startDate, endDate: input.endDate, templateId: input.templateId, showReviewerMarks: input.showReviewerMarks ?? true, createdBy: ctx.userId });
  const r = await openReviews(ctx, id, name, form.value, input.employees);
  if (!r.ok) { await db.delete(reviewPeriod).where(eq(reviewPeriod.id, id)); return r; } // nothing is left half-made
  return ok(id);
}

// a late joiner, or someone left out: open their review in an existing period
export async function addReviews(ctx: Ctx, periodId: string, employees: PeriodInput["employees"]): Promise<Result<number>> {
  if (!can(ctx, "review:manage")) return NO_ACCESS;
  const [p] = await db.select().from(reviewPeriod).where(and(eq(reviewPeriod.id, periodId), eq(reviewPeriod.organizationId, ctx.orgId)));
  if (!p) return fail("Review period not found.");
  if (p.status !== "open") return fail("This period is closed. Reopen it to add people.");
  const have = await db.select({ u: review.employeeUserId }).from(review).where(eq(review.periodId, periodId));
  const already = new Set(have.map((h) => h.u));
  const fresh = employees.filter((e) => !already.has(e.userId));
  if (fresh.length === 0) return fail("Those employees already have a review in this period.");
  // the same form as the people already in the period; only a period with no review at all falls back to its template
  let form = await formOfPeriod(periodId);
  if (!form) {
    if (!p.templateId) return fail("This period has no template any more.");
    const t = await formFromTemplate((await ownerOrgsOf(ctx.orgId)).map((o) => o.id), p.templateId, { requireActive: false });
    if (!t.ok) return t;
    form = t.value;
  }
  return openReviews(ctx, periodId, p.name, form, fresh);
}

export async function listPeriods(ctx: Ctx) {
  if (!can(ctx, "review:manage")) return [];
  const periods = await db.select().from(reviewPeriod).where(eq(reviewPeriod.organizationId, ctx.orgId)).orderBy(desc(reviewPeriod.startDate));
  const reviews = periods.length ? await db.select({ periodId: review.periodId, status: review.status }).from(review).where(inArray(review.periodId, periods.map((p) => p.id))) : [];
  return periods.map((p) => {
    const mine = reviews.filter((r) => r.periodId === p.id && r.status !== "cancelled");
    return { ...p, total: mine.length, completed: mine.filter((r) => r.status === "completed").length, signoff: mine.filter((r) => r.status === "signoff").length };
  });
}
export type PeriodSummary = Awaited<ReturnType<typeof listPeriods>>[number];

export async function getPeriod(ctx: Ctx, id: string) {
  if (!can(ctx, "review:manage")) return null;
  const [p] = await db.select().from(reviewPeriod).where(and(eq(reviewPeriod.id, id), eq(reviewPeriod.organizationId, ctx.orgId)));
  if (!p) return null;
  const rows = await db.select().from(review).where(eq(review.periodId, id));
  const orgs = await ownerOrgsOf(ctx.orgId);
  const cos = rows.length ? await db.select().from(reviewReviewer).where(inArray(reviewReviewer.reviewId, rows.map((r) => r.id))).orderBy(asc(reviewReviewer.createdAt)) : [];
  const ids = [...new Set([...rows.flatMap((r) => [r.employeeUserId, r.reviewerUserId].filter((v): v is string => !!v)), ...cos.map((c) => c.userId)])];
  const names = ids.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids)) : [];
  const nameOf = (u: string | null) => names.find((n) => n.id === u)?.name ?? null;
  return {
    ...p,
    reviews: rows
      .map((r) => ({
        id: r.id, employeeUserId: r.employeeUserId, employeeName: nameOf(r.employeeUserId) ?? "—", reviewerUserId: r.reviewerUserId, reviewerName: nameOf(r.reviewerUserId),
        status: r.status as ReviewStatus, finalScore: r.finalScore, scaleMax: r.scaleMax,
        // the employee disagreed and HR has not settled it yet; round 2+ = reopened after a disagreement
        disputed: isOpenDispute(r), round: (r.history ?? []).length + 1, employeeResponse: r.employeeResponse,
        // the reviewers besides the lead, and their share
        leadWeight: r.leadWeight,
        coReviewers: cos.filter((c) => c.reviewId === r.id).map((c) => ({ userId: c.userId, name: nameOf(c.userId) ?? "—", weight: c.weight, submitted: !!c.submittedAt })),
        // for the filters and the export
        organizationId: r.organizationId, organizationName: orgs.find((o) => o.id === r.organizationId)?.name ?? "", department: r.employeeDepartment, designation: r.employeeDesignation,
        purpose: isPurpose(r.purpose) ? r.purpose : null, outcome: isOutcome(r.outcome) ? r.outcome : null,
        selfSubmittedAt: r.selfSubmittedAt, managerSubmittedAt: r.managerSubmittedAt, signedOffAt: r.signedOffAt, acknowledgedAt: r.acknowledgedAt,
      }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
  };
}
export type PeriodDetail = NonNullable<Awaited<ReturnType<typeof getPeriod>>>;

// Nudges the people a period is waiting for: employees who have not submitted their self-assessment, managers who have not
// reviewed, and HR for reviews waiting for sign-off. Nobody is reminded twice in a day, so pressing it again is harmless.
export async function remindPeriod(ctx: Ctx, periodId: string): Promise<Result<{ reminded: number; skipped: number }>> {
  if (!can(ctx, "review:manage")) return NO_ACCESS;
  const [p] = await db.select().from(reviewPeriod).where(and(eq(reviewPeriod.id, periodId), eq(reviewPeriod.organizationId, ctx.orgId)));
  if (!p) return fail("Review period not found.");
  if (p.status !== "open") return fail("This period is closed.");
  const rows = (await db.select().from(review).where(eq(review.periodId, periodId))).filter((r) => r.status !== "cancelled" && r.status !== "completed");
  if (rows.length === 0) return fail("Nothing is waiting: every review in this period is completed.");
  const names = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, rows.map((r) => r.employeeUserId)));
  const nameOf = (u: string) => names.find((n) => n.id === u)?.name ?? "an employee";
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const recent = await db.select({ userId: notification.userId, link: notification.link }).from(notification)
    .where(and(eq(notification.type, "review"), sql`${notification.title} LIKE 'Reminder:%'`, sql`${notification.createdAt} > ${since}`));
  const wasReminded = (userId: string, link: string) => recent.some((n) => n.userId === userId && n.link === link);
  let reminded = 0, skipped = 0;
  const send = async (orgId: string, userId: string | null, title: string, body: string, link: string) => {
    if (!userId) { skipped++; return; }
    if (wasReminded(userId, link)) { skipped++; return; }
    await notifyUser(orgId, userId, { title, body, link });
    recent.push({ userId, link });
    reminded++;
  };
  const cos = await db.select().from(reviewReviewer).where(and(inArray(reviewReviewer.reviewId, rows.map((r) => r.id)), isNull(reviewReviewer.submittedAt)));
  for (const r of rows) {
    const link = `${LINK}/review/${r.id}`;
    if (r.status === "manager") for (const c of cos.filter((x) => x.reviewId === r.id)) await send(r.organizationId, c.userId, `Reminder: review of ${nameOf(r.employeeUserId)}`, `Your marks for ${nameOf(r.employeeUserId)} (${p.name}) are still waiting.`, link);
    if (r.status === "self") await send(r.organizationId, r.employeeUserId, `Reminder: ${p.name}`, "Your self-assessment is still waiting. Please complete it.", link);
    else if (r.status === "manager") await send(r.organizationId, r.reviewerUserId, `Reminder: review of ${nameOf(r.employeeUserId)}`, `Your review of ${nameOf(r.employeeUserId)} for ${p.name} is still waiting.`, link);
    else if (r.status === "signoff") {
      for (const hr of await reviewManagerIds(p.organizationId)) await send(p.organizationId, hr, `Reminder: sign off ${nameOf(r.employeeUserId)}`, `The review of ${nameOf(r.employeeUserId)} (${p.name}) is waiting for sign-off.`, link);
    }
  }
  return ok({ reminded, skipped });
}

export async function setPeriodStatus(ctx: Ctx, id: string, status: "open" | "closed"): Promise<Result> {
  if (!can(ctx, "review:manage")) return NO_ACCESS;
  await db.update(reviewPeriod).set({ status, closedAt: status === "closed" ? new Date() : null }).where(and(eq(reviewPeriod.id, id), eq(reviewPeriod.organizationId, ctx.orgId)));
  return ok(undefined);
}

// ── lists ───────────────────────────────────────────────────────────────────
async function withContext(rows: (typeof review.$inferSelect)[]) {
  const periods = rows.length ? await db.select().from(reviewPeriod).where(inArray(reviewPeriod.id, rows.map((r) => r.periodId))) : [];
  const ids = [...new Set(rows.flatMap((r) => [r.employeeUserId, r.reviewerUserId].filter((v): v is string => !!v)))];
  const names = ids.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids)) : [];
  return rows.map((r) => {
    const p = periods.find((x) => x.id === r.periodId);
    return {
      id: r.id, status: r.status as ReviewStatus, periodName: p?.name ?? "", periodStatus: p?.status ?? "open", startDate: p?.startDate ?? "", endDate: p?.endDate ?? "",
      employeeName: names.find((n) => n.id === r.employeeUserId)?.name ?? "—", reviewerName: names.find((n) => n.id === r.reviewerUserId)?.name ?? null,
      // the employee only sees the score once the review is completed
      finalScore: r.finalScore, scaleMax: r.scaleMax, returnNote: r.returnNote,
    };
  });
}
export type ReviewListRow = Awaited<ReturnType<typeof withContext>>[number];

// Being named on a review is what gives access to it: the employee to their own review, the assigned manager to the
// reviews waiting for them. No permission has to be granted separately (HR opening a review is the grant), so the
// person who got the notification can always open it. HR powers still need review:manage.
export async function listMyReviews(ctx: Ctx): Promise<ReviewListRow[]> {
  const rows = await db.select().from(review).where(eq(review.employeeUserId, ctx.userId)).orderBy(desc(review.createdAt));
  return (await withContext(rows.filter((r) => r.status !== "cancelled"))).map((r) => (r.status === "completed" ? r : { ...r, finalScore: null }));
}

export async function listTeamReviews(ctx: Ctx): Promise<ReviewListRow[]> {
  const asCo = await db.select({ reviewId: reviewReviewer.reviewId }).from(reviewReviewer).where(eq(reviewReviewer.userId, ctx.userId));
  const rows = await db.select().from(review)
    .where(asCo.length ? or(eq(review.reviewerUserId, ctx.userId), inArray(review.id, asCo.map((x) => x.reviewId))) : eq(review.reviewerUserId, ctx.userId))
    .orderBy(desc(review.createdAt));
  return withContext(rows.filter((r) => r.status !== "cancelled"));
}

// ── one review ──────────────────────────────────────────────────────────────
export type ReviewView = {
  id: string;
  organizationId: string; // the company the review is kept under (the employee's own): its letterhead goes on the PDF
  role: ReviewRole;
  status: ReviewStatus;
  periodName: string;
  periodOpen: boolean;
  templateName: string;
  scaleMax: number;
  criteria: Criterion[];
  employeeName: string;
  reviewerName: string | null;
  // the header of the form
  periodStart: string;
  periodEnd: string;
  purpose: ReviewPurpose | null;
  employeeDesignation: string | null;
  employeeDepartment: string | null;
  reviewerDesignation: string | null;
  // the written parts (employee)
  questions: ReviewQuestion[];
  questionAnswers: Record<string, string>;
  previousGoals: PreviousGoal[];
  // the reviewer's part (visible once the manager side is visible)
  outcome: ReviewOutcome | null;
  nextReviewDate: string | null;
  actionPlan: ActionPlanRow[];
  acknowledgedAt: Date | null;
  // the employee's answer to the signed-off review, and how HR settled a disagreement
  employeeResponse: EmployeeResponse | null;
  employeeComment: string | null;
  disputeResolution: string | null;
  disputeResolvedAt: Date | null;
  disputeResolvedByName: string | null;
  canResolveDispute: boolean; // HR: keep the marks or reopen to the manager
  // earlier rounds, oldest first, when the review was reopened after a disagreement
  rounds: (Omit<ReviewRound, "signedOffBy" | "reopenedBy" | "coReviewers"> & {
    signedOffByName: string | null; reopenedByName: string | null;
    coReviewers: { name: string; share: number; score: number | null; answers: Record<string, { rating: number | null; na: boolean; comment: string | null }> }[];
    leadShare: number;
  })[];
  // more than one reviewer
  isLead: boolean; // the caller is the lead reviewer (writes Section B, submits for sign-off)
  multipleReviewers: boolean;
  // every reviewer the caller may see marks of, the lead first (empty with a single reviewer). Marks of a reviewer who
  // has not submitted yet are left out (drafts are private).
  reviewers: ReviewerMarks[];
  // per criterion, the reviewers' ratings combined by share (null with a single reviewer, or when not visible)
  combined: Record<string, number | null> | null;
  waitingFor: string[]; // lead / HR: the other reviewers who have not submitted yet
  showReviewerMarks: boolean; // the period's setting: employees see each reviewer's marks by name
  // HR: who reviews and their shares, to change them
  reviewerSetup: { leadWeight: number; coReviewers: { userId: string; name: string; weight: number; submitted: boolean }[] } | null;
  canAcknowledge: boolean;
  canEdit: boolean;
  canSignOff: boolean;
  canReassign: boolean;
  returnNote: string | null;
  selfSummary: string | null;
  managerSummary: string | null;
  signoffComment: string | null;
  finalScore: string | null;
  selfSubmittedAt: Date | null;
  managerSubmittedAt: Date | null;
  signedOffAt: Date | null;
  signedOffByName: string | null;
  answers: Record<string, { selfRating: number | null; selfNa: boolean; selfComment: string | null; managerRating: number | null; managerNa: boolean; managerComment: string | null }>;
};

export type ReviewerMarks = {
  key: string; // "lead" or the review_reviewer id
  name: string;
  designation: string | null;
  isLead: boolean;
  share: number; // percent of the score
  submittedAt: Date | null;
  summary: string | null;
  score: number | null; // this reviewer's own criterion-weighted score
  answers: Record<string, { rating: number | null; na: boolean; comment: string | null }>;
};

// who the caller is on this review. Your own review never gives you reviewer or HR powers over it.
function roleOf(ctx: Ctx, r: typeof review.$inferSelect, periodOrgId: string | null, isCoReviewer = false): ReviewRole | null {
  const isEmployee = r.employeeUserId === ctx.userId;
  if (isEmployee) return "employee";
  const isReviewer = r.reviewerUserId === ctx.userId || isCoReviewer;
  if (isReviewer && r.status === "manager") return "reviewer";
  // HR of the company that opened the period, or of the company the review is kept under
  if (can(ctx, "review:manage") && (r.organizationId === ctx.orgId || periodOrgId === ctx.orgId)) return "hr";
  if (isReviewer) return "reviewer";
  return null;
}

async function loadReview(ctx: Ctx, id: string) {
  const [r] = await db.select().from(review).where(eq(review.id, id));
  if (!r) return null;
  const [[p], [co]] = await Promise.all([
    db.select({ organizationId: reviewPeriod.organizationId }).from(reviewPeriod).where(eq(reviewPeriod.id, r.periodId)),
    db.select().from(reviewReviewer).where(and(eq(reviewReviewer.reviewId, id), eq(reviewReviewer.userId, ctx.userId))),
  ]);
  const role = roleOf(ctx, r, p?.organizationId ?? null, !!co);
  // the lead reviewer writes Section B and submits for sign-off; another reviewer ("co") only gives their own marks
  return role ? { r, role, co: role === "reviewer" && r.reviewerUserId !== ctx.userId ? co ?? null : null, isLead: role === "reviewer" && r.reviewerUserId === ctx.userId } : null;
}

export async function getReview(ctx: Ctx, id: string): Promise<ReviewView | null> {
  const found = await loadReview(ctx, id);
  if (!found) return null;
  const { r, role, co: myCo, isLead } = found;
  if (r.status === "cancelled" && role !== "hr") return null;
  const cos = await coReviewersOf(id);
  const [period, answers, names] = await Promise.all([
    db.select().from(reviewPeriod).where(eq(reviewPeriod.id, r.periodId)).then((x) => x[0]),
    db.select().from(reviewAnswer).where(eq(reviewAnswer.reviewId, id)),
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set([
      r.employeeUserId, r.reviewerUserId, r.signedOffBy, r.disputeResolvedBy, ...cos.map((c) => c.userId),
      ...(r.history ?? []).flatMap((h) => [h.signedOffBy, h.reopenedBy, ...(h.coReviewers ?? []).map((c) => c.userId)]),
    ].filter((v): v is string => !!v))])),
  ]);
  const nameOf = (u: string | null) => names.find((n) => n.id === u)?.name ?? null;
  const showManager = managerSideVisible(role, r.status as ReviewStatus);
  const showSelf = selfSideVisible(role, r.status as ReviewStatus);
  const periodOpen = period?.status === "open";
  const status = r.status as ReviewStatus;
  const multi = cos.length > 0;
  const byName = period?.showReviewerMarks ?? true;
  // the employee in a "combined marks only" period sees no reviewer's own ratings
  const combinedOnly = role === "employee" && multi && !byName;
  // whose marks one by one: HR and the lead always; another reviewer once they have submitted their own; the employee
  // once the review is completed, if the period shows marks by name
  const seeEach = multi && (role === "hr" || isLead || (!!myCo && !!myCo.submittedAt) || (role === "employee" && status === "completed" && byName));
  const leadMarks: MarkMap = Object.fromEntries(answers.map((a) => [a.criterionId, { rating: a.managerNa ? null : a.managerRating, na: a.managerNa, comment: a.managerComment }]));
  const weights = [r.leadWeight, ...cos.map((c) => c.weight)];
  const reviewers: ReviewerMarks[] = !seeEach ? [] : [
    { key: "lead", name: nameOf(r.reviewerUserId) ?? "Lead reviewer", designation: r.reviewerDesignation, isLead: true, share: sharePercent(r.leadWeight, weights), submittedAt: r.managerSubmittedAt, summary: r.managerSummary, score: weightedScore(r.criteria, ratingsIn(leadMarks)), answers: leadMarks },
    ...cos.map((c) => ({
      key: c.id, name: nameOf(c.userId) ?? "Reviewer", designation: c.designation, isLead: false, share: sharePercent(c.weight, weights), submittedAt: c.submittedAt,
      // drafts are private: only what was submitted (and your own) is shown
      summary: c.submittedAt || c.userId === ctx.userId ? c.summary : null,
      score: c.submittedAt || c.userId === ctx.userId ? weightedScore(r.criteria, ratingsIn(c.marks)) : null,
      answers: c.submittedAt || c.userId === ctx.userId ? c.marks : {},
    })),
  ];
  const combined = multi && showManager && (role !== "reviewer" || isLead || !!myCo?.submittedAt)
    ? combinedByCriterion(r.criteria, [{ weight: r.leadWeight, marks: leadMarks }, ...cos.filter((c) => c.submittedAt).map((c) => ({ weight: c.weight, marks: c.marks }))])
    : null;
  const answerMap: ReviewView["answers"] = {};
  for (const c of r.criteria) {
    const a = answers.find((x) => x.criterionId === c.id);
    // for another reviewer, "manager" is their own marks; for everyone else it is the lead's
    const mine = myCo ? cos.find((x) => x.id === myCo.id)?.marks[c.id] : undefined;
    answerMap[c.id] = {
      selfRating: showSelf || role === "employee" ? a?.selfRating ?? null : null,
      selfNa: showSelf || role === "employee" ? a?.selfNa ?? false : false,
      selfComment: showSelf || role === "employee" ? a?.selfComment ?? null : null,
      managerRating: myCo ? mine?.rating ?? null : showManager && !combinedOnly ? a?.managerRating ?? null : null,
      managerNa: myCo ? mine?.na ?? false : showManager && !combinedOnly ? a?.managerNa ?? false : false,
      managerComment: myCo ? mine?.comment ?? null : showManager ? a?.managerComment ?? null : null,
    };
  }
  const myCoRow = myCo ? cos.find((x) => x.id === myCo.id) : undefined;
  return {
    id: r.id, organizationId: r.organizationId, role, status: r.status as ReviewStatus, periodName: period?.name ?? "", periodOpen, templateName: r.templateName, scaleMax: r.scaleMax,
    criteria: r.criteria, employeeName: nameOf(r.employeeUserId) ?? "—", reviewerName: nameOf(r.reviewerUserId),
    periodStart: period?.startDate ?? "", periodEnd: period?.endDate ?? "",
    purpose: isPurpose(r.purpose) ? r.purpose : null,
    employeeDesignation: r.employeeDesignation, employeeDepartment: r.employeeDepartment, reviewerDesignation: r.reviewerDesignation,
    questions: r.questions ?? [],
    questionAnswers: showSelf || role === "employee" ? r.questionAnswers ?? {} : {},
    previousGoals: showSelf || role === "employee" ? r.previousGoals ?? [] : [],
    outcome: showManager && isOutcome(r.outcome) ? r.outcome : null,
    nextReviewDate: showManager ? r.nextReviewDate : null,
    actionPlan: showManager ? r.actionPlan ?? [] : [],
    acknowledgedAt: r.acknowledgedAt,
    employeeResponse: r.employeeResponse === "agree" || r.employeeResponse === "disagree" ? r.employeeResponse : null,
    employeeComment: r.employeeComment,
    disputeResolution: r.disputeResolution,
    disputeResolvedAt: r.disputeResolvedAt,
    disputeResolvedByName: nameOf(r.disputeResolvedBy),
    canResolveDispute: role === "hr" && isOpenDispute(r),
    // every round in the history was signed off and shown to the employee, so everyone on the review may read it
    rounds: (r.history ?? []).map(({ signedOffBy, reopenedBy, coReviewers, ...h }) => {
      const co = coReviewers ?? [];
      const w = [h.leadWeight ?? 100, ...co.map((c) => c.weight)];
      // in a "combined marks only" period the employee sees the combined marks of earlier rounds too
      const hideEach = role === "employee" && co.length > 0 && !byName;
      return {
        ...h,
        managerAnswers: hideEach
          ? Object.fromEntries(Object.entries(combinedByCriterion(r.criteria, [{ weight: h.leadWeight ?? 100, marks: h.managerAnswers }, ...co.map((c) => ({ weight: c.weight, marks: c.answers }))])).map(([k, v]) => [k, { rating: v, na: false, comment: null }]))
          : h.managerAnswers,
        signedOffByName: nameOf(signedOffBy), reopenedByName: nameOf(reopenedBy),
        leadShare: sharePercent(h.leadWeight ?? 100, w),
        coReviewers: hideEach ? [] : co.map((c) => ({ name: nameOf(c.userId) ?? "Reviewer", share: sharePercent(c.weight, w), score: c.score, answers: c.answers })),
      };
    }),
    isLead,
    multipleReviewers: multi,
    reviewers,
    combined,
    waitingFor: isLead || role === "hr" ? cos.filter((c) => !c.submittedAt).map((c) => nameOf(c.userId) ?? "a reviewer") : [],
    showReviewerMarks: byName,
    reviewerSetup: role === "hr" ? { leadWeight: r.leadWeight, coReviewers: cos.map((c) => ({ userId: c.userId, name: nameOf(c.userId) ?? "—", weight: c.weight, submitted: !!c.submittedAt })) } : null,
    canAcknowledge: role === "employee" && r.status === "completed" && !r.acknowledgedAt,
    canEdit: periodOpen && (myCo ? status === "manager" && !myCoRow?.submittedAt : canEditNow(role, status)),
    canSignOff: periodOpen && role === "hr" && r.status === "signoff",
    canReassign: periodOpen && role === "hr" && (r.status === "self" || r.status === "manager"),
    returnNote: role === "employee" ? null : r.returnNote,
    selfSummary: showSelf || role === "employee" ? r.selfSummary : null,
    managerSummary: myCo ? myCoRow?.summary ?? null : showManager ? r.managerSummary : null,
    signoffComment: showManager ? r.signoffComment : null,
    finalScore: showManager ? r.finalScore : null,
    selfSubmittedAt: showSelf || role === "employee" ? r.selfSubmittedAt : null,
    managerSubmittedAt: showManager ? r.managerSubmittedAt : null,
    signedOffAt: showManager ? r.signedOffAt : null,
    signedOffByName: showManager ? nameOf(r.signedOffBy) : null,
    answers: answerMap,
  };
}

export type AnswerInput = { criterionId: string; rating: number | null; na?: boolean; comment?: string };

async function upsertAnswers(reviewId: string, side: "self" | "manager", answers: AnswerInput[]) {
  const existing = await db.select().from(reviewAnswer).where(eq(reviewAnswer.reviewId, reviewId));
  for (const a of answers) {
    const comment = a.comment?.trim() || null;
    const hit = existing.find((e) => e.criterionId === a.criterionId);
    const na = !!a.na; // not applicable: no rating
    const rating = na ? null : a.rating;
    const set = side === "self" ? { selfRating: rating, selfNa: na, selfComment: comment } : { managerRating: rating, managerNa: na, managerComment: comment };
    if (hit) await db.update(reviewAnswer).set(set).where(eq(reviewAnswer.id, hit.id));
    else await db.insert(reviewAnswer).values({ id: nanoid(), reviewId, criterionId: a.criterionId, ...set });
  }
}

function checkAnswers(r: typeof review.$inferSelect, answers: AnswerInput[]): string | null {
  const known = new Set(r.criteria.map((c) => c.id));
  for (const a of answers) {
    if (!known.has(a.criterionId)) return "A criterion in the form does not exist any more. Reload the page.";
    if (a.rating != null && !isValidRating(a.rating, r.scaleMax)) return `Ratings are from 1 to ${r.scaleMax}.`;
  }
  return null;
}

async function ratingsOf(reviewId: string, side: "self" | "manager") {
  const rows = await db.select().from(reviewAnswer).where(eq(reviewAnswer.reviewId, reviewId));
  return {
    ratings: Object.fromEntries(rows.map((a) => [a.criterionId, side === "self" ? a.selfRating : a.managerRating])) as Record<string, number | null>,
    na: Object.fromEntries(rows.map((a) => [a.criterionId, side === "self" ? a.selfNa : a.managerNa])) as Record<string, boolean>,
  };
}

// ── reviewers besides the lead ──────────────────────────────────────────────
type MarkMap = Record<string, { rating: number | null; na: boolean; comment: string | null }>; // criterion id ->

async function coReviewersOf(reviewId: string) {
  const rows = await db.select().from(reviewReviewer).where(eq(reviewReviewer.reviewId, reviewId)).orderBy(asc(reviewReviewer.createdAt));
  const answers = rows.length ? await db.select().from(reviewReviewerAnswer).where(inArray(reviewReviewerAnswer.reviewerId, rows.map((x) => x.id))) : [];
  return rows.map((x) => ({
    ...x,
    marks: Object.fromEntries(answers.filter((a) => a.reviewerId === x.id).map((a) => [a.criterionId, { rating: a.na ? null : a.rating, na: a.na, comment: a.comment }])) as MarkMap,
  }));
}

const ratingsIn = (m: MarkMap) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.na ? null : v.rating])) as Record<string, number | null>;
const naIn = (m: MarkMap) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.na])) as Record<string, boolean>;

async function leadMarksOf(reviewId: string): Promise<MarkMap> {
  const rows = await db.select().from(reviewAnswer).where(eq(reviewAnswer.reviewId, reviewId));
  return Object.fromEntries(rows.map((a) => [a.criterionId, { rating: a.managerNa ? null : a.managerRating, na: a.managerNa, comment: a.managerComment }]));
}

// per criterion: the reviewers' ratings combined by share (a reviewer's N/A leaves only their mark out)
function combinedByCriterion(criteria: Criterion[], parts: { weight: number; marks: MarkMap }[]): Record<string, number | null> {
  return Object.fromEntries(criteria.map((c) => [c.id, combineScores(parts.map((p) => ({ score: p.marks[c.id]?.na ? null : p.marks[c.id]?.rating ?? null, weight: p.weight })))]));
}

// the final score: each reviewer's criterion-weighted score, combined by share. With only the lead it is the lead's score.
async function finalScoreOf(r: typeof review.$inferSelect): Promise<number | null> {
  const lead = weightedScore(r.criteria, ratingsIn(await leadMarksOf(r.id)));
  const co = await coReviewersOf(r.id);
  if (co.length === 0) return lead;
  return combineScores([{ score: lead, weight: r.leadWeight }, ...co.map((c) => ({ score: weightedScore(r.criteria, ratingsIn(c.marks)), weight: c.weight }))]);
}

async function upsertCoAnswers(reviewerId: string, answers: AnswerInput[]) {
  const existing = await db.select().from(reviewReviewerAnswer).where(eq(reviewReviewerAnswer.reviewerId, reviewerId));
  for (const a of answers) {
    const na = !!a.na;
    const set = { rating: na ? null : a.rating, na, comment: a.comment?.trim() || null };
    const hit = existing.find((e) => e.criterionId === a.criterionId);
    if (hit) await db.update(reviewReviewerAnswer).set(set).where(eq(reviewReviewerAnswer.id, hit.id));
    else await db.insert(reviewReviewerAnswer).values({ id: nanoid(), reviewerId, criterionId: a.criterionId, ...set });
  }
}

// the written parts the employee fills in: answers keyed by a question of this review, and rows of progress on the last goals
function checkEmployeeParts(r: typeof review.$inferSelect, input: { questionAnswers?: Record<string, string>; previousGoals?: PreviousGoal[] }) {
  const known = new Set((r.questions ?? []).map((q) => q.id));
  const questionAnswers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.questionAnswers ?? {})) {
    if (!known.has(k)) return { error: "A question in the form does not exist any more. Reload the page." as const };
    questionAnswers[k] = String(v ?? "").trim();
  }
  const previousGoals = (input.previousGoals ?? []).map((g) => ({ goal: g.goal?.trim() ?? "", action: g.action?.trim() ?? "", completed: g.completed === "Y" || g.completed === "N" ? g.completed : ("" as const), comments: g.comments?.trim() ?? "" }))
    .filter((g) => g.goal || g.action || g.completed || g.comments);
  const noGoal = previousGoals.findIndex((g) => !g.goal);
  if (noGoal >= 0) return { error: `Goal ${noGoal + 1} has no goal written. Write the goal or remove the row.` as const };
  return { questionAnswers, previousGoals };
}

// the reviewer's outcome, next review date and goals for the next period
function checkReviewerParts(input: { outcome?: string | null; nextReviewDate?: string | null; actionPlan?: ActionPlanRow[] }) {
  if (input.outcome && !isOutcome(input.outcome)) return { error: "Choose Satisfactory, Unsatisfactory or Extension of probation." as const };
  if (input.nextReviewDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.nextReviewDate)) return { error: "Enter a valid next review date." as const };
  const actionPlan = (input.actionPlan ?? []).map((g) => ({ goal: g.goal?.trim() ?? "", action: g.action?.trim() ?? "", targetDate: g.targetDate?.trim() ?? "" })).filter((g) => g.goal || g.action || g.targetDate);
  const noGoal = actionPlan.findIndex((g) => !g.goal);
  if (noGoal >= 0) return { error: `Action plan row ${noGoal + 1} has no goal written. Write the goal or remove the row.` as const };
  const badDate = actionPlan.findIndex((g) => g.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(g.targetDate));
  if (badDate >= 0) return { error: `Action plan row ${badDate + 1} has an invalid target date.` as const };
  return { outcome: (input.outcome || null) as ReviewOutcome | null, nextReviewDate: input.nextReviewDate || null, actionPlan };
}

// Saves the employee's self-assessment; submit hands it to the manager
export async function saveSelf(ctx: Ctx, id: string, input: { answers: AnswerInput[]; summary?: string; submit: boolean; questionAnswers?: Record<string, string>; previousGoals?: PreviousGoal[] }): Promise<Result<{ status: ReviewStatus }>> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "employee") return NO_ACCESS;
  const { r } = found;
  if (r.status !== "self") return fail("The self-assessment has already been submitted.");
  const [period] = await db.select().from(reviewPeriod).where(eq(reviewPeriod.id, r.periodId));
  if (period?.status !== "open") return fail("This review period is closed.");
  const bad = checkAnswers(r, input.answers);
  if (bad) return fail(bad);
  const parts = checkEmployeeParts(r, input);
  if (parts.error) return fail(parts.error);
  await upsertAnswers(id, "self", input.answers);
  await db.update(review).set({ selfSummary: input.summary?.trim() || null, questionAnswers: parts.questionAnswers, previousGoals: parts.previousGoals }).where(eq(review.id, id));
  if (!input.submit) return ok({ status: "self" });

  const mine = await ratingsOf(id, "self");
  const missing = missingRatings(r.criteria, mine.ratings, mine.na);
  if (missing.length > 0) return fail(`Rate every criterion before submitting (missing: ${missing.slice(0, 3).map((m) => m.name).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}).`);
  await db.update(review).set({ status: "manager", selfSubmittedAt: new Date(), returnNote: null }).where(eq(review.id, id));
  const [emp] = await db.select({ name: user.name }).from(user).where(eq(user.id, r.employeeUserId));
  if (r.reviewerUserId) {
    await notifyUser(r.organizationId, r.reviewerUserId, { title: `Review to complete: ${emp?.name ?? "employee"}`, body: `${emp?.name ?? "An employee"} submitted a self-assessment for ${period.name}. Please review it.`, link: `${LINK}/review/${id}` });
    for (const c of await db.select({ userId: reviewReviewer.userId }).from(reviewReviewer).where(eq(reviewReviewer.reviewId, id))) {
      await notifyUser(r.organizationId, c.userId, { title: `Review to complete: ${emp?.name ?? "employee"}`, body: `${emp?.name ?? "An employee"} submitted a self-assessment for ${period.name}. Please give your marks.`, link: `${LINK}/review/${id}` });
    }
  } else {
    await notifyManagers(period.organizationId, { title: `No reviewer for ${emp?.name ?? "an employee"}`, body: `${emp?.name ?? "An employee"} submitted a self-assessment for ${period.name} but has no reviewer. Assign one.`, link: `${LINK}/periods/${r.periodId}` });
  }
  return ok({ status: "manager" });
}

// Saves the manager's review; submit sends it to HR for sign-off
export async function saveManager(ctx: Ctx, id: string, input: { answers: AnswerInput[]; summary?: string; submit: boolean; outcome?: string | null; nextReviewDate?: string | null; actionPlan?: ActionPlanRow[] }): Promise<Result<{ status: ReviewStatus }>> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "reviewer") return NO_ACCESS;
  const { r, co, isLead } = found;
  if (r.status !== "manager") return fail("This review is not waiting for you.");
  const [period] = await db.select().from(reviewPeriod).where(eq(reviewPeriod.id, r.periodId));
  if (period?.status !== "open") return fail("This review period is closed.");
  const bad = checkAnswers(r, input.answers);
  if (bad) return fail(bad);

  // another reviewer: only their own marks and comments; the lead finishes the review
  if (!isLead) {
    if (!co) return NO_ACCESS;
    if (co.submittedAt) return fail("You have already submitted your marks.");
    await upsertCoAnswers(co.id, input.answers);
    await db.update(reviewReviewer).set({ summary: input.summary?.trim() || null }).where(eq(reviewReviewer.id, co.id));
    if (!input.submit) return ok({ status: "manager" });
    const mine = (await coReviewersOf(id)).find((x) => x.id === co.id)!;
    const missing = missingRatings(r.criteria, ratingsIn(mine.marks), naIn(mine.marks));
    if (missing.length > 0) return fail(`Rate every criterion before submitting (missing: ${missing.slice(0, 3).map((m) => m.name).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}).`);
    await db.update(reviewReviewer).set({ submittedAt: new Date() }).where(and(eq(reviewReviewer.id, co.id), isNull(reviewReviewer.submittedAt)));
    const left = (await coReviewersOf(id)).filter((x) => !x.submittedAt).length;
    const [[me], [emp]] = await Promise.all([
      db.select({ name: user.name }).from(user).where(eq(user.id, ctx.userId)),
      db.select({ name: user.name }).from(user).where(eq(user.id, r.employeeUserId)),
    ]);
    await notifyUser(r.organizationId, r.reviewerUserId, {
      title: `Marks in: ${emp?.name ?? "employee"}`,
      body: `${me?.name ?? "A reviewer"} submitted their marks for ${emp?.name ?? "the employee"}.${left === 0 ? " Every other reviewer is done: you can submit the review for sign-off." : ` ${left} more to come.`}`,
      link: `${LINK}/review/${id}`,
    });
    return ok({ status: "manager" });
  }

  const parts = checkReviewerParts(input);
  if (parts.error) return fail(parts.error);
  await upsertAnswers(id, "manager", input.answers);
  await db.update(review).set({ managerSummary: input.summary?.trim() || null, outcome: parts.outcome, nextReviewDate: parts.nextReviewDate, actionPlan: parts.actionPlan }).where(eq(review.id, id));
  if (!input.submit) return ok({ status: "manager" });

  const { ratings, na } = await ratingsOf(id, "manager");
  const missing = missingRatings(r.criteria, ratings, na);
  if (missing.length > 0) return fail(`Rate every criterion before submitting (missing: ${missing.slice(0, 3).map((m) => m.name).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}).`);
  if (!parts.outcome) return fail("Choose the overall review outcome before submitting.");
  if (!input.summary?.trim()) return fail("Write the reviewer's comments before submitting.");
  const waiting = (await coReviewersOf(id)).filter((c) => !c.submittedAt);
  if (waiting.length > 0) {
    const names = await db.select({ name: user.name }).from(user).where(inArray(user.id, waiting.map((w) => w.userId)));
    return fail(`Waiting for ${names.map((n) => n.name).join(", ")} to submit their marks. Your draft is saved.`);
  }
  const score = await finalScoreOf(r);
  await db.update(review).set({ status: "signoff", managerSubmittedAt: new Date(), finalScore: score == null ? null : String(score), returnNote: null }).where(eq(review.id, id));
  const [emp] = await db.select({ name: user.name }).from(user).where(eq(user.id, r.employeeUserId));
  await notifyManagers(period.organizationId, { title: `Review to sign off: ${emp?.name ?? "employee"}`, body: `The manager review of ${emp?.name ?? "an employee"} (${period.name}) is ready for sign-off.`, link: `${LINK}/review/${id}` }, ctx.userId);
  return ok({ status: "signoff" });
}

export async function signOff(ctx: Ctx, id: string, comment?: string): Promise<Result> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "hr") return NO_ACCESS;
  const { r } = found;
  if (r.status !== "signoff") return fail("This review is not waiting for sign-off.");
  const [period] = await db.select().from(reviewPeriod).where(eq(reviewPeriod.id, r.periodId));
  if (period?.status !== "open") return fail("This review period is closed.");
  await db.update(review).set({ status: "completed", signedOffBy: ctx.userId, signedOffAt: new Date(), signoffComment: comment?.trim() || null }).where(eq(review.id, id));
  await notifyUser(r.organizationId, r.employeeUserId, { title: `Your review is ready: ${period.name}`, body: "Your performance review has been completed. You can read it now.", link: `${LINK}/review/${id}` });
  return ok(undefined);
}

// The employee confirms they have read the signed-off review (the signature and date on the paper form), and says
// whether they agree with it. Disagreeing needs a comment, and puts the review in front of HR, who either keeps the
// marks (resolveDispute) or reopens it to the manager (reopenReview).
export type EmployeeResponse = "agree" | "disagree";
export async function acknowledgeReview(ctx: Ctx, id: string, input: { response: EmployeeResponse; comment?: string }): Promise<Result> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "employee") return NO_ACCESS;
  const { r } = found;
  if (r.status !== "completed") return fail("You can acknowledge a review once HR has signed it off.");
  if (r.acknowledgedAt) return fail("You have already acknowledged this review.");
  if (input?.response !== "agree" && input?.response !== "disagree") return fail("Say whether you agree with the review.");
  const comment = input.comment?.trim() || null;
  if (input.response === "disagree" && !comment) return fail("Say what you disagree with, so HR and your manager can look at it.");
  await db.update(review).set({ acknowledgedAt: new Date(), employeeResponse: input.response, employeeComment: comment }).where(eq(review.id, id));
  const [[emp], [period]] = await Promise.all([
    db.select({ name: user.name }).from(user).where(eq(user.id, r.employeeUserId)),
    db.select({ organizationId: reviewPeriod.organizationId, name: reviewPeriod.name }).from(reviewPeriod).where(eq(reviewPeriod.id, r.periodId)),
  ]);
  const who = emp?.name ?? "The employee";
  const link = `${LINK}/review/${id}`;
  if (input.response === "agree") {
    if (r.reviewerUserId) await notifyUser(r.organizationId, r.reviewerUserId, { title: `Review acknowledged: ${who}`, body: `${who} has read the review and agrees with it.`, link });
    return ok(undefined);
  }
  const body = `${who} disagrees with the review (${period?.name ?? "review"}): "${comment}"`;
  if (r.reviewerUserId) await notifyUser(r.organizationId, r.reviewerUserId, { title: `Review disputed: ${who}`, body, link });
  await notifyReviewHr(r, period?.organizationId ?? r.organizationId, { title: `Review disputed: ${who}`, body: `${body} Keep the marks or reopen it to the manager.`, link }, [r.employeeUserId, ...(r.reviewerUserId ? [r.reviewerUserId] : [])]);
  return ok(undefined);
}

// a disagreement HR has not settled yet
const isOpenDispute = (r: typeof review.$inferSelect) => r.status === "completed" && r.employeeResponse === "disagree" && !r.disputeResolvedAt;

// HR keeps the marks: the review stays completed, with HR's reason next to the employee's comment
export async function resolveDispute(ctx: Ctx, id: string, note: string): Promise<Result> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "hr") return NO_ACCESS;
  const { r } = found;
  if (!isOpenDispute(r)) return fail("This review has no open disagreement.");
  if (!note?.trim()) return fail("Say why the marks stay as they are. The employee can read it.");
  await db.update(review).set({ disputeResolution: note.trim(), disputeResolvedBy: ctx.userId, disputeResolvedAt: new Date() }).where(eq(review.id, id));
  const link = `${LINK}/review/${id}`;
  await notifyUser(r.organizationId, r.employeeUserId, { title: "Your review: HR has replied", body: `The marks stay as they are. ${note.trim()}`, link });
  if (r.reviewerUserId && r.reviewerUserId !== ctx.userId) {
    const [emp] = await db.select({ name: user.name }).from(user).where(eq(user.id, r.employeeUserId));
    await notifyUser(r.organizationId, r.reviewerUserId, { title: `Disagreement closed: ${emp?.name ?? "employee"}`, body: `HR kept the marks. ${note.trim()}`, link });
  }
  return ok(undefined);
}

// HR reopens a disputed review to the manager. The round as it was signed off goes into the history (marks, score,
// sign-off and the employee's response), and the review goes through manager review, sign-off and acknowledgment again.
// The manager starts from their earlier marks.
export async function reopenReview(ctx: Ctx, id: string, note: string): Promise<Result> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "hr") return NO_ACCESS;
  const { r } = found;
  if (!isOpenDispute(r)) return fail("Only a review the employee disagreed with, and that is not settled yet, can be reopened.");
  if (!note?.trim()) return fail("Say what the manager should look at again.");
  if (!r.reviewerUserId) return fail("This review has no reviewer. Assign one first.");
  const [period] = await db.select().from(reviewPeriod).where(eq(reviewPeriod.id, r.periodId));
  if (period?.status !== "open") return fail("This review period is closed. Reopen the period first.");
  const answers = await db.select().from(reviewAnswer).where(eq(reviewAnswer.reviewId, id));
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const round: ReviewRound = {
    round: (r.history ?? []).length + 1,
    managerAnswers: Object.fromEntries(answers.map((a) => [a.criterionId, { rating: a.managerRating, na: a.managerNa, comment: a.managerComment }])),
    managerSummary: r.managerSummary, outcome: r.outcome, nextReviewDate: r.nextReviewDate, actionPlan: r.actionPlan ?? [], finalScore: r.finalScore,
    managerSubmittedAt: iso(r.managerSubmittedAt), signedOffBy: r.signedOffBy, signedOffAt: iso(r.signedOffAt), signoffComment: r.signoffComment,
    acknowledgedAt: iso(r.acknowledgedAt), employeeResponse: r.employeeResponse === "agree" || r.employeeResponse === "disagree" ? r.employeeResponse : null, employeeComment: r.employeeComment,
    reopenedBy: ctx.userId, reopenedAt: new Date().toISOString(), reopenNote: note.trim(),
    leadWeight: r.leadWeight,
    coReviewers: (await coReviewersOf(id)).map((c) => ({ userId: c.userId, weight: c.weight, summary: c.summary, score: weightedScore(r.criteria, ratingsIn(c.marks)), answers: c.marks })),
  };
  // the status guard makes a second reopen of the same round (double click, two HR at once) change nothing
  const done = await db.update(review).set({
    status: "manager", history: [...(r.history ?? []), round], returnNote: note.trim(),
    managerSubmittedAt: null, finalScore: null, signedOffBy: null, signedOffAt: null, signoffComment: null,
    acknowledgedAt: null, employeeResponse: null, employeeComment: null,
  }).where(and(eq(review.id, id), eq(review.status, "completed"))).returning({ id: review.id });
  if (done.length === 0) return fail("This review has changed in the meantime. Reload the page.");
  // every reviewer looks again (they keep their marks)
  await db.update(reviewReviewer).set({ submittedAt: null }).where(eq(reviewReviewer.reviewId, id));
  const [emp] = await db.select({ name: user.name }).from(user).where(eq(user.id, r.employeeUserId));
  const link = `${LINK}/review/${id}`;
  for (const u of [r.reviewerUserId, ...round.coReviewers!.map((c) => c.userId)]) {
    await notifyUser(r.organizationId, u, { title: `Review reopened: ${emp?.name ?? "employee"}`, body: `${emp?.name ?? "The employee"} disagreed: "${r.employeeComment ?? ""}". HR: ${note.trim()}`, link });
  }
  await notifyUser(r.organizationId, r.employeeUserId, { title: "Your review was reopened", body: "HR has sent your review back to your manager after your disagreement. You will be notified when it is ready again.", link });
  return ok(undefined);
}

export async function returnToManager(ctx: Ctx, id: string, note: string): Promise<Result> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "hr") return NO_ACCESS;
  const { r } = found;
  if (r.status !== "signoff") return fail("Only a review waiting for sign-off can be sent back.");
  if (!note?.trim()) return fail("Say what the manager should change.");
  if (!r.reviewerUserId) return fail("This review has no reviewer. Assign one first.");
  await db.update(review).set({ status: "manager", returnNote: note.trim(), managerSubmittedAt: null }).where(eq(review.id, id));
  // every reviewer looks again (they keep their marks); the lead submits once they are all done
  const cos = await db.update(reviewReviewer).set({ submittedAt: null }).where(eq(reviewReviewer.reviewId, id)).returning({ userId: reviewReviewer.userId });
  const [emp] = await db.select({ name: user.name }).from(user).where(eq(user.id, r.employeeUserId));
  for (const u of [r.reviewerUserId, ...cos.map((c) => c.userId)]) await notifyUser(r.organizationId, u, { title: `Review sent back: ${emp?.name ?? "employee"}`, body: note.trim(), link: `${LINK}/review/${id}` });
  return ok(undefined);
}

export async function reassignReviewer(ctx: Ctx, id: string, reviewerUserId: string): Promise<Result> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "hr") return NO_ACCESS;
  const { r } = found;
  if (r.status !== "self" && r.status !== "manager") return fail("The reviewer can only be changed before the manager has submitted.");
  if (reviewerUserId === r.employeeUserId) return fail("Nobody can be their own reviewer.");
  const owned = (await ownerOrgsOf(ctx.orgId)).map((o) => o.id);
  const [m] = await db.select({ id: member.id }).from(member).where(and(inArray(member.organizationId, owned), eq(member.userId, reviewerUserId), isNull(member.deletedAt)));
  if (!m) return fail("A reviewer must be a member of one of your companies.");
  const [asCo] = await db.select({ id: reviewReviewer.id }).from(reviewReviewer).where(and(eq(reviewReviewer.reviewId, id), eq(reviewReviewer.userId, reviewerUserId)));
  if (asCo) return fail("That person is already one of the other reviewers. Remove them there first to make them the lead.");
  const [rp] = await db.select({ jobTitle: profile.jobTitle }).from(profile).where(eq(profile.userId, reviewerUserId));
  await db.update(review).set({ reviewerUserId, reviewerDesignation: rp?.jobTitle ?? null }).where(eq(review.id, id));
  if (r.status === "manager") {
    const [emp] = await db.select({ name: user.name }).from(user).where(eq(user.id, r.employeeUserId));
    await notifyUser(r.organizationId, reviewerUserId, { title: `Review to complete: ${emp?.name ?? "employee"}`, body: "You were assigned as the reviewer.", link: `${LINK}/review/${id}` });
  }
  return ok(undefined);
}

// HR sets the reviewers besides the lead, and everyone's share, before the review is submitted for sign-off.
// Someone kept on keeps their marks; someone taken off loses theirs.
export async function setReviewers(ctx: Ctx, id: string, input: { leadWeight: number; coReviewers: { userId: string; weight: number }[] }): Promise<Result> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "hr") return NO_ACCESS;
  const { r } = found;
  if (r.status !== "self" && r.status !== "manager") return fail("The reviewers can only be changed before the review is submitted for sign-off.");
  const [period] = await db.select({ status: reviewPeriod.status }).from(reviewPeriod).where(eq(reviewPeriod.id, r.periodId));
  if (period?.status !== "open") return fail("This review period is closed.");
  const co = input.coReviewers ?? [];
  const owned = (await ownerOrgsOf(ctx.orgId)).map((o) => o.id);
  const members = co.length ? await db.select({ userId: member.userId }).from(member).where(and(inArray(member.organizationId, owned), inArray(member.userId, co.map((c) => c.userId)), isNull(member.deletedAt))) : [];
  const bad = checkReviewerSet(r.employeeUserId, r.reviewerUserId, input.leadWeight, co, new Set(members.map((m) => m.userId)));
  if (bad) return fail(bad);
  const existing = await db.select().from(reviewReviewer).where(eq(reviewReviewer.reviewId, id));
  const keep = new Set(co.map((c) => c.userId));
  const gone = existing.filter((x) => !keep.has(x.userId));
  if (gone.length) await db.delete(reviewReviewer).where(inArray(reviewReviewer.id, gone.map((x) => x.id)));
  const fresh: string[] = [];
  const profiles = co.length ? await db.select({ userId: profile.userId, jobTitle: profile.jobTitle }).from(profile).where(inArray(profile.userId, co.map((c) => c.userId))) : [];
  for (const c of co) {
    const hit = existing.find((x) => x.userId === c.userId);
    if (hit) { if (hit.weight !== c.weight) await db.update(reviewReviewer).set({ weight: c.weight }).where(eq(reviewReviewer.id, hit.id)); }
    else { await db.insert(reviewReviewer).values({ id: nanoid(), reviewId: id, userId: c.userId, weight: c.weight, designation: profiles.find((p) => p.userId === c.userId)?.jobTitle ?? null }); fresh.push(c.userId); }
  }
  await db.update(review).set({ leadWeight: input.leadWeight }).where(eq(review.id, id));
  if (r.status === "manager" && fresh.length) {
    const [emp] = await db.select({ name: user.name }).from(user).where(eq(user.id, r.employeeUserId));
    for (const u of fresh) await notifyUser(r.organizationId, u, { title: `Review to complete: ${emp?.name ?? "employee"}`, body: "You were added as one of the reviewers. Please give your marks.", link: `${LINK}/review/${id}` });
  }
  return ok(undefined);
}

export async function setPeriodShowReviewerMarks(ctx: Ctx, id: string, value: boolean): Promise<Result> {
  if (!can(ctx, "review:manage")) return NO_ACCESS;
  await db.update(reviewPeriod).set({ showReviewerMarks: !!value }).where(and(eq(reviewPeriod.id, id), eq(reviewPeriod.organizationId, ctx.orgId)));
  return ok(undefined);
}

export async function cancelReview(ctx: Ctx, id: string): Promise<Result> {
  const found = await loadReview(ctx, id);
  if (!found || found.role !== "hr") return NO_ACCESS;
  if (found.r.status === "completed") return fail("A completed review cannot be cancelled.");
  await db.update(review).set({ status: "cancelled" }).where(eq(review.id, id));
  return ok(undefined);
}
