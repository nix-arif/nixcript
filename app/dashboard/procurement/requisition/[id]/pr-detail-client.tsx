"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  submitPurchaseRequisition,
  approvePurchaseRequisition,
  rejectPurchaseRequisition,
  cancelPurchaseRequisition,
  deletePurchaseRequisition,
  updatePurchaseRequisition,
  searchSuppliersForPr,
  type PrWithItems,
  type PrItemInput,
} from "@/server/purchase-requisition";
import { hasAccess } from "@/lib/permissions/has-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, PencilIcon, TrashIcon, SendIcon, CheckIcon, XIcon, PlusIcon, LinkIcon,
} from "lucide-react";

const CURRENCIES = ["MYR", "USD", "EUR", "SGD", "GBP", "AUD", "JPY", "CNY", "IDR", "THB"];
import { cn } from "@/lib/utils";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const PR_STATUS: Record<string, { label: string; className: string }> = {
  draft:             { label: "Draft",             className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted:         { label: "Pending Approval",  className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  approved:          { label: "Approved",          className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  partially_ordered: { label: "Partially Ordered", className: "bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400" },
  ordered:           { label: "Fully Ordered",     className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled:         { label: "Cancelled",         className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = PR_STATUS[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return <span className={cn("text-[11px] font-medium rounded-full px-2.5 py-0.5", cfg.className)}>{cfg.label}</span>;
}

// ── Supplier autocomplete (same as create form) ───────────────────────────────

function SupplierCell({
  value,
  onSelect,
  onClear,
  disabled,
}: {
  value: string;
  onSelect: (id: string, name: string) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);

  if (disabled) return <span className="text-xs text-muted-foreground">{value || "—"}</span>;

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <Input
          value={query}
          onChange={async (e) => {
            setQuery(e.target.value);
            if (e.target.value.trim()) {
              const r = await searchSuppliersForPr(e.target.value);
              setResults(r);
              setOpen(r.length > 0);
            } else {
              setResults([]); setOpen(false);
            }
          }}
          placeholder="Supplier…"
          className="h-7 text-xs"
        />
        {value && <button onClick={onClear} className="text-muted-foreground hover:text-destructive text-xs">×</button>}
      </div>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg text-xs w-48 max-h-40 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              className="w-full text-left px-3 py-2 hover:bg-muted/50"
              onClick={() => { onSelect(r.id, r.name); setQuery(r.name); setOpen(false); }}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Edit state ────────────────────────────────────────────────────────────────

interface EditLine extends PrItemInput {
  _key: string;
  _supplierId?: string;
  _supplierName?: string;
}

function calcTotal(item: EditLine): number {
  return (parseFloat(item.qty || "1") || 1) * (parseFloat(item.estimatedUnitCost || "0") || 0);
}

function toEditLine(item: PrWithItems["items"][number]): EditLine {
  return {
    _key: crypto.randomUUID(),
    rowNo: item.rowNo,
    productId: item.productId ?? undefined,
    productCode: item.productCode ?? "",
    description: item.description ?? "",
    qty: item.qty ?? "1",
    uom: item.uom ?? "",
    estimatedUnitCost: item.estimatedUnitCost ?? "0",
    currency: item.currency ?? "MYR",
    _supplierId: item.preferredSupplierId ?? undefined,
    _supplierName: item.preferredSupplierName ?? undefined,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  pr: PrWithItems;
  permissions: string[];
  currentUserId: string;
}

export function PrDetailClient({ pr, permissions, currentUserId }: Props) {
  const router = useRouter();
  const [actioning, setActioning] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<EditLine[]>(pr.items.map(toEditLine));
  const [notes, setNotes] = useState(pr.notes ?? "");

  const can = (p: string) => hasAccess(permissions, p);
  const isOwner = pr.requestedBy === currentUserId;
  const canEdit = can("purchase-order:update") && pr.status === "draft";
  const canSubmit = can("purchase-order:create") && pr.status === "draft" && (isOwner || can("purchase-order:update"));
  const canApprove = can("purchase-requisition:approve") && pr.status === "submitted";
  const canCancel = can("purchase-order:update") && !["ordered", "cancelled"].includes(pr.status);
  const canDelete = can("purchase-order:delete") && pr.status === "draft";

  async function act(key: string, fn: () => Promise<void>) {
    setActioning(key);
    try { await fn(); router.refresh(); } catch (e: any) { toast.error(e.message); } finally { setActioning(null); }
  }

  async function handleSubmit() {
    await act("submit", async () => {
      await submitPurchaseRequisition(pr.id);
      toast.success("Submitted for approval");
    });
  }

  async function handleApprove() {
    await act("approve", async () => {
      await approvePurchaseRequisition(pr.id);
      toast.success("Requisition approved");
    });
  }

  async function handleReject() {
    if (!confirm("Return this requisition to draft? The requester will need to revise and re-submit.")) return;
    await act("reject", async () => {
      await rejectPurchaseRequisition(pr.id);
      toast.success("Requisition returned for revision");
    });
  }

  async function handleCancel() {
    if (!confirm("Cancel this requisition?")) return;
    await act("cancel", async () => {
      await cancelPurchaseRequisition(pr.id);
      toast.success("Requisition cancelled");
    });
  }

  async function handleDelete() {
    if (!confirm(`Delete ${pr.prNo}? This cannot be undone.`)) return;
    setActioning("delete");
    try {
      await deletePurchaseRequisition(pr.id);
      toast.success("Requisition deleted");
      router.push("/dashboard/procurement/requisition");
    } catch (e: any) {
      toast.error(e.message);
      setActioning(null);
    }
  }

  async function handleSaveEdit() {
    const validLines = lines.filter((l) => l.description || l.productCode);
    if (validLines.length === 0) { toast.error("Add at least one item"); return; }
    await act("save", async () => {
      await updatePurchaseRequisition({
        id: pr.id,
        notes: notes.trim() || undefined,
        items: validLines.map((l) => ({
          rowNo: l.rowNo,
          productId: l.productId,
          productCode: l.productCode,
          description: l.description,
          qty: l.qty,
          uom: l.uom,
          estimatedUnitCost: l.estimatedUnitCost,
          currency: l.currency,
          preferredSupplierId: l._supplierId,
          preferredSupplierName: l._supplierName,
        })),
      });
      toast.success("Requisition updated");
      setEditing(false);
    });
  }

  function setLine(key: string, patch: Partial<EditLine>) {
    setLines((prev) => prev.map((l) => l._key === key ? { ...l, ...patch } : l));
  }

  function addLine() {
    setLines((prev) => [...prev, {
      _key: crypto.randomUUID(), rowNo: prev.length + 1,
      productCode: "", description: "", qty: "1", uom: "", estimatedUnitCost: "0", currency: "MYR",
    }]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l._key !== key).map((l, i) => ({ ...l, rowNo: i + 1 })));
  }

  const totalsByCurrency = lines
    .filter((l) => l.description || l.productCode)
    .reduce<Record<string, number>>((acc, l) => {
      const ccy = l.currency ?? "MYR";
      acc[ccy] = (acc[ccy] ?? 0) + calcTotal(l);
      return acc;
    }, {});

  const totalBySupplier = lines
    .filter((l) => l._supplierName)
    .reduce<Record<string, { name: string; currency: string; total: number }>>((acc, l) => {
      const ccy = l.currency ?? "MYR";
      const key = `${l._supplierId ?? l._supplierName ?? "unknown"}::${ccy}`;
      if (!acc[key]) acc[key] = { name: l._supplierName!, currency: ccy, total: 0 };
      acc[key].total += calcTotal(l);
      return acc;
    }, {});

  const displayItems = editing ? lines : pr.items;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <PageHeader
        title={pr.prNo}
        description={`Purchase Requisition · ${fmtDate(pr.createdAt)}`}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.back()}>
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {canEdit && !editing && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
                <PencilIcon className="w-3.5 h-3.5" /> Edit
              </Button>
            )}
            {editing && (
              <>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setLines(pr.items.map(toEditLine)); setNotes(pr.notes ?? ""); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveEdit} disabled={actioning === "save"}>
                  {actioning === "save" ? "Saving…" : "Save Changes"}
                </Button>
              </>
            )}
            {canSubmit && !editing && (
              <Button size="sm" className="gap-1.5" onClick={handleSubmit} disabled={actioning === "submit"}>
                <SendIcon className="w-3.5 h-3.5" /> {actioning === "submit" ? "Submitting…" : "Submit for Approval"}
              </Button>
            )}
            {canApprove && !editing && (
              <>
                <Button size="sm" variant="outline" className="gap-1.5 text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-900/20" onClick={handleApprove} disabled={!!actioning}>
                  <CheckIcon className="w-3.5 h-3.5" /> {actioning === "approve" ? "Approving…" : "Approve"}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/20" onClick={handleReject} disabled={!!actioning}>
                  <XIcon className="w-3.5 h-3.5" /> {actioning === "reject" ? "Returning…" : "Return for Revision"}
                </Button>
              </>
            )}
            {canCancel && !editing && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleCancel} disabled={!!actioning}>
                <XIcon className="w-3.5 h-3.5" /> Cancel PR
              </Button>
            )}
            {canDelete && !editing && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={actioning === "delete"}>
                <TrashIcon className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
          </div>
        }
      />

      {/* Header info */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-xl border border-border bg-background p-5">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Status</p>
          <StatusBadge status={pr.status} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Requested By</p>
          <p className="text-sm font-medium">{pr.requestedByName ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Created</p>
          <p className="text-sm">{fmtDate(pr.createdAt)}</p>
        </div>
        {pr.approvedBy && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Approved By</p>
            <p className="text-sm font-medium">{pr.approvedByName ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{fmtDate(pr.approvedAt)}</p>
          </div>
        )}
        {pr.salesOrderNo && (
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground mb-0.5">Linked Sales Order</p>
            <button
              className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              onClick={() => router.push(`/dashboard/sales/order/${pr.salesOrderId}`)}
            >
              <LinkIcon className="w-3 h-3" /> {pr.salesOrderNo}
            </button>
          </div>
        )}
      </div>

      {/* Supplier summary */}
      {Object.keys(totalBySupplier).length > 0 && (
        <div className="rounded-xl border border-border bg-background p-5 space-y-3">
          <h2 className="text-sm font-semibold">Supplier Summary</h2>
          <div className="space-y-1.5">
            {Object.values(totalBySupplier).map((s, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{s.name}</span>
                <span className="font-medium tabular-nums">
                  <span className="text-xs text-muted-foreground mr-1">{s.currency}</span>
                  {s.total.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Items table */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/20">
          <h2 className="text-sm font-semibold">Items ({pr.items.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium w-8">#</th>
                <th className="text-left px-3 py-2 font-medium w-28">Code</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-left px-3 py-2 font-medium w-16">Qty</th>
                <th className="text-left px-3 py-2 font-medium w-16">UOM</th>
                <th className="text-left px-3 py-2 font-medium w-20">Currency</th>
                <th className="text-right px-3 py-2 font-medium w-28">Est. Unit Cost</th>
                <th className="text-right px-3 py-2 font-medium w-24">Total</th>
                <th className="text-left px-3 py-2 font-medium w-36">Preferred Supplier</th>
                {editing && <th className="w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {editing
                ? lines.map((line) => (
                    <tr key={line._key} className="group">
                      <td className="px-3 py-2 text-muted-foreground">{line.rowNo}</td>
                      <td className="px-2 py-1.5">
                        <Input value={line.productCode ?? ""} onChange={(e) => setLine(line._key, { productCode: e.target.value })} className="h-7 text-xs" placeholder="Code" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={line.description ?? ""} onChange={(e) => setLine(line._key, { description: e.target.value })} className="h-7 text-xs" placeholder="Description" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" value={line.qty ?? "1"} onChange={(e) => setLine(line._key, { qty: e.target.value })} className="h-7 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={line.uom ?? ""} onChange={(e) => setLine(line._key, { uom: e.target.value })} className="h-7 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={line.currency ?? "MYR"}
                          onChange={(e) => setLine(line._key, { currency: e.target.value })}
                          className="h-7 w-full rounded-md border border-border bg-background px-1.5 text-xs"
                        >
                          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" value={line.estimatedUnitCost ?? "0"} onChange={(e) => setLine(line._key, { estimatedUnitCost: e.target.value })} className="h-7 text-xs" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        <span className="text-[10px] text-muted-foreground mr-0.5">{line.currency ?? "MYR"}</span>
                        {calcTotal(line).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 py-1.5">
                        <SupplierCell
                          value={line._supplierName ?? ""}
                          onSelect={(id, name) => setLine(line._key, { _supplierId: id, _supplierName: name })}
                          onClear={() => setLine(line._key, { _supplierId: undefined, _supplierName: undefined })}
                        />
                      </td>
                      <td className="px-2 py-1.5 opacity-0 group-hover:opacity-100">
                        <button onClick={() => removeLine(line._key)} className="text-muted-foreground hover:text-destructive">
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                : pr.items.map((item) => {
                    const total = (parseFloat(item.qty ?? "1") || 1) * (parseFloat(item.estimatedUnitCost ?? "0") || 0);
                    const poLink = item.purchaseOrderNo;
                    return (
                      <tr key={item.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2.5 text-muted-foreground">{item.rowNo}</td>
                        <td className="px-3 py-2.5 font-mono">{item.productCode || "—"}</td>
                        <td className="px-3 py-2.5">{item.description || "—"}</td>
                        <td className="px-3 py-2.5 tabular-nums">{item.qty}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{item.uom || "—"}</td>
                        <td className="px-3 py-2.5 text-xs font-medium">{item.currency ?? "MYR"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {parseFloat(item.estimatedUnitCost ?? "0").toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                          <span className="text-[10px] text-muted-foreground mr-0.5">{item.currency ?? "MYR"}</span>
                          {total.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs">{item.preferredSupplierName || "—"}</span>
                            {poLink && (
                              <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                                PO: {poLink}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
        {editing && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={addLine}>
              <PlusIcon className="w-3 h-3" /> Add Item
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
              {Object.entries(totalsByCurrency).map(([ccy, amt]) => (
                <span key={ccy}>
                  <span className="font-medium text-foreground">{ccy}</span>{" "}
                  <span className="font-semibold text-foreground">{amt.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {!editing && (
          <div className="px-4 py-3 border-t border-border flex justify-end">
            <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
              {(() => {
                const totals = pr.items.reduce<Record<string, number>>((acc, i) => {
                  const ccy = i.currency ?? "MYR";
                  acc[ccy] = (acc[ccy] ?? 0) + (parseFloat(i.qty ?? "1") || 1) * (parseFloat(i.estimatedUnitCost ?? "0") || 0);
                  return acc;
                }, {});
                return Object.entries(totals).map(([ccy, amt]) => (
                  <span key={ccy}>
                    <span className="font-medium text-foreground">{ccy}</span>{" "}
                    <span className="font-semibold text-foreground">{amt.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                  </span>
                ));
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Notes */}
      {(pr.notes || editing) && (
        <div className="rounded-xl border border-border bg-background p-5 space-y-2">
          <h2 className="text-sm font-semibold">Notes</h2>
          {editing ? (
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for purchase, urgency, special requirements…"
              rows={3}
              className="text-sm resize-none"
            />
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{pr.notes}</p>
          )}
        </div>
      )}

      {/* Convert to PO (when approved) */}
      {pr.status === "approved" && can("purchase-order:create") && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-5 space-y-2">
          <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-300">Ready to Convert to Purchase Order</h2>
          <p className="text-xs text-blue-700 dark:text-blue-400">
            This requisition has been approved. The procurement team can now create Purchase Orders per supplier.
          </p>
          <Button
            size="sm"
            onClick={() => router.push(`/dashboard/procurement/purchase-order/create?prId=${pr.id}`)}
          >
            Create Purchase Order
          </Button>
        </div>
      )}
    </div>
  );
}
