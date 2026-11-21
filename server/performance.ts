"use server";

// Performance review actions. The rules are in lib/performance/service.ts; this adds the signed-in user.
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import * as S from "@/lib/performance/service";

export type { Result, TemplateInput, PeriodInput, AnswerInput, EligibleEmployee, ReviewView, ReviewListRow, PeriodSummary, PeriodDetail, TemplateWithCriteria } from "@/lib/performance/service";

async function ctx(): Promise<S.Ctx> {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { orgId, userId: session.user.id, perms: await getUserPermissions(session.user.id, orgId) };
}

export async function getMyReviews() { return S.listMyReviews(await ctx()); }
export async function getTeamReviews() { return S.listTeamReviews(await ctx()); }
export async function getReviewView(id: string) { return S.getReview(await ctx(), id); }
export async function saveSelfReview(id: string, input: Parameters<typeof S.saveSelf>[2]) { return S.saveSelf(await ctx(), id, input); }
export async function saveManagerReview(id: string, input: Parameters<typeof S.saveManager>[2]) { return S.saveManager(await ctx(), id, input); }
export async function acknowledgeReview(id: string) { return S.acknowledgeReview(await ctx(), id); }
export async function signOffReview(id: string, comment?: string) { return S.signOff(await ctx(), id, comment); }
export async function returnReviewToManager(id: string, note: string) { return S.returnToManager(await ctx(), id, note); }
export async function reassignReviewer(id: string, reviewerUserId: string) { return S.reassignReviewer(await ctx(), id, reviewerUserId); }
export async function cancelReview(id: string) { return S.cancelReview(await ctx(), id); }

export async function getReviewTemplates() { return S.listTemplates(await ctx()); }
export async function saveReviewTemplate(input: S.TemplateInput) { return S.saveTemplate(await ctx(), input); }
export async function setReviewTemplateActive(id: string, isActive: boolean) { return S.setTemplateActive(await ctx(), id, isActive); }
export async function deleteReviewTemplate(id: string) { return S.deleteTemplate(await ctx(), id); }

export async function getEligibleEmployees() { return S.listEligibleEmployees(await ctx()); }
export async function createReviewPeriod(input: S.PeriodInput) { return S.createPeriod(await ctx(), input); }
export async function addReviewsToPeriod(periodId: string, employees: S.PeriodInput["employees"]) { return S.addReviews(await ctx(), periodId, employees); }
export async function getReviewPeriods() { return S.listPeriods(await ctx()); }
export async function getReviewPeriod(id: string) { return S.getPeriod(await ctx(), id); }
export async function remindReviewPeriod(id: string) { return S.remindPeriod(await ctx(), id); }
export async function setReviewPeriodStatus(id: string, status: "open" | "closed") { return S.setPeriodStatus(await ctx(), id, status); }
