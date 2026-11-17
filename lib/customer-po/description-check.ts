// A CPO line's description comes straight from the quotation, and can differ from the description in the product
// database (the code is the reference). When it does, the user must say whether that is intended. Once accepted the
// description stays as written through the whole transaction (sales order, purchase requisition, supplier PO).
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

export const ACCEPTED_NOTE = "Accepted as intended. This description will stay as written until the end of the transaction: the sales order, purchase requisition and supplier PO will all carry it.";
