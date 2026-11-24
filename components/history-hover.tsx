"use client";

// A document's short history, shown on hover over its row in a list (large
// screens only: no hover on touch, and too cramped on small ones). The events
// are loaded once, the first time the card opens. Used by the Customer PO list
// (cpo-trail-hover.tsx) and the Sales Order list (so-trail-hover.tsx).

import { useState, useSyncExternalStore } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

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

export type HistoryTone = "blue" | "slate" | "violet" | "amber" | "green" | "red";
export type HistoryEvent = { at: Date; title: string; detail?: string; tone: HistoryTone; icon: React.ReactNode };

const TONE: Record<HistoryTone, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export const historyWord = (s: string) => s.replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const historyMoney = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
const when = (d: Date) =>
  d.toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Timeline({ state }: { state: "loading" | "error" | HistoryEvent[] | null }) {
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

  const events = [...state].sort((a, b) => a.at.getTime() - b.at.getTime());
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

/** Wraps a list row: hovering it shows `label`'s history, from `load` (called once). */
export function HistoryHover({
  label, load, children,
}: { label: string; load: () => Promise<HistoryEvent[] | null>; children: React.ReactElement }) {
  const large = useLargeScreen();
  const [state, setState] = useState<"loading" | "error" | HistoryEvent[] | null>(null);

  function onOpenChange(open: boolean) {
    if (!open || state) return;
    setState("loading");
    load()
      .then((events) => setState(events ?? "error"))
      .catch(() => setState("error"));
  }

  if (!large) return children;
  return (
    <HoverCard openDelay={450} closeDelay={80} onOpenChange={onOpenChange}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-80 p-4" side="bottom" collisionPadding={16}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">History</div>
          <div className="font-mono text-[11px] text-muted-foreground truncate">{label}</div>
        </div>
        <Timeline state={state} />
      </HoverCardContent>
    </HoverCard>
  );
}
