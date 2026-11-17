// A CPO line's description comes straight from the quotation, and can differ from the description in the product
// database (the code is the reference). When it does, the user must say whether that is intended. Once accepted the
// description goes to the sales order as written; it can still be changed there, and the newest description is the one
// that carries on to the purchase requisition and the supplier PO.
import { sameText } from "@/lib/sales-order/db-description";

export type DescriptionState = "unknown" | "same" | "differs" | "accepted";

type Line = { productCode?: string; description?: string; descAccepted?: boolean };

// db: product code (lowercase) -> description in the product database
export function descriptionState(line: Line, db: Map<string, string>): { state: DescriptionState; dbText: string | null } {
  const code = (line.productCode ?? "").trim().toLowerCase();
  const dbText = code ? (db.get(code)?.trim() || null) : null;
  if (!dbText || !(line.description ?? "").trim()) return { state: "unknown", dbText };
  if (sameText(line.description, dbText)) return { state: "same", dbText };
  return { state: line.descAccepted ? "accepted" : "differs", dbText };
}

// The ticked lines whose description differs from the database and nobody has decided about yet
export function unresolvedDifferences<T extends Line & { _key: string; included?: boolean }>(items: T[], db: Map<string, string>): T[] {
  return items.filter((i) => i.included !== false && descriptionState(i, db).state === "differs");
}

export function unresolvedMessage(n: number): string {
  return `${n} item${n === 1 ? " has a" : "s have"} description${n === 1 ? "" : "s"} that differ${n === 1 ? "s" : ""} from the product database (shown in red). For each one, say whether it is intended: keep it, or use the database description.`;
}

export const ACCEPTED_NOTE = "Accepted as intended. This description will be carried to the sales order as written. If it is changed there (for example back to the database description), the newest description is the one that goes on to the purchase requisition and the supplier PO.";

// ── the three answers on a line ────────────────────────────────────────────
// A line as the pages hold it. `prevDescription` is the description the user replaced with the database one, kept so
// they can go back to it (also after saving and opening the CPO again).
type DescLine = {
  description?: string;
  descAccepted?: boolean;
  descAcceptedBy?: string;
  prevDescription?: string;
  _descriptionSource?: ("quote" | "catalog" | "user")[] | null;
};

// "Yes, keep this description"
export function keepDescription<T extends DescLine>(line: T, by?: string): T {
  return { ...line, descAccepted: true, descAcceptedBy: by || undefined };
}

// "No, use the database description": the current text is remembered, so it can be brought back
export function takeDatabaseText<T extends DescLine>(line: T, dbText: string | null): T {
  if (!dbText) return line;
  return { ...line, prevDescription: line.description && !sameText(line.description, dbText) ? line.description : line.prevDescription, description: dbText, descAccepted: false, descAcceptedBy: undefined, _descriptionSource: ["catalog"] };
}

// Go back to the description that was there before the database one was taken. Choosing it again is the user's decision:
// it counts as accepted, and the line shows the note about what that means.
export function restorePreviousDescription<T extends DescLine>(line: T, by?: string): T {
  if (!line.prevDescription) return line;
  return { ...line, description: line.prevDescription, prevDescription: undefined, descAccepted: true, descAcceptedBy: by || undefined, _descriptionSource: ["quote"] };
}

// There is something to go back to: the database text is in use and an earlier description is remembered
export const canRestorePrevious = (line: DescLine & { productCode?: string }, db: Map<string, string>) =>
  !!line.prevDescription && descriptionState(line, db).state === "same" && !sameText(line.prevDescription, line.description);
