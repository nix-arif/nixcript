"use client";

// How one Case DO line (or doctor template item) is printed on the customer
// copy: as is, as another catalogue product, renamed (the hospital's own code
// or name), as part of a kit, or not at all. Stock is always deducted for the
// actual item — this only changes the customer copy (lib/delivery/customer-view.ts).

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchCustomerViewProducts } from "@/server/delivery-order";
import type { CustomerView } from "@/lib/delivery/customer-view";

export type CustShow = NonNullable<CustomerView["custShow"]>;
export const CUST_SHOW_LABELS: Record<CustShow | "", string> = {
  "": "As is",
  product: "Show as another product",
  text: "Rename (hospital's code / name)",
  kit: "Part of a kit",
  hide: "Hide",
};

/** One-line summary, e.g. "Shown as SFCS000345 × 1", or null when printed as is. */
export function customerViewSummary(v: Omit<CustomerView, "custShow"> & { custShow?: string | null }): string | null {
  const qty = v.custQty ? ` × ${Number(v.custQty)}` : "";
  switch (v.custShow) {
    case "hide": return "Not on the customer copy";
    case "product": return `Shown as ${v.custCode ?? "?"}${v.custDescription ? ` — ${v.custDescription}` : ""}${qty}`;
    case "text": return `Shown as ${[v.custCode, v.custDescription].filter(Boolean).join(" — ")}${qty}`;
    case "kit": return `In kit "${v.custDescription ?? ""}"${v.custQty ? ` (kit × ${Number(v.custQty)})` : ""}`;
    default: return null;
  }
}

export function CustomerViewEditor({ value, onChange, needReason = false, kitNames = [] }: {
  value: CustomerView;
  onChange: (v: CustomerView) => void;
  needReason?: boolean; // a DO line: a different product needs a reason (kept for audit)
  kitNames?: string[]; // kit names already used on this DO / template, to pick from
}) {
  const show = (value.custShow ?? "") as CustShow | "";
  const set = (patch: Partial<CustomerView>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-sky-200 dark:border-sky-800/60 bg-sky-50/50 dark:bg-sky-900/10 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">Customer copy</span>
        {(Object.keys(CUST_SHOW_LABELS) as (CustShow | "")[]).map((k) => (
          <button key={k || "asis"} type="button"
            onClick={() => onChange({ custShow: k || null, custReason: value.custReason, custQty: k && k !== "hide" ? value.custQty : null })}
            className={cn("rounded-full border px-2 py-0.5", show === k ? "border-sky-600 bg-sky-600 text-white" : "border-border bg-background hover:bg-muted/40")}>
            {CUST_SHOW_LABELS[k]}
          </button>
        ))}
      </div>

      {show === "product" && (
        <>
          <ProductSearch value={value} onPick={(p) => set({ custProductId: p.id, custCode: p.productCode, custDescription: p.description, custUom: p.uom })} />
          {value.custProductId && !value.custCode && <span className="text-destructive">Pick the product again</span>}
        </>
      )}
      {(show === "text" || show === "kit") && (
        <div className="flex flex-wrap gap-1.5">
          <Input value={value.custCode ?? ""} onChange={(e) => set({ custCode: e.target.value })}
            placeholder={show === "kit" ? "Kit code (optional)" : "Code to show (optional)"} className="h-7 w-40 text-xs bg-background" />
          <Input value={value.custDescription ?? ""} onChange={(e) => set({ custDescription: e.target.value })} list={show === "kit" ? "cust-kit-names" : undefined}
            placeholder={show === "kit" ? "Kit name, e.g. MILH procedure kit *" : "Description to show"} className="h-7 flex-1 min-w-48 text-xs bg-background" />
          {show === "kit" && <datalist id="cust-kit-names">{kitNames.map((n) => <option key={n} value={n} />)}</datalist>}
        </div>
      )}
      {show && show !== "hide" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">{show === "kit" ? "Kit qty" : "Qty shown"}</span>
          <Input type="number" min="0" step="any" value={value.custQty ?? ""} onChange={(e) => set({ custQty: e.target.value })}
            placeholder={show === "kit" ? "1" : "same"} className="h-7 w-20 text-xs text-right bg-background" />
          {show === "kit" && <span className="text-muted-foreground">Lines with the same kit name print as one line.</span>}
        </div>
      )}
      {show && (show === "product" || needReason) && show !== "kit" && (
        <Input value={value.custReason ?? ""} onChange={(e) => set({ custReason: e.target.value })}
          placeholder={show === "product" && needReason ? "Reason (required), e.g. hospital PO lists SFCS000345" : "Reason (optional)"}
          className="h-7 text-xs bg-background" />
      )}
      {show === "product" && (
        <p className="text-[11px] text-muted-foreground">
          The customer copy shows this product, its MDA number and certificate. Stock is still deducted for the actual item, and the internal copy records both.
        </p>
      )}
    </div>
  );
}

function ProductSearch({ value, onPick }: { value: CustomerView; onPick: (p: { id: string; productCode: string; description: string | null; uom: string | null }) => void }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ q: string; rows: Awaited<ReturnType<typeof searchCustomerViewProducts>> } | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => { const rows = await searchCustomerViewProducts(q); if (!cancelled) setAnswer({ q, rows }); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  const rows = q.trim().length >= 2 && answer?.q === q ? answer.rows : [];
  return (
    <div className="relative">
      <Input value={q || (value.custCode ? `${value.custCode}${value.custDescription ? ` — ${value.custDescription}` : ""}` : "")}
        onChange={(e) => setQ(e.target.value)} onFocus={(e) => { if (!q && value.custCode) { setQ(value.custCode); e.target.select(); } }}
        placeholder="Search the product to show…" className="h-7 text-xs bg-background" />
      {rows.length > 0 && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => { onPick(r); setQ(""); }} className="w-full text-left px-3 py-1.5 hover:bg-muted/40 border-b border-border/40 last:border-0">
              <span className="font-mono text-xs font-medium">{r.productCode}</span> <span className="text-xs text-muted-foreground">{r.description}</span>
              {!r.mdaRegNo && <span className="ml-1 text-[10px] text-destructive">no MDA — won&apos;t print</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
