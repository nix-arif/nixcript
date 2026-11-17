// Performance review: the plain rules (scoring, statuses, what is missing). No database, safe for client code.

export type ReviewStatus = "self" | "manager" | "signoff" | "completed" | "cancelled";

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  self: "Waiting for self-assessment",
  manager: "Waiting for manager review",
  signoff: "Waiting for HR sign-off",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type Criterion = { id: string; section: string; name: string; description: string; weight: number };

export const RATING_WORDS: Record<number, string[]> = {
  3: ["Below expectations", "Meets expectations", "Exceeds expectations"],
  4: ["Poor", "Fair", "Good", "Excellent"],
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

// the criteria that still have no rating
export const missingRatings = (criteria: Criterion[], ratings: Record<string, number | null | undefined>) =>
  criteria.filter((c) => ratings[c.id] == null);

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
