import { db } from "@/db";
import { customerPurchaseOrder } from "@/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";

// The customer PO number is unique inside an organization, ignoring capitals and spaces around it.
// A cancelled CPO does not hold its number, so the real one can be entered again after a mistake.
export const normCpoNo = (no: string | null | undefined) => (no ?? "").trim().toLowerCase();

export type CpoNoClash = { id: string; customerPoNo: string; status: string; receivedDate: Date | null; customerName: string | null };

export async function findCpoNoClash(orgId: string, no: string, excludeId?: string): Promise<CpoNoClash | null> {
  const n = normCpoNo(no);
  if (!n) return null;
  const [hit] = await db
    .select({ id: customerPurchaseOrder.id, customerPoNo: customerPurchaseOrder.customerPoNo, status: customerPurchaseOrder.status, receivedDate: customerPurchaseOrder.receivedDate, snapshot: customerPurchaseOrder.customerSnapshot })
    .from(customerPurchaseOrder)
    .where(and(
      eq(customerPurchaseOrder.organizationId, orgId),
      sql`lower(btrim(${customerPurchaseOrder.customerPoNo})) = ${n}`,
      ne(customerPurchaseOrder.status, "cancelled"),
      excludeId ? ne(customerPurchaseOrder.id, excludeId) : undefined,
    ))
    .limit(1);
  return hit ? { id: hit.id, customerPoNo: hit.customerPoNo, status: hit.status, receivedDate: hit.receivedDate, customerName: hit.snapshot?.name ?? null } : null;
}

export function clashMessage(c: CpoNoClash): string {
  const when = c.receivedDate ? ` received ${new Date(c.receivedDate).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}` : "";
  return `Customer PO number "${c.customerPoNo}" is already used${c.customerName ? ` by ${c.customerName}` : ""}${when}. Each customer PO number must be unique.`;
}

// For a CPO the system makes itself (from a sibling's PO): the number, or the number with -2, -3 … if it is taken
export async function uniqueCpoNoFor(orgId: string, desired: string): Promise<string> {
  let candidate = desired;
  for (let i = 2; i < 100 && (await findCpoNoClash(orgId, candidate)); i++) candidate = `${desired}-${i}`;
  return candidate;
}
