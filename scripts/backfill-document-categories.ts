/**
 * Fills the categories of existing customer POs, sales orders, PRs and supplier POs that have none,
 * from the document each was made from (lib/document-category/inherit.ts): CPO ← quotation(s),
 * intercompany CPO ← the buying company's supplier PO (by name), SO ← CPO(s) / quotation(s),
 * PR ← SO / CPO, PO ← PR / SO. Documents with nothing to inherit stay empty. Runs a few passes so
 * intercompany chains fill through. DOs and invoices are left alone.
 *
 *   npx tsx scripts/backfill-document-categories.ts .env.local          # dry run (counts only)
 *   npx tsx scripts/backfill-document-categories.ts .env.local --apply
 */
import { config } from "dotenv";

const envFile = process.argv[2];
if (!envFile) throw new Error("Pass the env file (.env.local for dev, .env for prod)");
config({ path: envFile, override: true });
const apply = process.argv.includes("--apply");

async function main() {
  const { db } = await import("@/db");
  const { customerPurchaseOrder, salesOrder, purchaseRequisition, purchaseOrder } = await import("@/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const inh = await import("@/lib/document-category/inherit");

  console.log(`DB host: ${new URL(process.env.DATABASE_URL!).host}  (${apply ? "APPLY" : "dry run"})`);
  const empty = (col: unknown) => sql`${col}::text = '[]'`;
  const filled = new Map<string, Set<string>>(); // doc kind → ids filled (dry run: what would be)
  const mark = (k: string, id: string) => { const s = filled.get(k) ?? new Set(); s.add(id); filled.set(k, s); };
  const has = (k: string, id: string) => filled.get(k)?.has(id) ?? false;
  // in a dry run nothing is written, so a later stage reads its source's would-be categories from here
  const pending = new Map<string, string[]>();

  async function set(kind: "cpo" | "so" | "pr" | "po", id: string, orgId: string, from: string[]) {
    if (has(kind, id) || from.length === 0) return;
    const mine = await inh.mapCategoriesToOrg(from, orgId);
    if (mine.length === 0) return;
    mark(kind, id);
    pending.set(`${kind}:${id}`, mine);
    if (!apply) return;
    const t = { cpo: customerPurchaseOrder, so: salesOrder, pr: purchaseRequisition, po: purchaseOrder }[kind];
    await db.update(t).set({ categoryIds: mine }).where(eq(t.id, id));
  }
  const of = async (kind: string, id: string | null | undefined, read: (id: string) => Promise<string[]>) =>
    !id ? [] : pending.get(`${kind}:${id}`) ?? read(id);

  for (let pass = 1; pass <= 3; pass++) {
    // customer POs from their quotations; an intercompany one from the supplier PO it stands for
    for (const c of await db.select().from(customerPurchaseOrder).where(empty(customerPurchaseOrder.categoryIds))) {
      const [ic] = await db.select({ poId: salesOrder.sourcePurchaseOrderId }).from(salesOrder)
        .where(sql`${salesOrder.customerPoId} = ${c.id} and ${salesOrder.sourcePurchaseOrderId} is not null`).limit(1);
      const from = ic?.poId
        ? await of("po", ic.poId, (x) => inh.poCategories(x))
        : await inh.quotationCategories([c.quotationId, ...((c.quotationLinks ?? []) as { quotationId: string }[]).map((q) => q.quotationId)]);
      await set("cpo", c.id, c.organizationId, from);
    }
    for (const s of await db.select().from(salesOrder).where(empty(salesOrder.categoryIds))) {
      const cpoIds = [s.customerPoId, ...((s.customerPoLinks ?? []) as { customerPoId: string }[]).map((l) => l.customerPoId)].filter(Boolean) as string[];
      let from: string[] = [];
      for (const id of cpoIds) from = [...from, ...(await of("cpo", id, (x) => inh.cpoCategories([x])))];
      if (from.length === 0)
        from = await inh.quotationCategories([s.quotationId, ...((s.linkedQuotations ?? []) as { id: string }[]).map((q) => q.id)]);
      await set("so", s.id, s.organizationId, [...new Set(from)]);
    }
    for (const r of await db.select().from(purchaseRequisition).where(empty(purchaseRequisition.categoryIds))) {
      let from = await of("so", r.salesOrderId, (x) => inh.soCategories(x));
      if (from.length === 0) from = await of("cpo", r.customerPoId, (x) => inh.cpoCategories([x]));
      await set("pr", r.id, r.organizationId, from);
    }
    for (const p of await db.select().from(purchaseOrder).where(empty(purchaseOrder.categoryIds))) {
      let from = await of("pr", p.purchaseRequisitionId, (x) => inh.prCategories(x));
      if (from.length === 0) from = await of("so", p.salesOrderId, (x) => inh.soCategories(x));
      await set("po", p.id, p.organizationId, from);
    }
  }

  for (const k of ["cpo", "so", "pr", "po"]) console.log(`${k}: ${filled.get(k)?.size ?? 0} ${apply ? "filled" : "would be filled"}`);
  const left = await db.execute(sql`select
    (select count(*) from customer_purchase_order where category_ids::text = '[]') as cpo,
    (select count(*) from sales_order where category_ids::text = '[]') as so,
    (select count(*) from purchase_requisition where category_ids::text = '[]') as pr,
    (select count(*) from purchase_order where category_ids::text = '[]') as po`);
  console.log("still without categories (nothing to inherit from):", (left as unknown as { rows?: unknown[] }).rows?.[0] ?? left);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
