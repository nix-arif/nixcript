"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { soStockStage, SO_STOCK_STAGE, isUnsubmittedSo, SO_DRAFT_TAG } from "@/lib/sales-order/stock-stage";
import { getSoProcurementStages } from "@/server/sales-order";
import type { SoProcurement, SoProcurementStage } from "@/lib/sales-order/procurement-stage";

// The tag next to an SO's status: "Draft" while a pending-do / pending-pr SO
// hasn't been submitted, "Pending DO" once it's confirmed with its stock
// reserved, nothing otherwise. A confirmed SO short of stock says how far
// buying has got for it (lib/sales-order/procurement-stage.ts): "Pending PR"
// when nothing is raised yet, else "PR raised" / "Awaiting supplier" /
// "Partly received" — given soId. See lib/sales-order/stock-stage.ts.

type Cfg = { label: string; className: string; title: string };
const SHORT: Record<Exclude<SoProcurementStage, "pending-pr" | "pending-do">, (p: SoProcurement) => Cfg> = {
  "pr-raised": (p) => ({
    label: "PR raised",
    className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400",
    title: `Short of stock: ${p.prNos.join(", ") || "a PR"} raised, no supplier PO issued yet`,
  }),
  ordered: (p) => ({
    label: "Awaiting supplier",
    className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",
    title: `Short of stock: ordered on ${p.poNos.join(", ") || "a supplier PO"}, nothing received yet`,
  }),
  "partly-received": (p) => ({
    label: "Partly received",
    className: "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400",
    title: `Goods have come in on ${p.poNos.join(", ") || "its supplier PO"}, but not all the stock is there yet (or re-check stock)`,
  }),
};

// Every tag on the page asks in one go: ids requested in the same moment are sent together
const TTL = 30_000;
const cache = new Map<string, { at: number; value: SoProcurement | null }>();
let queue = new Map<string, ((v: SoProcurement | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  timer = null;
  const batch = queue;
  queue = new Map();
  getSoProcurementStages([...batch.keys()])
    .then((r) => {
      for (const [id, cbs] of batch) {
        const value = r[id] ?? null;
        cache.set(id, { at: Date.now(), value });
        cbs.forEach((cb) => cb(value));
      }
    })
    .catch(() => batch.forEach((cbs) => cbs.forEach((cb) => cb(null))));
}
function loadProcurement(id: string): Promise<SoProcurement | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
  return new Promise((resolve) => {
    queue.set(id, [...(queue.get(id) ?? []), resolve]);
    if (!timer) timer = setTimeout(flush, 0);
  });
}

export function SoStockChip({ status, stockReservationStatus, soId, className }: {
  status: string;
  stockReservationStatus: string | null | undefined;
  /** Given: a confirmed SO short of stock shows how far buying has got for it */
  soId?: string;
  className?: string;
}) {
  const stage = soStockStage(status, stockReservationStatus);
  const [proc, setProc] = useState<SoProcurement | null>(null);
  const lookUp = stage === "pending-pr" && !!soId;
  useEffect(() => {
    if (!lookUp) return;
    let live = true;
    loadProcurement(soId!).then((v) => { if (live) setProc(v); });
    return () => { live = false; };
  }, [lookUp, soId, stockReservationStatus]);

  const cfg: Cfg | null =
    lookUp && proc && proc.stage !== "pending-pr" && proc.stage !== "pending-do" ? SHORT[proc.stage](proc)
      : stage ? SO_STOCK_STAGE[stage]
      : isUnsubmittedSo(status) ? SO_DRAFT_TAG
      : null;
  if (!cfg) return null;
  return (
    <span title={cfg.title} className={cn("text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0", cfg.className, className)}>
      {cfg.label}
    </span>
  );
}

/**
 * Where the order stands, on any of its documents (customer PO, PR, supplier PO): the same tag its
 * sales order shows — Pending PR / PR raised / Awaiting supplier / Partly received / Pending DO.
 * Nothing until the SO is confirmed, or when there's no SO.
 */
export function OrderProgressBadge({ soId, className }: { soId: string | null | undefined; className?: string }) {
  const [proc, setProc] = useState<SoProcurement | null>(null);
  useEffect(() => {
    if (!soId) return;
    let live = true;
    loadProcurement(soId).then((v) => { if (live) setProc(v); });
    return () => { live = false; };
  }, [soId]);
  if (!soId || !proc) return null;
  const cfg = proc.stage === "pending-do" || proc.stage === "pending-pr" ? SO_STOCK_STAGE[proc.stage] : SHORT[proc.stage](proc);
  return (
    <span title={cfg.title} className={cn("text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0", cfg.className, className)}>
      {cfg.label}
    </span>
  );
}
