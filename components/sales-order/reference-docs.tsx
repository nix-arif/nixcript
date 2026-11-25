import Link from "next/link";
import { FileTextIcon, InboxIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// The quotation(s) and customer PO(s) a Sales Order is built from, made to
// stand out and each a link to its page. Shown on the SO page (Details) and on
// its edit page — where links open in a new tab so unsaved edits aren't lost.

export type RefQuotation = { id: string; no: string; badge?: { label: string; className: string } | null; total?: string | null };
export type RefCpo = { id: string; no: string; customerName?: string | null };

export function SoReferenceDocs({
  quotations, cpos, cpoHref, newTab = false, className,
}: {
  quotations: RefQuotation[];
  cpos: RefCpo[];
  cpoHref: (id: string) => string;
  newTab?: boolean;
  className?: string;
}) {
  if (quotations.length === 0 && cpos.length === 0) return null;
  const target = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  const card = "group inline-flex min-w-0 cursor-pointer flex-col rounded-lg border border-primary/25 bg-background px-3 py-2 shadow-xs transition-colors hover:border-primary hover:bg-primary/5";

  return (
    <div className={cn("space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3", className)}>
      {quotations.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <FileTextIcon className="h-3.5 w-3.5" /> Quotation{quotations.length > 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {quotations.map((q) => (
              <Link key={q.id} href={`/dashboard/sales/quotation/${q.id}`} {...target} title={`Open quotation ${q.no}${newTab ? " (new tab)" : ""}`} className={card}>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-primary group-hover:underline">{q.no}</span>
                  {q.badge && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", q.badge.className)}>{q.badge.label}</span>}
                </span>
                {q.total && <span className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{q.total}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
      {cpos.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <InboxIcon className="h-3.5 w-3.5" /> Customer PO{cpos.length > 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {cpos.map((c) => (
              <Link key={c.id} href={cpoHref(c.id)} {...target} title={`Open customer PO ${c.no}${newTab ? " (new tab)" : ""}`} className={card}>
                <span className="font-mono text-sm font-semibold text-primary group-hover:underline">{c.no}</span>
                {c.customerName && <span className="mt-0.5 text-[11px] text-muted-foreground">{c.customerName}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
