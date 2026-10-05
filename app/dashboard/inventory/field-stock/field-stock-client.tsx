"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import type { RepSummary, FieldMovementRow } from "@/server/field-stock";
import type { ItemGroupRow } from "@/server/item-group";
import { groupSections, otherGroupNames } from "@/lib/inventory/group-sections";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { TruckIcon, UserIcon, HospitalIcon } from "lucide-react";
import { INTENDED_USE_LABELS, isLendable, unitUseLabel, LOAN_PURPOSE_LABELS } from "@/lib/inventory/constants";

// Named from the specialist's side: FIELD_OUT is the warehouse's "transfer
// out", i.e. stock the specialist received.
const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
  FIELD_OUT:    { label: "Received from warehouse", color: "text-green-600 dark:text-green-400" },
  FIELD_RETURN: { label: "Returned to warehouse", color: "text-blue-600 dark:text-blue-400"  },
  CASE_USE:     { label: "Case Usage",   color: "text-amber-600 dark:text-amber-400" },
  RETURN:       { label: "Back from DO", color: "text-blue-600 dark:text-blue-400"  },
  LOAN_OUT:     { label: "Loan Out",     color: "text-amber-600 dark:text-amber-400" },
  LOAN_RETURN:  { label: "Loan Return",  color: "text-blue-600 dark:text-blue-400"  },
  OPENING:      { label: "Opening Balance", color: "text-muted-foreground" },
  ADJUSTMENT:   { label: "Adjustment",   color: "text-muted-foreground" },
  STOCK_IN:     { label: "Stock In",     color: "text-green-600 dark:text-green-400" },
  STOCK_OUT:    { label: "Stock Out",    color: "text-amber-600 dark:text-amber-400" },
  TRANSFER:     { label: "Transfer",     color: "text-muted-foreground" },
  CONSIGN_SEND:    { label: "Consigned in",           color: "text-violet-600 dark:text-violet-400" },
  CONSIGN_USE:     { label: "Case Usage (consigned)", color: "text-amber-600 dark:text-amber-400" },
  CONSIGN_BACK:    { label: "Returned to owner",      color: "text-blue-600 dark:text-blue-400" },
  CONSIGN_ADJUST:  { label: "Consigned count adj.",   color: "text-muted-foreground" },
  CONSIGN_REVERSE: { label: "Consigned use reversed", color: "text-blue-600 dark:text-blue-400" },
};
const movementLabel = (m: FieldMovementRow) =>
  m.movementType === "CONSIGN_MOVE"
    ? { label: m.delta > 0 ? "Consigned moved in" : "Consigned moved out", color: "text-violet-600 dark:text-violet-400" }
    : MOVEMENT_LABELS[m.movementType] ?? { label: m.movementType, color: "text-muted-foreground" };

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

interface Props {
  reps: RepSummary[];
  movements: FieldMovementRow[];
  itemGroups?: ItemGroupRow[];
}

