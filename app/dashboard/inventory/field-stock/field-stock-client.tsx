"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RepSummary, FieldMovementRow } from "@/server/field-stock";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PackageIcon, ArrowRightIcon, ArrowLeftIcon, TruckIcon, ActivityIcon, UserIcon } from "lucide-react";

const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
  FIELD_OUT:    { label: "Transfer Out", color: "text-amber-600 dark:text-amber-400" },
  FIELD_RETURN: { label: "Return",       color: "text-blue-600 dark:text-blue-400"  },
  CASE_USE:     { label: "Case Usage",   color: "text-green-600 dark:text-green-400" },
};

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

interface Props {
  reps: RepSummary[];
  movements: FieldMovementRow[];
}

export function FieldStockClient({ reps, movements }: Props) {
  const router = useRouter();
  const [activeRep, setActiveRep] = useState<string | null>(reps[0]?.repId ?? null);
  const [tab, setTab] = useState<"stock" | "history">("stock");

  const selectedRep = reps.find((r) => r.repId === activeRep);

  const repMovements = movements.filter((m) => {
    if (!activeRep) return true;
    const label = `Field:${activeRep}`;
    return m.warehouseLabel === label || m.warehouseTo === label;
  });

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
              selectedRep.items.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No items in field stock.</p>
              ) : (
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2.5 font-medium">Product</th>
                        <th className="text-left px-4 py-2.5 font-medium">Description</th>
                        <th className="text-left px-4 py-2.5 font-medium">UOM</th>
                        <th className="text-right px-4 py-2.5 font-medium">Qty Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRep.items.map((item) => (
                        <tr key={item.productId} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-mono text-xs font-medium">{item.productCode}</td>
                          <td className="px-4 py-2.5 text-sm">{item.description}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.uom ?? "—"}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            <span className={cn(item.qty < 3 ? "text-amber-600 dark:text-amber-400" : "")}>
                              {item.qty.toFixed(0)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
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
                        <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                        <th className="text-left px-4 py-2.5 font-medium">Reference</th>
                        <th className="text-left px-4 py-2.5 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repMovements.map((m) => {
                        const cfg = MOVEMENT_LABELS[m.movementType] ?? { label: m.movementType, color: "text-muted-foreground" };
                        return (
                          <tr key={m.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.createdAt)}</td>
                            <td className={cn("px-4 py-2.5 text-xs font-medium", cfg.color)}>{cfg.label}</td>
                            <td className="px-4 py-2.5 font-mono text-xs">{m.productCode}</td>
                            <td className={cn("px-4 py-2.5 text-right tabular-nums text-xs font-medium",
                              parseFloat(m.quantity) < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
                            )}>
                              {parseFloat(m.quantity) > 0 ? "+" : ""}{parseFloat(m.quantity).toFixed(0)}
                            </td>
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
