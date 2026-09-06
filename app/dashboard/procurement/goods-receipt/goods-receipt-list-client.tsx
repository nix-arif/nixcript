"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { type GoodsReceiptListRow, type PendingReturnRepairRow, writeOffShortfall, resolveShortfall } from "@/server/goods-receipt";
import { resolveReceiptItemAction, type ReturnResolutionInput } from "@/server/packing-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  PlusIcon, SearchIcon, XIcon,
  TruckIcon, BuildingIcon, CalendarIcon, PackageIcon, FileTextIcon, ArrowRightIcon, AlertCircleIcon, CheckIcon,
  ChevronDownIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ResolveReturnDialog } from "./resolve-return-dialog";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

interface Props {
  initialGrs: GoodsReceiptListRow[];
  pendingReturnsRepairs: PendingReturnRepairRow[];
  permissions: string[];
}

export function GoodsReceiptListClient({ initialGrs, pendingReturnsRepairs, permissions }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(pendingReturnsRepairs);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolvingReturnRow, setResolvingReturnRow] = useState<PendingReturnRepairRow | null>(null);
  const [submittingReturn, setSubmittingReturn] = useState(false);

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);

  // Shortfall (resolveShortfall) and repair (resolveReceiptItemAction, no
  // resolution detail needed) both just flip a status flag — return is the
  // only category that needs the ResolveReturnDialog below, since it's the
  // only one with an external counterparty worth recording how it settled.
  async function handleResolve(row: PendingReturnRepairRow) {
    const isShortfall = row.category === "shortfall";
    if (isShortfall && !row.purchaseOrderItemId) return;
    if (!isShortfall && !row.goodsReceiptItemId) return;
    const key = `${row.goodsReceiptItemId ?? row.purchaseOrderItemId}:${row.category}`;
    setResolving(key);
    try {
      if (isShortfall) {
        await resolveShortfall(row.purchaseOrderItemId!);
      } else {
        await resolveReceiptItemAction(row.goodsReceiptItemId!, "repair");
      }
      setPending((prev) => prev.filter((p) => !(
        isShortfall
          ? p.purchaseOrderItemId === row.purchaseOrderItemId && p.category === "shortfall"
          : p.goodsReceiptItemId === row.goodsReceiptItemId && p.category === row.category
      )));
      toast.success("Marked resolved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setResolving(null);
    }
  }

  async function handleConfirmReturnResolution(resolution: ReturnResolutionInput) {
    const itemId = resolvingReturnRow?.goodsReceiptItemId;
    if (!itemId) return;
    setSubmittingReturn(true);
    try {
      await resolveReceiptItemAction(itemId, "return", resolution);
      setPending((prev) => prev.filter((p) => !(p.goodsReceiptItemId === itemId && p.category === "return")));
      toast.success("Marked resolved");
      setResolvingReturnRow(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmittingReturn(false);
    }
  }

  async function handleWriteOff(row: PendingReturnRepairRow) {
    if (!row.purchaseOrderItemId) return;
    if (!confirm(`Write off ${row.qty} short ${row.productCode ?? "item"}? This stops it from showing as remaining to pack — only do this if the supplier won't be sending the rest.`)) return;
    const key = `${row.purchaseOrderItemId}:${row.category}`;
    setResolving(key);
    try {
      await writeOffShortfall(row.purchaseOrderItemId);
      setPending((prev) => prev.filter((p) => !(p.purchaseOrderItemId === row.purchaseOrderItemId && p.category === "shortfall")));
      toast.success("Shortfall written off");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setResolving(null);
    }
  }

  const filtered = initialGrs.filter((gr) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      gr.grNo.toLowerCase().includes(s) ||
      (gr.poNo ?? "").toLowerCase().includes(s) ||
      (gr.prNo ?? "").toLowerCase().includes(s) ||
      (gr.supplierName ?? "").toLowerCase().includes(s) ||
      (gr.receivedByName ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-6">
      <PageHeader
        title="Goods Receipts"
        description="Record and track all supplier deliveries against purchase orders"
        action={
          can("purchase-order:update") && (
            <Button
              onClick={() => router.push("/dashboard/procurement/goods-receipt/create")}
              className="gap-2"
            >
              <PlusIcon className="w-4 h-4" /> New Goods Receipt
            </Button>
          )
        }
      />

      {pending.length > 0 && (
        <div className="mb-5 border border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/15 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircleIcon className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            <h2 className="text-xs font-semibold text-red-800 dark:text-red-300 uppercase tracking-wide">
              Outstanding Issues <span className="font-normal normal-case">({pending.length} item{pending.length !== 1 ? "s" : ""} unresolved)</span>
            </h2>
          </div>
          <p className="text-[11px] text-red-800/70 dark:text-red-300/60 mb-3">
            Items sent back to the supplier, sent for in-house repair, or short-shipped by the supplier — still open until marked resolved below.
          </p>
          <div className="space-y-2">
            {pending.map((row) => {
              const key = `${row.goodsReceiptItemId ?? row.purchaseOrderItemId}:${row.category}`;
              const isReturn = row.category === "return";
              const isShortfall = row.category === "shortfall";
              const refNo = isShortfall ? (row.poNo ?? row.prNo ?? row.purchaseOrderId) : (row.grNo ?? row.poNo ?? row.prNo);
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 border border-red-200/70 dark:border-red-800/40 bg-background rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-wrap">
                    <span className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded-md border shrink-0",
                      isReturn
                        ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                        : isShortfall
                        ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                        : "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800",
                    )}>
                      {row.qty} {isReturn ? "to return" : isShortfall ? "short-shipped" : "in repair"}
                    </span>
                    <button
                      className="font-mono text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                      title={isShortfall ? "Open the purchase order" : "Open the goods receipt"}
                      onClick={() => router.push(
                        isShortfall
                          ? `/dashboard/procurement/purchase-order/${row.purchaseOrderId}`
                          : `/dashboard/procurement/goods-receipt/${row.goodsReceiptId}`,
                      )}
                    >
                      {isShortfall ? "PO " : "GR "}{refNo}
                    </button>
                    <span className="text-[11px] text-muted-foreground truncate">
                      <span className="font-mono">{row.productCode}</span>
                      {row.description && <span className="text-muted-foreground/80"> — {row.description}</span>}
                    </span>
                    {row.supplierName && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                        <BuildingIcon className="w-3 h-3 shrink-0" />
                        {row.supplierName}
                      </span>
                    )}
                    {row.notes && <span className="text-[11px] text-muted-foreground truncate">&ldquo;{row.notes}&rdquo;</span>}
                    {row.inspectedAt && (
                      <span className="text-[10px] text-muted-foreground/70 truncate shrink-0">
                        {formatDistanceToNow(new Date(row.inspectedAt), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  {can("packing-list:inspect") && (
                    isShortfall ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 h-7 text-xs shrink-0"
                            disabled={resolving === key}
                          >
                            Action <ChevronDownIcon className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleResolve(row)}>
                            <CheckIcon className="w-3.5 h-3.5" /> Mark Resolved
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleWriteOff(row)}>
                            <XIcon className="w-3.5 h-3.5" /> Write Off
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : isReturn ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-7 text-xs shrink-0"
                        onClick={() => setResolvingReturnRow(row)}
                      >
                        <CheckIcon className="w-3.5 h-3.5" /> Mark Resolved
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-7 text-xs shrink-0"
                        disabled={resolving === key}
                        onClick={() => handleResolve(row)}
                      >
                        <CheckIcon className="w-3.5 h-3.5" /> Mark Resolved
                      </Button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by GR no., PO no., supplier…"
          className="pl-9 h-9 text-sm"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">0 records</div>
          <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
            <TruckIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <div className="text-sm font-medium mb-1">
              {search ? "No goods receipts match your search" : "No goods receipts yet"}
            </div>
            <div className="text-xs mb-4">
              {search ? "Try a different search term" : "Record a receipt when goods arrive from a supplier"}
            </div>
            {!search && can("purchase-order:update") && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => router.push("/dashboard/procurement/goods-receipt/create")}
              >
                <PlusIcon className="w-3.5 h-3.5" /> New Goods Receipt
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3 tabular-nums">
            {filtered.length} record{filtered.length !== 1 ? "s" : ""}
          </div>
          <div className="space-y-2">
            {filtered.map((gr) => (
              <div
                key={gr.id}
                className="border border-border rounded-xl bg-background hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/procurement/goods-receipt/${gr.id}`)}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/20 shrink-0">
                    <TruckIcon className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">
                        <Highlight text={gr.grNo} query={search} />
                      </span>
                      {(gr.poNo ?? gr.prNo) && (
                        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 font-mono">
                          <Highlight text={gr.poNo ?? gr.prNo ?? ""} query={search} />
                        </span>
                      )}
                      {gr.status === "recalled" && (
                        <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                          Recalled
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {gr.supplierName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <BuildingIcon className="w-3 h-3" />
                          <Highlight text={gr.supplierName} query={search} />
                        </span>
                      )}
                      {gr.itemCount > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <PackageIcon className="w-3 h-3" />
                          {gr.itemCount} item{gr.itemCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <CalendarIcon className="w-3 h-3" />
                        Received {fmtDate(gr.receivedDate)}
                        {gr.receivedByName && <> · {gr.receivedByName}</>}
                      </span>
                    </div>
                  </div>

                  {gr.salesOrderId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/dashboard/fulfillment/delivery/create?soId=${gr.salesOrderId}`);
                      }}
                      className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-[11px] font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                      title="Go to pending delivery order"
                    >
                      <FileTextIcon className="w-3 h-3" />
                      {gr.salesOrderNo ?? "SO"}
                      <ArrowRightIcon className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {resolvingReturnRow && (
        <ResolveReturnDialog
          key={resolvingReturnRow.goodsReceiptItemId ?? undefined}
          supplierId={resolvingReturnRow.supplierId}
          targetOrgId={resolvingReturnRow.organizationId}
          itemLabel={resolvingReturnRow.productCode || resolvingReturnRow.description || "this item"}
          qty={resolvingReturnRow.qty}
          submitting={submittingReturn}
          onConfirm={handleConfirmReturnResolution}
          onClose={() => setResolvingReturnRow(null)}
        />
      )}
    </div>
  );
}
