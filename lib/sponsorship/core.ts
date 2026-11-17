// Sponsorship: the plain rules. No database, safe for client code.

export type SponsorshipStatus = "DRAFT" | "PENDING" | "CHECKED" | "APPROVED" | "REJECTED" | "CANCELLED" | "CLOSED";

export const STATUS_LABEL: Record<SponsorshipStatus, string> = {
  DRAFT: "Draft", PENDING: "Waiting for check", CHECKED: "Waiting for approval", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled", CLOSED: "Closed",
};

export const RECIPIENT_TYPES = [
  { value: "doctor", label: "Doctor / healthcare professional" },
  { value: "hospital", label: "Hospital / clinic" },
  { value: "association", label: "Association / society" },
  { value: "event", label: "Event organizer" },
  { value: "other", label: "Other" },
] as const;

export const ITEM_CATEGORIES = [
  { value: "registration", label: "Registration fee" },
  { value: "travel", label: "Travel / airfare" },
  { value: "accommodation", label: "Accommodation" },
  { value: "meals", label: "Meals" },
  { value: "product", label: "Product / equipment support" },
  { value: "honorarium", label: "Honorarium / speaker fee" },
  { value: "other", label: "Other" },
] as const;

export const DOCUMENT_KINDS = [
  { value: "invitation", label: "Invitation / request letter" },
  { value: "quotation", label: "Quotation / invoice" },
  { value: "approval-letter", label: "Institution's approval letter" },
  { value: "receipt", label: "Receipt / proof of spend" },
  { value: "other", label: "Other" },
] as const;

// What the requester confirms. A company policy may word this differently; check it with whoever owns your compliance.
export const DECLARATION =
  "I confirm that this sponsorship is not given to induce, reward or influence the purchase, prescription, use or recommendation of the company's products, and that it follows the company's code of conduct and the rules that apply to the recipient and the event.";

export const money = (v: string | number | null | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
export const fmtRM = (v: string | number | null | undefined) => `RM ${money(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const sumAmounts = (rows: { amount?: string | number | null }[]) => Math.round(rows.reduce((s, r) => s + money(r.amount), 0) * 100) / 100;

// A request can be edited by its requester while it is a draft or was rejected (then resubmitted)
export const isEditable = (s: SponsorshipStatus) => s === "DRAFT" || s === "REJECTED";
export const isOpen = (s: SponsorshipStatus) => s === "PENDING" || s === "CHECKED";

export function sponsorshipNo(year: number, seq: number) {
  return `SP-${year}-${String(seq).padStart(4, "0")}`;
}
