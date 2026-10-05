"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon, SearchIcon, BuildingIcon, UserIcon, HospitalIcon, HandshakeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import type { ConsignmentListRow } from "@/server/consign";

const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

type TypeFilter = "all" | "agent" | "partner" | "customer";
type StatusFilter = "open" | "closed" | "all";

export function ConsignmentListClient({ rows, canCreate }: { rows: ConsignmentListRow[]; canCreate: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("open");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) =>
      (type === "all" || r.consigneeType === type) &&
      (status === "all" || r.status === status) &&
      (!s || [r.consignmentNo, r.consigneeName, r.subName, r.ownerName].some((v) => v.toLowerCase().includes(s))));
  }, [rows, q, type, status]);

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Consignments"
        description="Stock placed with agents (your other companies) and customers — still the owner's until it's used"
        action={canCreate ? (
          <Button onClick={() => router.push("/dashboard/consignment/new")} className="gap-2">
            <PlusIcon className="w-4 h-4" /> New consignment
          </Button>
        ) : undefined}
      />

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, agent, specialist, hospital…" className="pl-9 h-10 md:h-9 text-sm" />
        </div>
        <Segmented value={type} onChange={setType} options={[["all", "All"], ["agent", "Company"], ["partner", "External"], ["customer", "Customer"]]} />
        <Segmented value={status} onChange={setStatus} options={[["open", "Open"], ["closed", "Closed"], ["all", "All"]]} />
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl py-16 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "No consignments yet." : "No consignments match these filters."}
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
          {filtered.map((r) => {
            const Icon = r.consigneeType === "customer" ? HospitalIcon : r.consigneeType === "partner" ? HandshakeIcon : r.subName && r.subName !== "Warehouse" ? UserIcon : BuildingIcon;
            const tone = r.consigneeType === "customer" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              : r.consigneeType === "partner" ? "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
              : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
            return (
              <Link key={r.id} href={`/dashboard/consignment/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", tone)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold">{r.consignmentNo}</span>
                    <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5", tone)}>
                      {r.consigneeType === "customer" ? "Customer" : r.consigneeType === "partner" ? "External agent" : "Company"}
                    </span>
                    {r.status === "closed" && <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-muted text-muted-foreground">Closed</span>}
                    {!r.isOwner && <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Held by you · owned by {r.ownerName}</span>}
                  </div>
                  <div className="text-sm mt-0.5 break-words">{r.consigneeName}{r.subName ? <span className="text-muted-foreground"> · {r.subName}</span> : null}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Sent {fmtDate(r.sentDate)} · {r.lineCount} line{r.lineCount !== 1 ? "s" : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums">{fmtQty(r.qtyOnHand)}</div>
                  <div className="text-[10px] text-muted-foreground">on hand</div>
                  {r.qtyConsumed > 0 && <div className="text-[10px] text-muted-foreground tabular-nums">{fmtQty(r.qtyConsumed)} used</div>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30 shrink-0">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={cn("px-3 h-8 md:h-7 text-xs rounded-md transition-colors", value === v ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}>
          {label}
        </button>
      ))}
    </div>
  );
}
