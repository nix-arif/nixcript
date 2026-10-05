import { db } from "@/db";
import { documentNumberingSetting, invoice, organization } from "@/db/schema";
import { and, eq, inArray, like } from "drizzle-orm";
import { buildDocumentNo, DOC_TYPE_DEFAULTS, type DocType, type NumberingConfig } from "@/lib/document-numbering";
import { getOrgGroupIds, isDocNoTakenInGroup, nextFreeDocNo } from "@/lib/document-number-group";

// Invoice numbers follow the DO they bill: DOSI/26-0478 → INVSI/26-0478, and a
// re-issue (the first one cancelled) → INVSI/26-0478.2. Invoices with no DO
// (consignment settlements, standalone invoices) have their own "C" series —
// INVSI/26-C0001 — so they can never take a number a DO will need. A DO that
// is cancelled or fully returned is never invoiced; its number is simply
// absent from the invoice series, and the cancelled DO explains why.

const INV_NUMBERED = { table: invoice, id: invoice.id, organizationId: invoice.organizationId, number: invoice.invoiceNo };

/**
 * Same rules as server/document-numbering.ts#getNumberingConfig, without its
 * session check — settlement also runs from the monthly scheduler, where
 * there is no signed-in user.
 */
export async function numberingConfig(orgId: string, docType: DocType): Promise<NumberingConfig & { documentType: DocType }> {
  const [row] = await db.select().from(documentNumberingSetting)
    .where(and(eq(documentNumberingSetting.organizationId, orgId), eq(documentNumberingSetting.documentType, docType))).limit(1);
  if (row) {
    return { documentType: docType, prefix: row.prefix, docCode: row.docCode, separator: row.separator, includeYear: row.includeYear, paddingLength: row.paddingLength, numberFormat: row.numberFormat ?? "standard" };
  }
  const [org] = await db.select({ slug: organization.slug }).from(organization).where(eq(organization.id, orgId));
  return { documentType: docType, prefix: (org?.slug ?? "ORG").toUpperCase(), docCode: DOC_TYPE_DEFAULTS[docType]?.docCode ?? docType.toUpperCase(), separator: "-", includeYear: 1, paddingLength: 4, numberFormat: "standard" };
}

/** The document code part in front of the year/counter: "DOSI" (compact) or "DO-SI-" (standard). */
function codeHead(cfg: NumberingConfig): string {
  if (cfg.numberFormat === "compact") return cfg.docCode + (cfg.prefix ?? "");
  const sep = cfg.separator || "-";
  return cfg.docCode + sep + (cfg.prefix ? cfg.prefix + sep : "");
}

/** First of `base`, `base.2`, `base.3` … (or the next suffix if `base` already has one) that is free in the group. */
async function firstFree(orgId: string, base: string): Promise<string> {
  if (!(await isDocNoTakenInGroup(INV_NUMBERED, orgId, base))) return base;
  const m = /^(.*)\.(\d+)$/.exec(base);
  const stem = m ? m[1] : base;
  for (let n = m ? Number(m[2]) + 1 : 2; n < 100; n++) {
    const docNo = `${stem}.${n}`;
    if (!(await isDocNoTakenInGroup(INV_NUMBERED, orgId, docNo))) return docNo;
  }
  throw new Error(`Could not find a free invoice number for ${base}`);
}

/** The invoice number for a DO: its own number with the invoice code — or the "C" series if the DO number doesn't follow the DO numbering. */
export async function invoiceNoForDo(invoiceOrgId: string, doOrgId: string, doNo: string): Promise<string> {
  const [doCfg, invCfg] = await Promise.all([numberingConfig(doOrgId, "do"), numberingConfig(invoiceOrgId, "inv")]);
  const head = codeHead(doCfg);
  const rest = doNo.startsWith(head) ? doNo.slice(head.length) : null;
  // compact "DOSI" must be followed by its "/" or "-", not by more letters
  if (rest === null || !rest || /^[A-Za-z]/.test(rest)) return standaloneInvoiceNo(invoiceOrgId);
  // Laid out like the DO (so the two always line up), with the invoice's code
  return firstFree(invoiceOrgId, codeHead({ ...doCfg, docCode: invCfg.docCode, prefix: invCfg.prefix }) + rest);
}

/** Next number in the invoice "C" series for invoices with no DO: INVSI/26-C0001. */
export async function standaloneInvoiceNo(orgId: string): Promise<string> {
  const cfg = await numberingConfig(orgId, "inv");
  const year = new Date().getFullYear();
  const pad = (n: number) => String(n).padStart(cfg.paddingLength, "0");
  const lead = buildDocumentNo(cfg, year, 0).slice(0, -pad(0).length) + "C";
  const format = (n: number) => lead + pad(n);
  const used = await db.select({ no: invoice.invoiceNo }).from(invoice)
    .where(and(inArray(invoice.organizationId, await getOrgGroupIds(orgId)), like(invoice.invoiceNo, `${lead}%`)));
  const last = used.reduce((mx, r) => Math.max(mx, Number(/^\d+$/.exec(r.no.slice(lead.length))?.[0] ?? 0)), 0);
  return (await nextFreeDocNo(INV_NUMBERED, orgId, last + 1, format)).docNo;
}
