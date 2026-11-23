// Performance review: the plain rules (scoring, statuses, what is missing). No database, safe for client code.

export type ReviewStatus = "self" | "manager" | "signoff" | "completed" | "cancelled";

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  self: "Waiting for self-assessment",
  manager: "Waiting for manager review",
  signoff: "Waiting for HR sign-off",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Template names are unique within a company, ignoring case and extra spaces ("Annual  Review" = "annual review").
// The same name may be used by another of the owner's companies: templates are always shown grouped by company.
export const templateNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

// The first of "name", "name (copy)", "name (copy 2)" ... that is not taken yet
export function freeTemplateName(name: string, taken: string[]): string {
  const used = new Set(taken.map(templateNameKey));
  if (!used.has(templateNameKey(name))) return name;
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `${name} (copy)` : `${name} (copy ${i})`;
    if (!used.has(templateNameKey(candidate))) return candidate;
  }
}

export type Criterion ={ id: string; section: string; name: string; description: string; weight: number };

// The written parts of the company's review form (F-HR05)
export type ReviewQuestion = { id: string; label: string; help: string };
export type PreviousGoal = { goal: string; action: string; completed: "Y" | "N" | ""; comments: string };
export type ActionPlanRow = { goal: string; action: string; targetDate: string };

export const PURPOSES = { annual: "Annual Review", confirmation: "Confirmation" } as const;
export type ReviewPurpose = keyof typeof PURPOSES;
export const OUTCOMES = { satisfactory: "Satisfactory", unsatisfactory: "Unsatisfactory", extension: "Extension of probation" } as const;
export type ReviewOutcome = keyof typeof OUTCOMES;
export const isPurpose = (v: unknown): v is ReviewPurpose => typeof v === "string" && v in PURPOSES;
export const isOutcome = (v: unknown): v is ReviewOutcome => typeof v === "string" && v in OUTCOMES;

export const RATING_WORDS: Record<number, string[]> = {
  3: ["Below expectations", "Meets expectations", "Exceeds expectations"],
  4: ["Does not meet expectation", "Meets expectation", "Exceeds expectation", "Outstanding"], // as on form F-HR05
  5: ["Poor", "Needs improvement", "Meets expectations", "Exceeds expectations", "Outstanding"],
  10: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
};

export const ratingWord = (rating: number | null | undefined, scaleMax: number) =>
  rating ? (RATING_WORDS[scaleMax]?.[rating - 1] ?? String(rating)) : "";

export const isValidRating = (r: unknown, scaleMax: number): r is number => Number.isInteger(r) && (r as number) >= 1 && (r as number) <= scaleMax;

// Weighted average of the ratings that were given (a criterion with no rating is left out), out of scaleMax; null if none
export function weightedScore(criteria: Criterion[], ratings: Record<string, number | null | undefined>): number | null {
  let sum = 0;
  let weights = 0;
  for (const c of criteria) {
    const r = ratings[c.id];
    if (r == null) continue;
    sum += r * c.weight;
    weights += c.weight;
  }
  return weights > 0 ? Math.round((sum / weights) * 100) / 100 : null;
}

// The final score with more than one reviewer: each reviewer's own (criterion-weighted) score, combined by their share.
// A reviewer with no score at all (everything N/A) is left out; null if nobody has a score.
export function combineScores(parts: { score: number | null; weight: number }[]): number | null {
  let sum = 0;
  let weights = 0;
  for (const p of parts) {
    if (p.score == null || !(p.weight > 0)) continue;
    sum += p.score * p.weight;
    weights += p.weight;
  }
  return weights > 0 ? Math.round((sum / weights) * 100) / 100 : null;
}

// a reviewer's share in percent, of the weights given (70 and 30 -> 70%, 30%; 100 and 100 -> 50%, 50%)
export const sharePercent = (weight: number, all: number[]) => {
  const total = all.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  return total > 0 ? Math.round((weight / total) * 100) : 0;
};
export const isValidWeight = (w: unknown): w is number => Number.isInteger(w) && (w as number) >= 1 && (w as number) <= 100;

// the criteria that still have no rating. One marked "not applicable" is answered, and is left out of the score.
export const missingRatings = (criteria: Criterion[], ratings: Record<string, number | null | undefined>, notApplicable: Record<string, boolean | undefined> = {}) =>
  criteria.filter((c) => ratings[c.id] == null && !notApplicable[c.id]);

// Which view of a review someone gets, and what they may do, by their relation to it and its status
export type ReviewRole = "employee" | "reviewer" | "hr";

export function canEditNow(role: ReviewRole, status: ReviewStatus): boolean {
  if (role === "employee") return status === "self";
  if (role === "reviewer") return status === "manager";
  return false; // HR signs off or sends back; HR does not rewrite the ratings
}

// The manager's ratings stay hidden from the employee until the review is completed
export const managerSideVisible = (role: ReviewRole, status: ReviewStatus) => role !== "employee" || status === "completed";
// The self-assessment is visible to the manager only after the employee has submitted it
export const selfSideVisible = (role: ReviewRole, status: ReviewStatus) => role !== "reviewer" || status !== "self";

export const formatScore = (n: number | string | null | undefined, scaleMax: number) =>
  n == null || n === "" ? "—" : `${Number(n).toFixed(2)} / ${scaleMax}`;