export function FieldStockClient({ reps, movements, itemGroups = [] }: Props) {
  const router = useRouter();
  const [activeRep, setActiveRep] = useState<string | null>(reps[0]?.repId ?? null);
  const [tab, setTab] = useState<"stock" | "history">("stock");

  const selectedRep = reps.find((r) => r.repId === activeRep);

  // Each row is already seen from one specialist's holding (server side) —
  // the same buckets Current Holdings adds up, own and consigned.
  const repMovements = movements.filter((m) => !activeRep || m.repId === activeRep);

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Field Stock</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stock held by sales reps for case-based deployment.
          </p>
        </div>
        <Button size="sm" onClick={() => router.push("/dashboard/inventory/field-stock/transfer")} className="gap-2">
          <TruckIcon className="w-3.5 h-3.5" />
          Transfer Stock
        </Button>
      </div>

      {reps.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          No field stock yet. Transfer stock to a rep to get started.
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Rep list sidebar */}
          <div className="w-52 shrink-0 space-y-1">
            {reps.map((rep) => (
              <button
                key={rep.repId}
                onClick={() => setActiveRep(rep.repId)}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2.5 transition-colors",
                  activeRep === rep.repId
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted/60 text-foreground",
                )}
              >
                <div className="flex items-center gap-2">
                  <UserIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  <span className="text-sm font-medium truncate">{rep.repName}</span>
                </div>
                <p className="text-xs opacity-70 mt-0.5 ml-5">
                  {rep.items.length} product{rep.items.length !== 1 ? "s" : ""}
                  {rep.onLoan?.length ? ` · ${rep.onLoan.length} at hospital` : ""}
                </p>
              </button>
            ))}
          </div>

          {/* Detail panel */}
          <div className="flex-1 min-w-0">
            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b border-border">
              {(["stock", "history"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize",
                    tab === t
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "stock" ? "Current Holdings" : "Movement History"}
                </button>
              ))}
            </div>

            {tab === "stock" && selectedRep && (
              <CurrentHoldings rep={selectedRep} itemGroups={itemGroups} />
            )}

            {tab === "history" && (
              repMovements.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No movement history.</p>
              ) : (
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2.5 font-medium">Date</th>
                        <th className="text-left px-4 py-2.5 font-medium">Type</th>
                        <th className="text-left px-4 py-2.5 font-medium">Product</th>
                        <th className="text-left px-4 py-2.5 font-medium">Lot / Expiry</th>
                        <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                        <th className="text-right px-4 py-2.5 font-medium" title="What the specialist held of this product (same owner) right after">Balance</th>
                        <th className="text-left px-4 py-2.5 font-medium">Reference</th>
                        <th className="text-left px-4 py-2.5 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repMovements.map((m) => {
                        const cfg = movementLabel(m);
                        const pending = m.status !== "APPROVED";
                        return (
                          <tr key={`${m.id}-${m.repId}`} className={cn("border-b border-border/50 last:border-0 hover:bg-muted/20", m.consignedFrom && "bg-violet-50/30 dark:bg-violet-900/5", pending && "opacity-60")}>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.createdAt)}</td>
                            <td className={cn("px-4 py-2.5 text-xs font-medium", cfg.color)}>
                              {cfg.label}
                              {pending && <span className="ml-1 text-[10px] font-normal text-muted-foreground">({m.status.toLowerCase()})</span>}
                              {m.consignedFrom && <div className="text-[10px] font-normal text-violet-700 dark:text-violet-300">owned by {m.consignedFrom}</div>}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs">
                              {m.productCode}
                              {m.serialNo && <div className="text-[10px] text-muted-foreground">SN {m.serialNo}</div>}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                              {m.lotNo ? (
                                <>
                                  <span className="font-mono">{m.lotNo}</span>
                                  {m.expiryDate && <span className="ml-1 opacity-70">exp {fmtDate(m.expiryDate)}</span>}
                                </>
                              ) : "—"}
                            </td>
                            <td className={cn("px-4 py-2.5 text-right tabular-nums text-xs font-medium",
                              m.delta < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
                            )}>
                              {m.delta > 0 ? "+" : ""}{fmtQty(m.delta)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground">{m.balance === null ? "—" : fmtQty(m.balance)}</td>
                            <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{m.referenceNo}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[200px]">{m.notes ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const DAY = 86_400_000;
const rm = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function expiryState(d: Date | string | null, now: number): "expired" | "soon" | null {
  if (!d) return null;
  const days = (new Date(d).getTime() - now) / DAY;
  return days < 0 ? "expired" : days <= 90 ? "soon" : null;
}

// Everything the specialist is holding: each product with its lots (expiry
// flagged) and serial numbers (with their use), cost and value, plus the
// machines they lent out that are still at a hospital.
function CurrentHoldings({ rep, itemGroups }: { rep: RepSummary; itemGroups: ItemGroupRow[] }) {
  // Listed under the user-defined item groups, in their order ("Other" last);
  // a product in several groups is listed once, under its first group
  const sections = groupSections(rep.items, (i) => i.itemGroupIds, itemGroups);
  const [now] = useState(() => Date.now());
  const units = rep.items.reduce((s, i) => s + i.qty, 0);
  // Consigned stock is the owner's (not ours until used) — left out of the value
  const own = rep.items.filter((i) => !i.consignedBreakdown?.length);
  const consignedCount = rep.items.length - own.length;
  const value = own.reduce((s, i) => s + (i.unitCost ? i.qty * parseFloat(i.unitCost) : 0), 0);
  const noCost = own.filter((i) => !i.unitCost || !(parseFloat(i.unitCost) > 0)).length;
  const lots = rep.items.flatMap((i) => i.lots);
  const expired = lots.filter((l) => expiryState(l.expiryDate, now) === "expired").length;
  const soon = lots.filter((l) => expiryState(l.expiryDate, now) === "soon").length;
  const out = rep.onLoan ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ["Products", String(rep.items.length), null],
          ["Units held", fmtQty(units), null],
          ["Stock value", rm(value), [noCost ? `${noCost} product${noCost > 1 ? "s" : ""} without a cost` : null, consignedCount ? `excl. ${consignedCount} consigned (owner's)` : null].filter(Boolean).join(" · ") || null],
          ["Lots to watch", String(expired + soon), expired ? `${expired} expired · ${soon} within 90 days` : soon ? `${soon} within 90 days` : "none expiring"],
        ].map(([label, val, sub]) => (
          <div key={label} className="rounded-lg border border-border px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("text-sm font-semibold tabular-nums", label === "Lots to watch" && expired ? "text-red-600 dark:text-red-400" : label === "Lots to watch" && soon ? "text-amber-600 dark:text-amber-400" : "")}>{val}</div>
            {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
          </div>
        ))}
      </div>

      {rep.items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No items in field stock.</p>
      ) : (
        <div className="rounded-xl border overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border text-xs text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-medium">Product</th>
                <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                <th className="text-right px-4 py-2.5 font-medium">Unit cost</th>
                <th className="text-right px-4 py-2.5 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((sec) => (
                <Fragment key={sec.key}>
                {sec.name && (
                  <tr className="bg-muted/30 border-b border-border/50">
                    <td colSpan={4} className="px-4 py-1.5">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold">
                        <span className="w-2 h-2 rounded-full" style={{ background: sec.color ?? "var(--muted-foreground)" }} />
                        {sec.name} <span className="font-normal text-muted-foreground">{sec.items.length}</span>
                      </span>
                    </td>
                  </tr>
                )}
              {sec.items.map((item) => {
                const cost = item.unitCost ? parseFloat(item.unitCost) : 0;
                const unserialized = item.units.length ? item.qty - item.units.length : 0;
                return (
                  <tr key={`${item.productId}-${item.consignedBreakdown?.[0]?.sourceOrgId ?? "own"}`} className="border-b border-border/50 last:border-0 align-top hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-medium">{item.productCode}</span>
                        {otherGroupNames(item.itemGroupIds, itemGroups, sec.key).length > 0 && (
                          <span className="text-[10px] text-muted-foreground" title="This product is in these groups too">also in {otherGroupNames(item.itemGroupIds, itemGroups, sec.key).join(", ")}</span>
                        )}
                        {item.consignedBreakdown?.length ? (
                          <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">consigned · owned by {item.consignedBreakdown[0].sourceOrgName}</span>
                        ) : null}
                        {item.units.some((u) => isLendable(u.intendedUse)) && (
                          <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">company asset</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{item.description}{item.uom ? ` · ${item.uom}` : ""}</div>
                      {item.lots.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mr-0.5">Lots</span>
                          {item.lots.map((lot) => {
                            const st = expiryState(lot.expiryDate, now);
                            return (
                              <span key={lot.lotNo} className={cn("text-[11px] px-2 py-0.5 rounded-full border",
                                st === "expired" ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                                  : st === "soon" ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
                                  : "border-border bg-background")}>
                                <span className="font-mono">{lot.lotNo}</span>
                                {lot.expiryDate && <span className="ml-1.5 opacity-80">{st === "expired" ? "expired" : "exp"} {fmtDate(lot.expiryDate)}</span>}
                                <span className="ml-1.5 opacity-60">× {fmtQty(parseFloat(lot.quantity))}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {item.units.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mr-0.5">Serial</span>
                          {item.units.map((u) => (
                            <span key={u.id} className={cn("text-[11px] px-2 py-0.5 rounded-full border font-mono",
                              isLendable(u.intendedUse) ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300" : "border-border bg-background")}>
                              {u.serialNo}<span className="ml-1.5 font-sans opacity-70">{unitUseLabel(u.intendedUse).toLowerCase()}</span>
                            </span>
                          ))}
                          {unserialized > 0 && <span className="text-[10px] text-amber-700 dark:text-amber-400">+ {fmtQty(unserialized)} without a serial no.</span>}
                          {unserialized < 0 && <span className="text-[10px] text-red-600 dark:text-red-400">{item.units.length} serial numbers but qty {fmtQty(item.qty)} — check with the specialist and correct in Stock Overview → Edit</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      <span className={cn(item.qty < 3 ? "text-amber-600 dark:text-amber-400" : "")}>{fmtQty(item.qty)}</span>
                    </td>
                    {item.consignedBreakdown?.length ? (
                      <td colSpan={2} className="px-4 py-2.5 text-right text-[11px] text-muted-foreground">owner&apos;s stock — not valued here</td>
                    ) : (<>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground">{cost > 0 ? rm(cost) : "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">{cost > 0 ? rm(cost * item.qty) : "—"}</td>
                    </>)}
                  </tr>
                );
              })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {out.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 overflow-x-auto">
          <div className="px-4 py-2.5 bg-amber-50/60 dark:bg-amber-900/10 border-b border-amber-200 dark:border-amber-800/60 flex items-center gap-2 text-sm font-medium">
            <HospitalIcon className="w-4 h-4 text-amber-700 dark:text-amber-400" /> Machines at hospitals ({out.length})
            <span className="text-xs font-normal text-muted-foreground">— lent on a case, not in the count above</span>
          </div>
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Machine</th>
                <th className="text-left px-4 py-2 font-medium">At</th>
                <th className="text-left px-4 py-2 font-medium">Case DO</th>
                <th className="text-right px-4 py-2 font-medium">Out for</th>
              </tr>
            </thead>
            <tbody>
              {out.map((m) => {
                const days = m.since ? Math.max(0, Math.floor((now - new Date(m.since).getTime()) / DAY)) : null;
                return (
                  <tr key={m.unitId} className="border-b border-border/50 last:border-0 align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-xs font-medium">{m.productCode} <span className="text-muted-foreground">SN {m.serialNo}</span></div>
                      <div className="text-xs text-muted-foreground">{m.description} · {m.purpose ? (LOAN_PURPOSE_LABELS[m.purpose] ?? m.purpose).toLowerCase() : unitUseLabel(m.intendedUse).toLowerCase()}{m.consignedFrom ? ` · owned by ${m.consignedFrom}` : ""}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{m.customerName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {m.doId ? <Link href={`/dashboard/fulfillment/delivery/${m.doId}`} className="font-mono hover:underline">{m.doNo}</Link> : "—"}
                      {m.since && <div className="text-muted-foreground">{fmtDate(m.since)}</div>}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums text-xs", days !== null && days > 7 ? "text-amber-700 dark:text-amber-400 font-medium" : "")}>
                      {days === null ? "—" : days === 0 ? "today" : `${days} day${days > 1 ? "s" : ""}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
