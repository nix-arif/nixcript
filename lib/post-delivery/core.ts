// Problems found after delivery and supplier claims: the plain rules (kinds of problem, statuses, deadlines).
// No database, safe for client code.

// ── kinds of problem ("situations") ─────────────────────────────────────────
export const SITUATIONS = {
  defective_on_arrival: { label: "Defective on arrival", hint: "Did not work or was faulty when the customer first opened or used it" },
  failed_in_use: { label: "Failed in use", hint: "Worked at first, then broke or stopped performing during use" },
  wrong_item: { label: "Wrong item supplied", hint: "Not the product, size, model or quantity that was ordered" },
  damaged_in_transit: { label: "Damaged in transit", hint: "Packaging or product damaged on the way" },
  missing_parts: { label: "Missing parts or accessories", hint: "Part of the set, an accessory or a manual is missing" },
  expiry_issue: { label: "Expired or short expiry", hint: "Expired, or too close to expiry for what was agreed" },
  sterility_packaging: { label: "Sterility or packaging problem", hint: "Seal broken, wet pack, sterility indicator failed" },
  documentation: { label: "Documents or labelling", hint: "Missing certificate, wrong label, wrong lot information" },
  other: { label: "Other", hint: "Anything else" },
} as const;
export type Situation = keyof typeof SITUATIONS;
export const SITUATION_KEYS = Object.keys(SITUATIONS) as Situation[];
export const isSituation = (v: unknown): v is Situation => typeof v === "string" && v in SITUATIONS;
export const situationLabel = (k: string) => (isSituation(k) ? SITUATIONS[k].label : k);

export const SEVERITIES = { normal: "Normal", high: "High", urgent: "Urgent" } as const;
export type Severity = keyof typeof SEVERITIES;
export const isSeverity = (v: unknown): v is Severity => typeof v === "string" && v in SEVERITIES;

export const CHANNELS = { phone: "Phone call", email: "Email", whatsapp: "WhatsApp", visit: "Visit", other: "Other" } as const;
export type Channel = keyof typeof CHANNELS;
export const isChannel = (v: unknown): v is Channel => typeof v === "string" && v in CHANNELS;

// ── customer issue ──────────────────────────────────────────────────────────
export const ISSUE_STATUS = {
  open: "Open",
  investigating: "Investigating",
  claim_raised: "Claim raised",
  resolved: "Resolved",
  closed_no_claim: "Closed, no claim",
  cancelled: "Cancelled",
} as const;
export type IssueStatus = keyof typeof ISSUE_STATUS;
export const isIssueStatus = (v: unknown): v is IssueStatus => typeof v === "string" && v in ISSUE_STATUS;
// an issue that is still being worked on
export const ISSUE_LIVE: IssueStatus[] = ["open", "investigating", "claim_raised"];

export const CUSTOMER_RESOLUTIONS = { replacement: "Replacement sent", credit: "Credit note", repair: "Repaired", refund: "Refund", none: "Nothing owed to the customer" } as const;
export type CustomerResolution = keyof typeof CUSTOMER_RESOLUTIONS;
export const isCustomerResolution = (v: unknown): v is CustomerResolution => typeof v === "string" && v in CUSTOMER_RESOLUTIONS;

// where each affected unit physically is
export const UNIT_STATUS = {
  with_customer: "With the customer",
  returned_to_us: "Returned to us",
  quarantine: "In quarantine (under review)",
  sent_to_supplier: "Sent back to the supplier",
  replaced: "Replaced",
  credited: "Credited",
  repaired: "Repaired",
  scrapped: "Scrapped",
} as const;
export type UnitStatus = keyof typeof UNIT_STATUS;
export const isUnitStatus = (v: unknown): v is UnitStatus => typeof v === "string" && v in UNIT_STATUS;

// ── supplier claim ──────────────────────────────────────────────────────────
export const CLAIM_STATUS = {
  draft: "Draft",
  sent: "Sent, waiting for the supplier",
  accepted: "Accepted",
  partial: "Partly accepted",
  rejected: "Rejected",
  closed: "Closed",
  withdrawn: "Withdrawn",
} as const;
export type ClaimStatus = keyof typeof CLAIM_STATUS;
export const isClaimStatus = (v: unknown): v is ClaimStatus => typeof v === "string" && v in CLAIM_STATUS;
// a claim that still holds its items (an item can only be in one of these at a time)
export const CLAIM_LIVE: ClaimStatus[] = ["draft", "sent", "accepted", "partial"];

export const CLAIM_OUTCOMES = { replacement: "Replacement", credit_note: "Credit note", repair: "Repair", refund: "Refund", goodwill: "Goodwill (no replacement)", rejected: "Rejected" } as const;
export type ClaimOutcome = keyof typeof CLAIM_OUTCOMES;
export const isClaimOutcome = (v: unknown): v is ClaimOutcome => typeof v === "string" && v in CLAIM_OUTCOMES;

export const SENT_VIA = { email: "Email", whatsapp: "WhatsApp", portal: "Supplier portal", phone: "Phone", courier: "With the goods", other: "Other" } as const;
export type SentVia = keyof typeof SENT_VIA;
export const isSentVia = (v: unknown): v is SentVia => typeof v === "string" && v in SENT_VIA;

