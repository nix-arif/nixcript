"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ShieldCheckIcon, CheckIcon, XIcon, TrendingUpIcon, TrendingDownIcon } from "lucide-react";
import type { MovementWithMeta } from "@/server/inventory";
import { approveStockMovement, rejectStockMovement } from "@/server/inventory";
import { MOVEMENT_LABELS } from "@/lib/inventory/constants";

const TYPE_STYLE: Record<string, string> = {
  STOCK_IN:   "text-green-700 border-green-300 bg-green-50 dark:text-green-400",
  OPENING:    "text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-400",
  STOCK_OUT:  "text-red-700 border-red-300 bg-red-50 dark:text-red-400",
  ADJUSTMENT: "text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-400",
  RETURN:     "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400",
  TRANSFER:   "text-cyan-700 border-cyan-300 bg-cyan-50 dark:text-cyan-400",
};

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function InventoryApprovalsClient({ pending, warehouses }: {
  pending: MovementWithMeta[];
  warehouses: { label: string; address?: string | null }[];
}) {
  function formatWarehouse(label: string) {
    if (!label.startsWith("Field:")) return label;
    const name = warehouses.find(w => w.label === label)?.address;
    return name ? `Field: ${name.toLowerCase()}` : label;
  }
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [rejectTarget, setRejectTarget] = useState<MovementWithMeta | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  async function handleApprove(mv: MovementWithMeta) {
    setProcessing(mv.id);
    try {
      await approveStockMovement(mv.id);
      toast.success(`Approved — ${mv.productCode} ${mv.quantity} units`);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally { setProcessing(null); }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { toast.error("Reason is required"); return; }
    setProcessing(rejectTarget.id);
    try {
      await rejectStockMovement(rejectTarget.id, rejectReason);
      toast.success("Movement rejected");
      setRejectTarget(null);
      setRejectReason("");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setProcessing(null); }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ShieldCheckIcon className="h-5 w-5 text-muted-foreground"/>Stock Movement Approvals
        </h1>
        <p className="text-sm text-muted-foreground">
          {pending.length === 0 ? "No pending movements." : `${pending.length} movement${pending.length !== 1 ? "s" : ""} awaiting approval.`}
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-lg border border-border py-16 text-center text-sm text-muted-foreground">
          All stock movements have been reviewed.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-40">Submitted</TableHead>
                <TableHead className="w-32">Product</TableHead>
                <TableHead className="w-28">Warehouse</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead className="w-24 text-right">Qty</TableHead>
                <TableHead className="w-28">Reference</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-32">By</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map(mv => {
                const qty = parseFloat(mv.quantity);
                const isProcessing = processing === mv.id;
                return (
                  <TableRow key={mv.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(mv.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs font-medium">{mv.productCode}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatWarehouse(mv.warehouseLabel)}
                      {mv.warehouseTo && <span> → {formatWarehouse(mv.warehouseTo)}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs gap-1 ${TYPE_STYLE[mv.movementType] ?? ""}`}>
                        {qty > 0 ? <TrendingUpIcon className="h-3 w-3"/> : <TrendingDownIcon className="h-3 w-3"/>}
                        {MOVEMENT_LABELS[mv.movementType] ?? mv.movementType}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums text-sm ${qty >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                      {qty > 0 ? "+" : ""}{qty.toLocaleString("en-MY", { maximumFractionDigits: 4 })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{mv.referenceNo ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-40 truncate" title={mv.notes ?? ""}>{mv.notes ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{mv.createdByName ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700"
                          disabled={isProcessing}
                          onClick={() => handleApprove(mv)}
                        >
                          <CheckIcon className="h-3.5 w-3.5 mr-1"/>Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                          disabled={isProcessing}
                          onClick={() => { setRejectTarget(mv); setRejectReason(""); }}
                        >
                          <XIcon className="h-3.5 w-3.5 mr-1"/>Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Reject Sheet */}
      <Sheet open={!!rejectTarget} onOpenChange={open => !open && setRejectTarget(null)}>
        <SheetContent className="w-full sm:max-w-md px-8">
          <SheetHeader className="mb-5"><SheetTitle>Reject Movement</SheetTitle></SheetHeader>
          <div className="flex flex-col gap-4">
            {rejectTarget && (
              <div className="rounded-md bg-muted/40 border border-border p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Product:</span> <strong>{rejectTarget.productCode}</strong></p>
                <p><span className="text-muted-foreground">Warehouse:</span> {formatWarehouse(rejectTarget.warehouseLabel)}</p>
                <p><span className="text-muted-foreground">Qty:</span> {rejectTarget.quantity}</p>
                <p><span className="text-muted-foreground">By:</span> {rejectTarget.createdByName}</p>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Reason <span className="text-destructive">*</span></label>
              <Input
                placeholder="Why is this being rejected?"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={handleReject} disabled={!!processing} className="flex-1">
                {processing ? "Rejecting…" : "Confirm Reject"}
              </Button>
              <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
