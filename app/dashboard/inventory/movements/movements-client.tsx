"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeftIcon, TrendingUpIcon, TrendingDownIcon, SlidersHorizontalIcon } from "lucide-react";
import type { MovementWithMeta } from "@/server/inventory";
import { MOVEMENT_LABELS } from "@/lib/inventory/constants";

const TYPE_STYLE: Record<string, string> = {
  STOCK_IN:   "text-green-700 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-700 dark:bg-green-900/20",
  OPENING:    "text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-400 dark:border-blue-700",
  STOCK_OUT:  "text-red-700 border-red-300 bg-red-50 dark:text-red-400 dark:border-red-700",
  ADJUSTMENT: "text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-400 dark:border-purple-700",
  RETURN:     "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700",
};

function fmt(v: string | number) {
  const n = parseFloat(String(v));
  return (n > 0 ? "+" : "") + n.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function MovementsClient({ movements }: { movements: MovementWithMeta[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const filtered = movements.filter(m => {
    const matchSearch =
      m.productCode.toLowerCase().includes(search.toLowerCase()) ||
      (m.referenceNo ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (m.notes ?? "").toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "ALL" || m.movementType === typeFilter;
    return matchSearch && matchType;
  });

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/inventory")} className="h-8 w-8">
          <ArrowLeftIcon className="h-4 w-4"/>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Movement History</h1>
          <p className="text-sm text-muted-foreground">{movements.length} records (latest 200)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Search product, reference, notes…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs"/>
        <div className="flex items-center gap-1.5 flex-wrap">
          {["ALL", "STOCK_IN", "STOCK_OUT", "ADJUSTMENT", "RETURN", "OPENING"].map(t => (
            <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} className="h-7 text-xs" onClick={() => setTypeFilter(t)}>
              {t === "ALL" ? "All" : MOVEMENT_LABELS[t] ?? t}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-40">Date</TableHead>
              <TableHead className="w-32">Product</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead className="w-24 text-right">Qty</TableHead>
              <TableHead className="w-24 text-right">Balance</TableHead>
              <TableHead className="w-28">Reference</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-32">By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">
                  No movements found.
                </TableCell>
              </TableRow>
            ) : filtered.map(m => {
              const qty = parseFloat(m.quantity);
              return (
                <TableRow key={m.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs font-medium">{m.productCode}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs gap-1 ${TYPE_STYLE[m.movementType] ?? ""}`}>
                      {qty > 0 ? <TrendingUpIcon className="h-3 w-3"/> : <TrendingDownIcon className="h-3 w-3"/>}
                      {MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums text-sm ${qty >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {fmt(m.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{parseFloat(m.balanceAfter).toLocaleString("en-MY", { maximumFractionDigits: 4 })}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.referenceNo ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-48 truncate" title={m.notes ?? ""}>{m.notes ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.createdByName ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