// ── dates (plain "YYYY-MM-DD" strings; the business runs on Malaysia time) ──
export const isDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  // a date like 2026-02-30 is rolled over by the parser, so it must come back unchanged
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};
export const todayKL = (now: Date = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// whole days from a to b (negative when b is before a)
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ── supplier terms and the claim deadline ───────────────────────────────────
// How long a supplier accepts a claim, and counted from which date:
//   receipt  = the day we received the goods from the supplier
//   delivery = the day we delivered them to our customer
export const BASES = { receipt: "Date we received it from the supplier", delivery: "Date we delivered it to the customer" } as const;
export type Basis = keyof typeof BASES;
export const isBasis = (v: unknown): v is Basis => typeof v === "string" && v in BASES;

export type Term = { situation: string; windowDays: number; basis: Basis; notes?: string | null };

// the term for this kind of problem if the supplier has one of its own, else the supplier's general term
export function pickTerm(terms: Term[], situation: string): Term | null {
  return terms.find((t) => t.situation === situation) ?? terms.find((t) => t.situation === "") ?? null;
}

export type DeadlineResult = {
  term: Term | null;
  basis: Basis | null;
  basisDate: string | null; // the date the days are counted from
  windowDays: number | null;
  deadline: string | null;
  // why there is no deadline, in words
  problem: string | null;
};

// receivedDates: when we received each claimed unit from the supplier (the earliest counts: it is the tightest);
// deliveredAt: when the goods were delivered to the customer
export function computeDeadline(terms: Term[], situation: string, dates: { receivedDates: (string | null | undefined)[]; deliveredAt: string | null | undefined }): DeadlineResult {
  const term = pickTerm(terms, situation);
  if (!term) return { term: null, basis: null, basisDate: null, windowDays: null, deadline: null, problem: "This supplier has no claim terms recorded, so there is no deadline. Add them under Claim Terms." };
  let basisDate: string | null = null;
  if (term.basis === "receipt") {
    const known = dates.receivedDates.filter(isDay).sort();
    basisDate = known[0] ?? null;
  } else {
    basisDate = isDay(dates.deliveredAt) ? dates.deliveredAt : null;
  }
  if (!basisDate) {
    return { term, basis: term.basis, basisDate: null, windowDays: term.windowDays, deadline: null, problem: term.basis === "receipt"
      ? "The terms count from the date we received the goods, and that date is not filled in. Enter it on the item to get the deadline."
      : "The terms count from the delivery date to the customer, and it is not filled in. Enter it on the issue to get the deadline." };
  }
  return { term, basis: term.basis, basisDate, windowDays: term.windowDays, deadline: addDays(basisDate, term.windowDays), problem: null };
}

export type Clock = { daysLeft: number | null; state: "none" | "ok" | "soon" | "late" };
export const SOON_DAYS = 7;
// where a claim stands against its deadline today ("late" once the last day has passed)
export function clockOf(deadline: string | null | undefined, today: string): Clock {
  if (!isDay(deadline)) return { daysLeft: null, state: "none" };
  const daysLeft = daysBetween(today, deadline);
  return { daysLeft, state: daysLeft < 0 ? "late" : daysLeft <= SOON_DAYS ? "soon" : "ok" };
}
export function clockText(c: Clock): string {
  if (c.daysLeft == null) return "No deadline";
  if (c.daysLeft < 0) return `${-c.daysLeft} day${c.daysLeft === -1 ? "" : "s"} past the deadline`;
  if (c.daysLeft === 0) return "Last day today";
  return `${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left`;
}
// 0 = nothing to say, 1 = deadline within a week, 2 = within 2 days or already past
export function reminderLevel(c: Clock): 0 | 1 | 2 {
  if (c.daysLeft == null) return 0;
  if (c.daysLeft <= 2) return 2;
  return c.daysLeft <= SOON_DAYS ? 1 : 0;
}

// ── moving between statuses ─────────────────────────────────────────────────
// which statuses an issue may be moved to by hand (claims move it to "claim_raised" on their own)
export const ISSUE_MOVES: Record<IssueStatus, IssueStatus[]> = {
  open: ["investigating", "closed_no_claim", "resolved", "cancelled"],
  investigating: ["open", "closed_no_claim", "resolved", "cancelled"],
  claim_raised: ["resolved", "cancelled"],
  resolved: ["investigating"],
  closed_no_claim: ["investigating"],
  cancelled: ["open"],
};
export const canMoveIssue = (from: string, to: string) => isIssueStatus(from) && ISSUE_MOVES[from].includes(to as IssueStatus);

// ── the text people paste into an email or WhatsApp ─────────────────────────
export function claimMessage(c: {
  claimNo: string; supplierName: string; companyName: string; situation: string; summary: string; description?: string | null;
  deliveredAt?: string | null; reportedAt: string; deadline?: string | null;
  items: { productCode: string | null; description: string | null; qty: string; lotNo?: string | null; poNo?: string | null; grNo?: string | null; supplierDocRef?: string | null }[];
  request: string;
}): string {
  const fmt = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "");
  const lines = [
    `Dear ${c.supplierName},`,
    "",
    `Claim ${c.claimNo} from ${c.companyName}: ${situationLabel(c.situation)}.`,
    c.summary,
    c.description ? c.description : "",
    "",
    "Items:",
    ...c.items.map((i, n) => `${n + 1}. ${[i.productCode, i.description].filter(Boolean).join(" - ")} x ${i.qty}`
      + [i.lotNo && `lot ${i.lotNo}`, i.poNo && `PO ${i.poNo}`, i.grNo && `GR ${i.grNo}`, i.supplierDocRef && `your ref ${i.supplierDocRef}`].filter(Boolean).map((x) => `, ${x}`).join("")),
    "",
    c.deliveredAt ? `Delivered to the end user on ${fmt(c.deliveredAt)}; the problem was reported on ${fmt(c.reportedAt)}.` : `The problem was reported on ${fmt(c.reportedAt)}.`,
    `We ask for: ${c.request}.`,
    c.deadline ? `Your terms allow claims until ${fmt(c.deadline)}.` : "",
    "Photos and the full report are attached.",
    "",
    "Please confirm receipt and your claim reference.",
    "",
    `Thank you,\n${c.companyName}`,
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
