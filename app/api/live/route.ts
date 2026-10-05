import { headers } from "next/headers";
import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { changeCounter } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getOrgGroupIds } from "@/lib/document-number-group";

// "Has anything changed?" for open pages (components/live-refresh.tsx).
// Returns one number per requested area — the sum of the change counters of
// every company in the signed-in user's group (sister companies included, so
// consigned stock and cross-company lists update too). Kept tiny on purpose:
// one indexed read of a few rows.
export const dynamic = "force-dynamic";

const SCOPES = new Set(["quotation", "sales", "delivery", "invoice", "inventory", "consignment", "purchase", "customer", "supplier", "hr"]);

// Company group per company, briefly remembered — it rarely changes and saves two reads per check
const groupCache = new Map<string, { ids: string[]; at: number }>();
async function groupOf(orgId: string) {
  const hit = groupCache.get(orgId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ids;
  const ids = await getOrgGroupIds(orgId);
  groupCache.set(orgId, { ids, at: Date.now() });
  return ids;
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const orgId = session?.session?.activeOrganizationId;
  if (!session || !orgId) return new Response(null, { status: 401 });
  const scopes = (new URL(req.url).searchParams.get("scopes") ?? "").split(",").filter((s) => SCOPES.has(s));
  if (!scopes.length) return Response.json({ org: orgId, v: {} }, { headers: { "Cache-Control": "private, no-store" } });
  const rows = await db
    .select({ scope: changeCounter.scope, v: sql<string>`sum(${changeCounter.version})` })
    .from(changeCounter)
    .where(and(inArray(changeCounter.organizationId, await groupOf(orgId)), inArray(changeCounter.scope, scopes)))
    .groupBy(changeCounter.scope);
  const v = Object.fromEntries(scopes.map((s) => [s, Number(rows.find((r) => r.scope === s)?.v ?? 0)]));
  // org is part of the answer: switching company must count as a change
  return Response.json({ org: orgId, v }, { headers: { "Cache-Control": "private, no-store" } });
}
