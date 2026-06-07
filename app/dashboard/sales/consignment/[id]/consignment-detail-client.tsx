"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ConsignmentDetail, ConsignmentItemRow } from "@/server/consignment";
import { recordConsignmentUsage, closeConsignment } from "@/server/consignment";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ArrowLeftIcon,
  PackageIcon,
  CalendarIcon,
  BuildingIcon,
  UserIcon,
  CheckIcon,
  XIcon,
  HistoryIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: "Active",  className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  closed: { label: "Closed",  className: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400" },
};

interface UsageFormItem {
  consignmentItemId: string;
  qty: string;
}

interface Props {
  consignment: ConsignmentDetail;
  permissions: string[];
  currentUserId: string;
}

export function ConsignmentDetailClient({ consignment, permissions, currentUserId }: Props) {
  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showUsageForm, setShowUsageForm] = useState(false);
  const [usageType, setUsageType] = useState<"used" | "returned">("used");
  const [usageDate, setUsageDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [usageNotes, setUsageNotes] = useState("");
  const [usageQtys, setUsageQtys] = useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = useState(true);

  const snap = consignment.customerSnapshot as any;
  const isActive = consignment.status === "active";
  const st = STATUS_BADGE[consignment.status] ?? STATUS_BADGE.active;

  const remaining = (item: ConsignmentItemRow) =>
    parseFloat(item.qtySent) - parseFloat(item.qtyUsed) - parseFloat(item.qtyReturned);

  function handleQtyChange(itemId: string, val: string) {
    setUsageQtys((prev) => ({ ...prev, [itemId]: val }));
  }

  function handleRecordUsage() {
    const items: UsageFormItem[] = consignment.items
      .map((item) => ({ consignmentItemId: item.id, qty: usageQtys[item.id] ?? "" }))
      .filter((i) => parseFloat(i.qty) > 0);

    if (items.length === 0) {
      toast.error("Enter at least one quantity.");
      return;
    }

    startTransition(async () => {
      try {
        await recordConsignmentUsage({
          consignmentId: consignment.id,
          type: usageType,
          usageDate: new Date(usageDate),
          notes: usageNotes || undefined,
          items,
        });
        toast.success(usageType === "used" ? "Usage recorded." : "Return recorded.");
        setShowUsageForm(false);
        setUsageQtys({});
        setUsageNotes("");
        router.refresh();
      } catch (err: any) {
        toast.error(err.message ?? "Failed to record usage.");
      }
    });
  }

  function handleClose() {
    if (!confirm("Mark this consignment as closed? This cannot be undone.")) return;
    startTransition(async () => {
      try {
        await closeConsignment(consignment.id);
        toast.success("Consignment closed.");
        router.refresh();
      } catch (err: any) {
        toast.error(err.message ?? "Failed to close consignment.");
      }
    });
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <button
        onClick={() => router.push("/dashboard/sales/consignment")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Consignments
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{consignment.consignmentNo}</h1>
            <span className={cn("text-xs font-medium rounded px-2 py-0.5", st.className)}>{st.label}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Sales Order: {consignment.soNo}</p>
        </div>
        <div className="flex gap-2">
          {isActive && can("sales-order:update") && (
            <>
              <Button variant="outline" size="sm" onClick={() => { setShowUsageForm(!showUsageForm); setUsageType("used"); }}>
                Record Usage / Return
              </Button>
              <Button variant="outline" size="sm" onClick={handleClose} disabled={isPending}>
                Close Consignment
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm border rounded-lg p-4">
        {snap?.name && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><UserIcon className="h-3 w-3" /> Customer</p>
            <p className="font-medium">{[snap.title, snap.name].filter(Boolean).join(" ")}</p>
          </div>
        )}
        {snap?.organizationName && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><BuildingIcon className="h-3 w-3" /> Organisation</p>
            <p className="font-medium">{snap.organizationName}</p>
          </div>
        )}
        {consignment.sentDate && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><CalendarIcon className="h-3 w-3" /> Sent Date</p>
            <p className="font-medium">{fmtDate(consignment.sentDate)}</p>
          </div>
        )}
        {consignment.expiryDate && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><CalendarIcon className="h-3 w-3" /> Expiry</p>
            <p className="font-medium">{fmtDate(consignment.expiryDate)}</p>
          </div>
        )}
      </div>

      {consignment.notes && (
        <p className="text-sm text-muted-foreground border-l-2 pl-3">{consignment.notes}</p>
      )}

      {/* Record Usage Form */}
      {showUsageForm && isActive && (
        <div className="border rounded-lg p-4 space-y-4 bg-muted/20">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Record Usage / Return</h3>
            <button onClick={() => setShowUsageForm(false)}>
              <XIcon className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setUsageType("used")}
              className={cn(
                "flex-1 text-sm rounded px-3 py-1.5 border font-medium transition-colors",
                usageType === "used"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-background border-border hover:bg-muted",
              )}
            >
              Used by Customer
            </button>
            <button
              onClick={() => setUsageType("returned")}
              className={cn(
                "flex-1 text-sm rounded px-3 py-1.5 border font-medium transition-colors",
                usageType === "returned"
                  ? "bg-green-600 text-white border-green-600"
                  : "bg-background border-border hover:bg-muted",
              )}
            >
              Returned to Warehouse
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Date</label>
              <Input type="date" value={usageDate} onChange={(e) => setUsageDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notes (optional)</label>
              <Input value={usageNotes} onChange={(e) => setUsageNotes(e.target.value)} placeholder="e.g. Used in surgery on 06 Jun" className="h-8 text-sm" />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Enter qty for each item:</p>
            {consignment.items.map((item) => {
              const rem = remaining(item);
              return (
                <div key={item.id} className="flex items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Remaining: {rem} {item.uom ?? ""}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min="0"
                    max={rem}
                    step="any"
                    placeholder="0"
                    value={usageQtys[item.id] ?? ""}
                    onChange={(e) => handleQtyChange(item.id, e.target.value)}
                    className="h-8 w-24 text-sm"
                    disabled={rem <= 0}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowUsageForm(false)}>Cancel</Button>
            <Button size="sm" onClick={handleRecordUsage} disabled={isPending}>
              {isPending ? "Saving…" : "Save Record"}
            </Button>
          </div>
        </div>
      )}

      {/* Items Table */}
      <div className="space-y-2">
        <h3 className="font-semibold text-sm flex items-center gap-2"><PackageIcon className="h-4 w-4" /> Items</h3>
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-center px-3 py-2">OUM</th>
                <th className="text-right px-3 py-2">Unit Price</th>
                <th className="text-right px-3 py-2">Sent</th>
                <th className="text-right px-3 py-2">Used</th>
                <th className="text-right px-3 py-2">Returned</th>
                <th className="text-right px-3 py-2">Remaining</th>
                <th className="text-right px-3 py-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {consignment.items.map((item, i) => {
                const rem = remaining(item);
                return (
                  <tr key={item.id} className={cn("border-b last:border-0", i % 2 === 1 ? "bg-muted/10" : "")}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{item.description}</p>
                      {item.productCode && <p className="text-xs text-muted-foreground">{item.productCode}</p>}
                    </td>
                    <td className="px-3 py-2 text-center text-muted-foreground">{item.uom ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{fmt(item.unitPrice)}</td>
                    <td className="px-3 py-2 text-right">{item.qtySent}</td>
                    <td className="px-3 py-2 text-right text-orange-600 dark:text-orange-400">{item.qtyUsed}</td>
                    <td className="px-3 py-2 text-right text-green-600 dark:text-green-400">{item.qtyReturned}</td>
                    <td className="px-3 py-2 text-right font-medium">{rem}</td>
                    <td className="px-3 py-2 text-right">{fmt(rem * parseFloat(item.unitPrice))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Usage History */}
      <div className="space-y-2">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 font-semibold text-sm w-full text-left"
        >
          <HistoryIcon className="h-4 w-4" />
          Usage History ({consignment.usages.length})
          {showHistory ? <ChevronUpIcon className="h-4 w-4 ml-auto" /> : <ChevronDownIcon className="h-4 w-4 ml-auto" />}
        </button>

        {showHistory && (
          consignment.usages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No usage recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {consignment.usages.map((u) => {
                const items = u.items as { consignmentItemId: string; qty: string }[];
                return (
                  <div key={u.id} className="border rounded-lg p-3 text-sm space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-[11px] font-medium rounded px-2 py-0.5",
                          u.type === "used"
                            ? "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400"
                            : "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400",
                        )}>
                          {u.type === "used" ? "Used" : "Returned"}
                        </span>
                        <span className="text-muted-foreground">{fmtDate(u.usageDate)}</span>
                      </div>
                      {u.recordedByName && <span className="text-xs text-muted-foreground">by {u.recordedByName}</span>}
                    </div>
                    {u.notes && <p className="text-muted-foreground text-xs">{u.notes}</p>}
                    <div className="space-y-0.5">
                      {items.map((entry, i) => {
                        const item = consignment.items.find((it) => it.id === entry.consignmentItemId);
                        return (
                          <p key={i} className="text-xs text-muted-foreground">
                            {item?.description ?? entry.consignmentItemId}: {entry.qty} {item?.uom ?? ""}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
