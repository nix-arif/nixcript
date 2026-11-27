"use client";

// Every version of an amended customer PO, sales order or supplier PO (Rev 0 … current), read-only:
// pick one, compare it with another (changes highlighted), open the customer's document it had,
// or print that version (SO / supplier PO).

import { useEffect, useMemo, useState } from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getDocumentVersions, type DocVersion } from "@/server/amendment";
import type { DocType } from "@/lib/amendment/customer-po";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => parseFloat(str(v)) || 0;
const money = (v: unknown) => (str(v) === "" ? "—" : `RM ${num(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const date = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? str(v) : d.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
};
const text = (v: unknown) => str(v).trim() || "—";
const docName = (key: unknown) => str(key).split("/").pop()?.replace(/^[A-Za-z0-9_-]{21}-/, "") || "document";

// the header fields shown for each kind of document
const FIELDS: Record<DocType, { key: string; label: string; show: (d: Row) => string }[]> = {
  cpo: [
    { key: "customerPoNo", label: "PO number", show: (d) => text(d.customerPoNo) },
    { key: "amount", label: "Amount", show: (d) => money(d.amount) },
    { key: "discount", label: "Overall discount", show: (d) => (num(d.overallDiscountPct) > 0 ? `${str(d.overallDiscountPct)}%` : num(d.overallDiscountAmt) > 0 ? money(d.overallDiscountAmt) : "—") },
    { key: "receivedDate", label: "Received", show: (d) => date(d.receivedDate) },
    { key: "deliveryDate", label: "Delivery date", show: (d) => date(d.deliveryDate) },
    { key: "deliveryAddress", label: "Delivery address", show: (d) => text(d.deliveryAddress) },
    { key: "salesPersonName", label: "Sales person", show: (d) => text(d.salesPersonName) },
    { key: "notes", label: "Notes", show: (d) => text(d.notes) },
    { key: "documentKey", label: "Customer's PO document", show: (d) => (d.documentKey ? docName(d.documentKey) : "—") },
  ],
  so: [
    { key: "soNo", label: "SO number", show: (d) => text(d.soNo) },
    { key: "status", label: "Status", show: (d) => text(d.status) },
    { key: "subtotal", label: "Subtotal", show: (d) => money(d.subtotal) },
    { key: "overallDiscountAmt", label: "Overall discount", show: (d) => money(d.overallDiscountAmt) },
    { key: "sst", label: "SST", show: (d) => money(d.sst) },
    { key: "grandTotal", label: "Grand total", show: (d) => money(d.grandTotal) },
    { key: "deliveryDate", label: "Delivery date", show: (d) => date(d.deliveryDate) },
    { key: "deliveryAddress", label: "Delivery address", show: (d) => text(d.deliveryAddress) },
    { key: "salesPersonName", label: "Sales person", show: (d) => text(d.salesPersonName) },
    { key: "notes", label: "Notes", show: (d) => text(d.notes) },
  ],
  po: [
    { key: "poNo", label: "PO number", show: (d) => text(d.poNo) },
    { key: "supplier", label: "Supplier", show: (d) => text((d.supplierSnapshot as { name?: string } | null)?.name) },
    { key: "subtotal", label: "Subtotal", show: (d) => money(d.subtotal) },
    { key: "sst", label: "SST", show: (d) => money(d.sst) },
    { key: "grandTotal", label: "Grand total", show: (d) => money(d.grandTotal) },
    { key: "expectedDeliveryDate", label: "Expected delivery", show: (d) => date(d.expectedDeliveryDate) },
    { key: "deliveryAddress", label: "Delivery address", show: (d) => text(d.deliveryAddress) },
    { key: "notes", label: "Notes", show: (d) => text(d.notes) },
  ],
};

const lineKey = (l: Row) => str(l.productCode).trim().toLowerCase() || `d:${str(l.description).trim().toLowerCase()}`;
const sets = (l: Row) => (l.setGroupId && num(l.setQty) > 1 ? ` × ${num(l.setQty)} sets` : "");

// the lines of two versions side by side: matched by product code (or description), in order
function pairLines(a: Row[], b: Row[]) {
  const queue = new Map<string, Row[]>();
  for (const l of b) queue.set(lineKey(l), [...(queue.get(lineKey(l)) ?? []), l]);
  const pairs: { a: Row | null; b: Row | null }[] = a.map((l) => ({ a: l, b: queue.get(lineKey(l))?.shift() ?? null }));
  for (const rest of queue.values()) for (const l of rest) pairs.push({ a: null, b: l });
  return pairs;
}

function Cell({ a, b, compare }: { a: string; b: string; compare: boolean }) {
  const changed = compare && a !== b;
  return (
    <td className={cn("py-1 pr-2 align-top tabular-nums", changed && "bg-amber-50 dark:bg-amber-950/30")}>
      {compare && changed ? <><span className="text-muted-foreground line-through">{a || "—"}</span> <b>{b || "—"}</b></> : (b || a || "—")}
    </td>
  );
}

export function DocumentVersionsDialog({ docType, docId, open, onOpenChange }: {
  docType: DocType;
  docId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [against, setAgainst] = useState<number | "none">("none");

  useEffect(() => {
    if (!open) return;
    let live = true;
    getDocumentVersions(docType, docId).then((v) => {
      if (!live) return;
      setVersions(v);
      // the version before the current one, compared with the current one
      const cur = v.length - 1;
      setView(Math.max(0, cur - 1));
      setAgainst(cur > 0 ? cur : "none");
    }).catch(() => { if (live) setVersions([]); });
    return () => { live = false; };
  }, [open, docType, docId]);

  const shown = versions && view !== null ? versions[view] : null;
  const other = versions && against !== "none" ? versions[against] : null;
  const compare = !!(shown?.snapshot && other?.snapshot && other.revision !== shown.revision);
  const pairs = useMemo(() => {
    if (!shown?.snapshot) return [];
    return compare ? pairLines(shown.snapshot.items, other!.snapshot!.items) : shown.snapshot.items.map((l) => ({ a: l, b: null as Row | null }));
  }, [shown, other, compare]);
  const label = (v: DocVersion) => `Rev ${v.revision}${v.current ? " (current)" : ""}`;
  const pdfBase = docType === "so" ? "/api/sales-order" : docType === "po" ? "/api/purchase-order" : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogTitle>Versions</DialogTitle>
        {!versions ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions.</p>
        ) : (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5">Show
                <select className="h-8 rounded-md border border-border bg-background px-2" value={view ?? 0} onChange={(e) => setView(parseInt(e.target.value, 10))}>
                  {versions.map((v) => <option key={v.revision} value={v.revision}>{label(v)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5">compared with
                <select className="h-8 rounded-md border border-border bg-background px-2" value={String(against)} onChange={(e) => setAgainst(e.target.value === "none" ? "none" : parseInt(e.target.value, 10))}>
                  <option value="none">— nothing —</option>
                  {versions.map((v) => <option key={v.revision} value={v.revision}>{label(v)}</option>)}
                </select>
              </label>
              {pdfBase && shown?.snapshot && (
                <a className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 hover:bg-muted"
                  href={`${pdfBase}/${docId}/pdf?rev=${shown.revision}`} target="_blank" rel="noreferrer">
                  <DownloadIcon className="h-3.5 w-3.5" /> PDF of {label(shown)}
                </a>
              )}
            </div>

            {shown && shown.revision > 0 && shown.reason && (
              <p className="text-muted-foreground">
                {label(shown)}: {shown.reason}
                {shown.createdAt ? ` · ${new Date(shown.createdAt).toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                {shown.createdByName ? ` · ${shown.createdByName}` : ""}
              </p>
            )}
            {compare && <p className="text-muted-foreground">Changes from {label(shown!)} to {label(other!)} are highlighted: <span className="line-through">before</span> <b>after</b>.</p>}

            {!shown?.snapshot ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-muted-foreground">
                {shown ? `${label(shown)} wasn't kept: it was amended before versions were saved. The Amendments card shows what changed.` : ""}
              </p>
            ) : (
              <>
                <table className="w-full">
                  <tbody>
                    {FIELDS[docType].map((f) => {
                      const a = f.show(shown.snapshot!.doc);
                      const b = compare ? f.show(other!.snapshot!.doc) : a;
                      const doc = f.key === "documentKey" ? (compare ? other!.snapshot!.doc.documentKey : shown.snapshot!.doc.documentKey) : null;
                      return (
                        <tr key={f.key} className="border-t border-border/60">
                          <td className="w-44 py-1 pr-2 align-top text-muted-foreground">{f.label}</td>
                          <Cell a={a} b={b} compare={compare} />
                          {f.key === "documentKey" && (
                            <td className="py-1 align-top">
                              {!!shown.snapshot!.doc.documentKey && <a className="underline" href={`/api/customer-po/download/${str(shown.snapshot!.doc.documentKey)}`} target="_blank" rel="noreferrer">open ({label(shown)})</a>}
                              {compare && !!doc && doc !== shown.snapshot!.doc.documentKey && <> · <a className="underline" href={`/api/customer-po/download/${str(doc)}`} target="_blank" rel="noreferrer">open ({label(other!)})</a></>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <table className="w-full">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-2 font-medium">Code</th>
                      <th className="py-1 pr-2 font-medium">Description</th>
                      <th className="py-1 pr-2 font-medium">Qty</th>
                      <th className="py-1 pr-2 font-medium">Unit price</th>
                      <th className="py-1 pr-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map(({ a, b }, i) => {
                      const ref = a ?? b!;
                      const gone = compare && !b;
                      const added = compare && !a;
                      const q = (l: Row | null) => (l ? `${str(l.qty)} ${str(l.uom)}`.trim() + sets(l) : "");
                      return (
                        <tr key={i} className={cn("border-t border-border/60", gone && "text-muted-foreground line-through", added && "bg-green-50 dark:bg-green-950/30")}>
                          <td className="py-1 pr-2 align-top font-mono">{str(ref.productCode) || "—"}{added && <span className="ml-1 not-italic text-green-700"> new</span>}</td>
                          <td className="py-1 pr-2 align-top">{str(ref.description)}</td>
                          <Cell a={q(a)} b={compare ? q(b) : q(a)} compare={compare && !!a && !!b} />
                          <Cell a={a ? money(a.unitPrice) : ""} b={compare ? (b ? money(b.unitPrice) : "") : (a ? money(a.unitPrice) : "")} compare={compare && !!a && !!b} />
                          <Cell a={a ? money(a.totalPrice) : ""} b={compare ? (b ? money(b.totalPrice) : "") : (a ? money(a.totalPrice) : "")} compare={compare && !!a && !!b} />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
