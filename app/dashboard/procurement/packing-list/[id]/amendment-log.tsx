"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { CheckCircle2Icon, ClipboardCheckIcon, ClockIcon, HistoryIcon, PencilLineIcon, ShieldCheckIcon, Trash2Icon, XCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { InspectionMediaStrip } from "@/components/inspection-media";
import type { LineAmendment, PackingListItemEnriched } from "@/server/packing-list";

const n = (v: number) => String(Math.round(v * 1000) / 1000);
const when = (d: Date | string) => format(new Date(d), "d MMM yyyy, HH:mm");
const figures = (r: number, ret: number, rep: number) => `Received ${n(r)} · Return ${n(ret)} · Repair ${n(rep)} · Accepted ${n(Math.max(0, r - ret))}`;

type Kind = "inspected" | "inspection-approved" | "requested" | "approved" | "rejected" | "cancelled";
type Event = {
  key: string;
  at: Date;
  kind: Kind;
  line: { poLabel: string; lineNo: number | string; code: string; description: string };
  by: string | null;
  title: string;
  detail?: string;
  note?: string | null;
  quote?: string | null;
  stock?: number | null;
  photos?: LineAmendment["photos"];
  pendingAmendment?: boolean;
};

const ICON: Record<Kind, React.ReactNode> = {
  inspected: <ClipboardCheckIcon className="h-3.5 w-3.5" />,
  "inspection-approved": <ShieldCheckIcon className="h-3.5 w-3.5" />,
  requested: <PencilLineIcon className="h-3.5 w-3.5" />,
  approved: <CheckCircle2Icon className="h-3.5 w-3.5" />,
  rejected: <XCircleIcon className="h-3.5 w-3.5" />,
  cancelled: <XCircleIcon className="h-3.5 w-3.5" />,
};
const TONE: Record<Kind, string> = {
  inspected: "bg-muted text-muted-foreground",
  "inspection-approved": "bg-muted text-muted-foreground",
  requested: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  approved: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
};

function change(a: LineAmendment): string {
  if (a.kind === "remove") return "Remove this line from the packing list";
  const d = (label: string, x: number, y: number) => (x === y ? null : `${label} ${n(x)} → ${n(y)}`);
  const acceptedOld = Math.max(0, a.oldQtyReceived - a.oldQtyReturn);
  const acceptedNew = Math.max(0, a.newQtyReceived - a.newQtyReturn);
  const parts = [d("Received", a.oldQtyReceived, a.newQtyReceived), d("Return", a.oldQtyReturn, a.newQtyReturn), d("Repair", a.oldQtyRepair, a.newQtyRepair), d("Accepted", acceptedOld, acceptedNew)].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Notes changed";
}

// Every correction made after the inspection was completed, as one timeline for the whole packing list:
// what the inspection first said, each request to change it (with the reason), and how each request ended.
export function AmendmentLog({ items, poLabel }: { items: PackingListItemEnriched[]; poLabel: (poId: string) => string }) {
  const { events, counts, lines } = useMemo(() => {
    const out: Event[] = [];
    const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    const amended = items.filter((i) => (i.amendments ?? []).length > 0);
    for (const item of amended) {
      const line = { poLabel: poLabel(item.purchaseOrderId), lineNo: item.poLineNo ?? item.rowNo, code: item.productCode ?? "", description: item.description ?? "" };
      const list = item.amendments;
      const first = list[0];
      // what the inspection said before the first change
      if (item.draftInspectedAt) {
        out.push({ key: `${item.id}-insp`, at: new Date(item.draftInspectedAt), kind: "inspected", line, by: item.draftInspectedByName, title: "Inspected", detail: figures(first.oldQtyReceived, first.oldQtyReturn, first.oldQtyRepair) });
      }
      if (item.draftApprovedAt) {
        out.push({ key: `${item.id}-appr`, at: new Date(item.draftApprovedAt), kind: "inspection-approved", line, by: item.draftApprovedByName, title: "Inspection approved" });
      }
      for (const a of list) {
        counts[a.status]++;
        out.push({
          key: `${a.id}-req`, at: new Date(a.requestedAt), kind: "requested", line, by: a.requestedByName,
          title: a.kind === "remove" ? "Removal requested" : "Change requested", detail: change(a), quote: a.reason, photos: a.photos, pendingAmendment: a.status === "pending",
        });
        if (a.status === "approved" || a.status === "rejected") {
          out.push({
            key: `${a.id}-dec`, at: new Date(a.decidedAt ?? a.requestedAt), kind: a.status, line, by: a.decidedByName,
            title: a.status === "approved" ? (a.kind === "remove" ? "Removal approved: line removed" : "Change approved: now in effect") : "Change rejected: nothing changed",
            note: a.decisionNotes, stock: a.status === "approved" && a.stockDelta !== 0 ? a.stockDelta : null,
          });
        } else if (a.status === "cancelled") {
          out.push({ key: `${a.id}-can`, at: new Date(a.decidedAt ?? a.requestedAt), kind: "cancelled", line, by: a.decidedByName ?? a.requestedByName, title: "Request cancelled by the requester" });
        }
      }
    }
    // oldest first, and a request always comes before its own decision
    out.sort((x, y) => x.at.getTime() - y.at.getTime());
    return { events: out, counts, lines: amended.length };
  }, [items, poLabel]);

  if (events.length === 0) return null;

  return (
    <section className="border border-border rounded-xl overflow-hidden" aria-label="Changes after inspection">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
        <HistoryIcon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Changes after inspection</h2>
        <span className="text-xs text-muted-foreground">{lines} line{lines === 1 ? "" : "s"} · oldest first</span>
        <div className="ml-auto flex flex-wrap gap-1.5 text-[11px]">
          {counts.pending > 0 && <span className="rounded-md bg-amber-500 px-2 py-0.5 font-semibold text-white">{counts.pending} waiting for approval</span>}
          {counts.approved > 0 && <span className="rounded-md bg-violet-600 px-2 py-0.5 font-semibold text-white">{counts.approved} approved</span>}
          {counts.rejected > 0 && <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">{counts.rejected} rejected</span>}
          {counts.cancelled > 0 && <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">{counts.cancelled} cancelled</span>}
        </div>
      </header>
      <ol className="divide-y divide-border/60">
        {events.map((e) => (
          <li key={e.key} className={cn("grid gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[10.5rem_minmax(0,1fr)]", e.pendingAmendment && "bg-amber-50/60 dark:bg-amber-950/10")}>
            <div className="text-[11px] tabular-nums text-muted-foreground">
              <div>{when(e.at)}</div>
              {e.by && <div className="text-foreground/80">{e.by}</div>}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", TONE[e.kind])}>{ICON[e.kind]}{e.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  {e.line.poLabel} · line {e.line.lineNo} · <span className="font-mono">{e.line.code || "no code"}</span>
                </span>
                {e.pendingAmendment && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400"><ClockIcon className="h-3 w-3" />waiting for approval</span>}
              </div>
              {e.detail && <p className="text-xs font-medium">{e.detail}</p>}
              {e.quote && <p className="text-xs text-muted-foreground">Reason: &ldquo;{e.quote}&rdquo;</p>}
              {e.note && <p className="text-xs text-muted-foreground">Note: &ldquo;{e.note}&rdquo;</p>}
              {e.stock != null && <p className="text-xs text-muted-foreground">Stock {e.stock > 0 ? "+" : ""}{n(e.stock)}{e.kind === "approved" ? ", recorded as a stock movement" : ""}</p>}
              {e.photos && e.photos.length > 0 && <InspectionMediaStrip photos={e.photos} />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
