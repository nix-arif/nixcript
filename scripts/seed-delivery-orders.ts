/**
 * Seed delivery orders from existing invoices.
 *
 * DO number = invoice number with "INV" → "DO"
 *   INVAF/23-0001 → DOAF/23-0001
 *   INVSI/23-0001 → DOSI/23-0001
 *
 * Idempotent: clears existing seeded DOs first, then re-inserts.
 *
 * Run:
 *   npx dotenv-cli -e .env -- npx tsx scripts/seed-delivery-orders.ts
 */

import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { deliveryOrder, deliveryOrderItem, invoice } from "../db/schema";
import { inArray } from "drizzle-orm";
import { ALL_ORG_IDS } from "./seed-config";

function invoiceNoToDoNo(invoiceNo: string): string {
  return invoiceNo.replace(/^INV/, "DO");
}

function mapDoStatus(invoiceStatus: string): string {
  switch (invoiceStatus) {
    case "paid":
    case "sent":
    case "overdue": return "delivered";
    case "cancelled": return "returned";
    default:          return "draft";
  }
}

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);
  const db  = drizzle({ client: sql });

  // ── 1. Clear existing seeded DOs + back-links ──────────────────────────────
  console.log("Clearing existing delivery orders...");
  await sql`
    UPDATE invoice SET delivery_order_id = NULL, delivery_order_no = NULL
    WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])
  `;
  await sql`
    DELETE FROM delivery_order
    WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])
  `;
  await sql`
    DELETE FROM delivery_order_counter
    WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])
  `;
  console.log("Cleared.");

  // ── 2. Fetch all invoices ─────────────────────────────────────────────────
  const invoices = await db
    .select({
      id:               invoice.id,
      organizationId:   invoice.organizationId,
      invoiceNo:        invoice.invoiceNo,
      invoiceDate:      invoice.invoiceDate,
      status:           invoice.status,
      customerId:       invoice.customerId,
      customerSnapshot: invoice.customerSnapshot,
      customerPoNo:     invoice.customerPoNo,
      salesOrderNo:     invoice.salesOrderNo,
      caseType:         invoice.caseType,
      notes:            invoice.notes,
      createdBy:        invoice.createdBy,
    })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));

  console.log(`Invoices to seed: ${invoices.length}`);

  // ── 3. Insert DOs in batches ──────────────────────────────────────────────
  const BATCH = 50;
  let inserted = 0;

  // Track max counter per org+year for the counter table update
  const maxByOrgYear = new Map<string, Map<number, number>>();

  for (let i = 0; i < invoices.length; i += BATCH) {
    const batch = invoices.slice(i, i + BATCH);

    const doRows:   (typeof deliveryOrder.$inferInsert)[]     = [];
    const itemRows: (typeof deliveryOrderItem.$inferInsert)[] = [];
    const backfill: { invoiceId: string; doId: string; doNo: string }[] = [];

    for (const inv of batch) {
      const doId    = nanoid();
      const doNo    = invoiceNoToDoNo(inv.invoiceNo);
      const invDate = inv.invoiceDate ? new Date(inv.invoiceDate) : new Date();
      const snap    = inv.customerSnapshot as any;

      // Track counter
      const year = invDate.getFullYear();
      const seqMatch = doNo.match(/(\d{4})$/);
      if (seqMatch) {
        const num = parseInt(seqMatch[1]);
        if (!maxByOrgYear.has(inv.organizationId)) maxByOrgYear.set(inv.organizationId, new Map());
        const m = maxByOrgYear.get(inv.organizationId)!;
        m.set(year, Math.max(m.get(year) ?? 0, num));
      }

      doRows.push({
        id:               doId,
        organizationId:   inv.organizationId,
        doNo,
        salesOrderNo:     inv.salesOrderNo    ?? null,
        customerPoNo:     inv.customerPoNo    ?? null,
        customerId:       inv.customerId      ?? null,
        customerSnapshot: snap               ?? null,
        deliveredTo:      snap?.name         ?? null,
        deliveryAddress:  snap?.organizationAddress ?? null,
        deliveryDate:     invDate,
        notes:            inv.notes           ?? null,
        status:           mapDoStatus(inv.status ?? "draft"),
        createdBy:        inv.createdBy,
      });

      if (inv.caseType) {
        itemRows.push({
          id:              nanoid(),
          deliveryOrderId: doId,
          rowNo:           1,
          description:     inv.caseType,
          qty:             "1",
          uom:             null,
        });
      }

      backfill.push({ invoiceId: inv.id, doId, doNo });
    }

    await db.insert(deliveryOrder).values(doRows);
    if (itemRows.length > 0) await db.insert(deliveryOrderItem).values(itemRows);

    for (const { invoiceId, doId, doNo } of backfill) {
      await sql`
        UPDATE invoice SET delivery_order_id = ${doId}, delivery_order_no = ${doNo}
        WHERE id = ${invoiceId}
      `;
    }

    inserted += doRows.length;
    process.stdout.write(`\r  Progress: ${inserted}/${invoices.length}`);
  }

  console.log(`\n✓ Inserted ${inserted} delivery orders`);

  // ── 4. Update delivery_order_counter to highest number per org ────────────
  for (const [orgId, yearMap] of maxByOrgYear) {
    const latestYear = Math.max(...yearMap.keys());
    const latestNum  = yearMap.get(latestYear)!;
    await sql`
      INSERT INTO delivery_order_counter (id, organization_id, year, last_number, updated_at)
      VALUES (${nanoid()}, ${orgId}, ${latestYear}, ${latestNum}, now())
      ON CONFLICT (organization_id)
      DO UPDATE SET year = EXCLUDED.year, last_number = EXCLUDED.last_number, updated_at = now()
    `;
    console.log(`  Counter [${orgId.slice(0, 8)}] → year=${latestYear} lastNumber=${latestNum}`);
  }

  console.log("Done.");
}

seed().catch(console.error);
