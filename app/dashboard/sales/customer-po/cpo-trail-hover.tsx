"use client";

import { useState, useSyncExternalStore } from "react";
import {
  CheckCircle2Icon,
  FileTextIcon,
  InboxIcon,
  PackageIcon,
  PencilIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  TruckIcon,
  WalletIcon,
  XCircleIcon,
} from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { getCustomerPoForTracking, type CustomerPoTrackingData } from "@/server/customer-purchase-order";
import { cn } from "@/lib/utils";

// Hover details are for large screens only (no hover on touch, and too cramped on small ones)
const LARGE = "(min-width: 1024px)";
function useLargeScreen() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(LARGE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(LARGE).matches,
    () => false,
  );
}

type Tone = "blue" | "slate" | "violet" | "amber" | "green" | "red";
type Event = { at: Date; title: string; detail?: string; tone: Tone; icon: React.ReactNode };

const TONE: Record<Tone, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const word = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const money = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
const when = (d: Date) =>
  d.toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// A short, factual history built from what the system already records
function buildTrail(t: CustomerPoTrackingData): Event[] {
  const ev: Event[] = [];
  const icon = "w-3 h-3";
  const { cpo } = t;

  if (cpo.receivedDate)
    ev.push({ at: new Date(cpo.receivedDate), title: "PO received from customer", tone: "slate", icon: <InboxIcon className={icon} /> });
  ev.push({
    at: new Date(cpo.createdAt),
    title: "Recorded in the system",
    detail: t.createdByName ? `by ${t.createdByName}` : undefined,
    tone: "blue",
    icon: <FileTextIcon className={icon} />,
  });
  if (t.so)
    ev.push({ at: new Date(t.so.createdAt), title: `Sales order ${t.so.soNo}`, detail: `${word(t.so.status)}${t.so.grandTotal ? ` · ${money(t.so.grandTotal)}` : ""}`, tone: "violet", icon: <ShoppingCartIcon className={icon} /> });
  for (const p of t.internalPos)
    ev.push({ at: new Date(p.createdAt), title: `Supplier PO ${p.poNo ?? p.prNo ?? ""}`.trim(), detail: word(p.status), tone: "amber", icon: <PackageIcon className={icon} /> });
  for (const d of t.dos)
    ev.push({ at: new Date(d.createdAt), title: `Delivery order ${d.doNo}`, detail: word(d.status), tone: "amber", icon: <TruckIcon className={icon} /> });
  for (const i of t.invoices) {
    ev.push({ at: new Date(i.createdAt), title: `Invoice ${i.invoiceNo}`, detail: `${word(i.status)} · ${money(i.grandTotal)}`, tone: "violet", icon: <ReceiptIcon className={icon} /> });
    if (i.paidAt)
      ev.push({ at: new Date(i.paidAt), title: `Payment received for ${i.invoiceNo}`, detail: money(i.paidAmount ?? i.grandTotal), tone: "green", icon: <WalletIcon className={icon} /> });
  }

  // The record keeps no per-edit history: only that it changed after it was created, and its status now
  const edited = new Date(cpo.updatedAt).getTime() - new Date(cpo.createdAt).getTime() > 60_000;
  if (cpo.status === "fulfilled")
    ev.push({ at: new Date(cpo.updatedAt), title: "Marked fulfilled", tone: "green", icon: <CheckCircle2Icon className={icon} /> });
  else if (cpo.status === "cancelled")
    ev.push({ at: new Date(cpo.updatedAt), title: "Cancelled", tone: "red", icon: <XCircleIcon className={icon} /> });
  else if (edited)
    ev.push({ at: new Date(cpo.updatedAt), title: "Last edited", tone: "slate", icon: <PencilIcon className={icon} /> });

  return ev.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function Trail({ state }: { state: "loading" | "error" | CustomerPoTrackingData | null }) {
  if (state === "loading")
    return (
      <div className="space-y-3 animate-pulse" aria-label="Loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="size-6 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5"><div className="h-3 w-2/3 rounded bg-muted" /><div className="h-2.5 w-1/3 rounded bg-muted/70" /></div>
          </div>
        ))}
      </div>
    );
  if (state === "error" || !state)
    return <p className="text-xs text-muted-foreground">The history could not be loaded.</p>;

  const events = buildTrail(state);
  return (
    <ol className="relative space-y-3.5">
      <span aria-hidden className="absolute left-3 top-3 bottom-3 w-px bg-border" />
      {events.map((e, i) => (
        <li key={i} className="relative flex gap-3">
          <span className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full ring-4 ring-popover", TONE[e.tone])}>
            {e.icon}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[13px] font-medium leading-tight truncate">{e.title}</div>
            {e.detail && <div className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">{e.detail}</div>}
            <div className="text-[10px] text-muted-foreground/80 tabular-nums mt-0.5">{when(e.at)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CpoTrailHover({
  id, poNo, children,
}: { id: string; poNo: string; children: React.ReactElement }) {
  const large = useLargeScreen();
  const [state, setState] = useState<"loading" | "error" | CustomerPoTrackingData | null>(null);

  // Load once, the first time the card is hovered
  function onOpenChange(open: boolean) {
    if (!open || state) return;
    setState("loading");
    getCustomerPoForTracking(id)
      .then((d) => setState(d ?? "error"))
      .catch(() => setState("error"));
  }

  if (!large) return children;
  return (
    <HoverCard openDelay={450} closeDelay={80} onOpenChange={onOpenChange}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-80 p-4" side="bottom" collisionPadding={16}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">History</div>
          <div className="font-mono text-[11px] text-muted-foreground truncate">{poNo}</div>
        </div>
        <Trail state={state} />
      </HoverCardContent>
    </HoverCard>
  );
}
