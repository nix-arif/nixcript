"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deleteInvoice,
  sendInvoice,
  markInvoicePaid,
  markInvoiceOverdue,
  cancelInvoice,
  type InvoiceWithDetails,
  type LinkedJournalEntry,
} from "@/server/invoice";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  UserIcon, BuildingIcon, CalendarIcon, PackageIcon,
  SendIcon, CheckIcon, AlertCircleIcon, XIcon, ReceiptIcon, BookOpenIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmtMoney = (v: string | number | null | undefined) =>
  `MYR ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const INV_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400" },
  sent:      { label: "Sent",      className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  paid:      { label: "Paid",      className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  overdue:   { label: "Overdue",   className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
  cancelled: { label: "Cancelled", className: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = INV_STATUS[status] ?? INV_STATUS.draft;
  return <span className={cn("text-[11px] font-medium rounded px-2 py-0.5", cfg.className)}>{cfg.label}</span>;
}

const ENTRY_STATUS: Record<string, { label: string; className: string }> = {
  DRAFT:  { label: "Draft",  className: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400" },
  POSTED: { label: "Posted", className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  VOID:   { label: "Void",   className: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" },
};

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  CAPITAL_INVESTMENT: "Capital Investment",
  SUPPLIER_PAYMENT: "Supplier Payment",
  CUSTOMER_PAYMENT: "Customer Payment",
  REVENUE_RECOGNITION: "Revenue Recognition",
  PURCHASE: "Purchase",
  PAYROLL: "Payroll",
  GENERAL_EXPENSE: "General Expense",
  JOURNAL_ADJUSTMENT: "Journal Adjustment",
  STATUTORY_PAYMENT: "Statutory Payment",
  TAX_PAYMENT: "Tax Payment",
};

export function InvoiceDetailClient({
  invoice,
  permissions,
  currentUserId,
  linkedEntries,
}: {
  invoice: InvoiceWithDetails;
  permissions: string[];
  currentUserId: string;
  linkedEntries: LinkedJournalEntry[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(invoice.status ?? "draft");
  const [actioning, setActioning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { setStatus(invoice.status ?? "draft"); }, [invoice.status]);

  const can = (p: string) => permissions.includes("*") || permissions.includes(p);
  const isOwner = invoice.createdBy === currentUserId;
  const snap = invoice.customerSnapshot as any;

  async function act(key: string, fn: () => Promise<void>, next: string, successMsg: string) {
    setActioning(key);
    try {
      await fn();
      setStatus(next);
      toast.success(successMsg);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${invoice.invoiceNo}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteInvoice(invoice.id);
      toast.success("Invoice deleted");
      router.push("/dashboard/fulfillment/invoice");
    } catch (e: any) {
      toast.error(e.message);
      setDeleting(false);
    }
  }

  const isDraft = status === "draft";
  const isCancelled = status === "cancelled";
  const isPaid = status === "paid";

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={invoice.invoiceNo}
        description={fmtDate(invoice.invoiceDate ?? invoice.createdAt)}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/fulfillment/invoice")} className="gap-1.5">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
            {can("invoice:update") && (
              <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/fulfillment/invoice/${invoice.id}/edit`)} className="gap-1.5">
                <PencilIcon className="w-3.5 h-3.5" /> Edit
              </Button>
            )}
            {(isDraft || isCancelled) && can("invoice:delete") && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                <TrashIcon className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
            <StatusBadge status={status} />
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — customer + items */}
        <div className="lg:col-span-2 space-y-5">
          {snap && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Bill to</h2>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">{snap.title ? `${snap.title} ` : ""}{snap.name}</span>
                </div>
                {snap.organizationName && (
                  <div className="flex items-center gap-2">
                    <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">{snap.organizationName}</span>
                  </div>
                )}
                {snap.organizationAddress && <p className="text-xs text-muted-foreground pl-5">{snap.organizationAddress}</p>}
                {snap.email && <p className="text-xs text-muted-foreground pl-5">{snap.email}</p>}
                {snap.contactNo && <p className="text-xs text-muted-foreground pl-5">{snap.contactNo}</p>}
              </div>
            </section>
          )}

          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Items <span className="font-normal">({invoice.items.length})</span>
            </h2>
            {invoice.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left pb-2 pr-3 w-6">#</th>
                      <th className="text-left pb-2 pr-3 w-20">Code</th>
                      <th className="text-left pb-2 pr-3">Description</th>
                      <th className="text-right pb-2 pr-3 w-12">Qty</th>
                      <th className="text-left pb-2 pr-3 w-12">UOM</th>
                      <th className="text-right pb-2 pr-3 w-24">Unit price</th>
                      <th className="text-right pb-2 w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item) => (
                      <tr key={item.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3 text-muted-foreground">{item.rowNo}</td>
                        <td className="py-2 pr-3 font-mono text-muted-foreground">{item.productCode || "—"}</td>
                        <td className="py-2 pr-3">{item.description || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{item.qty}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{item.uom || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtMoney(item.unitPrice)}</td>
                        <td className="py-2 text-right tabular-nums font-medium">{fmtMoney(item.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {invoice.expenses.length > 0 && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Expenses</h2>
              <div className="space-y-1.5">
                {invoice.expenses.map((exp) => (
                  <div key={exp.id} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{exp.description}</span>
                    <span className="tabular-nums font-mono">{fmtMoney(exp.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {invoice.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{invoice.notes}</p>
            </section>
          )}

          <section className="border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpenIcon className="w-3.5 h-3.5 text-muted-foreground" />
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Linked Journal Entries
                {linkedEntries.length > 0 && (
                  <span className="font-normal ml-1">({linkedEntries.length})</span>
                )}
              </h2>
            </div>
            {linkedEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No journal entries linked to this invoice.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left pb-2 pr-3">Date</th>
                      <th className="text-left pb-2 pr-3">Entry No</th>
                      <th className="text-left pb-2 pr-3">Type</th>
                      <th className="text-left pb-2 pr-3">Status</th>
                      <th className="text-right pb-2 pr-3">Debit</th>
                      <th className="text-right pb-2">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkedEntries.map((entry) => {
                      const eStatus = ENTRY_STATUS[entry.status] ?? ENTRY_STATUS.DRAFT;
                      return (
                        <tr
                          key={entry.id}
                          className="border-b border-border/40 last:border-0 hover:bg-muted/30 cursor-pointer"
                          onClick={() => router.push(`/dashboard/ledger/entries/${entry.id}`)}
                        >
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground">{entry.date}</td>
                          <td className="py-2 pr-3 font-mono">{entry.entryNo}</td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {TRANSACTION_TYPE_LABELS[entry.transactionType] ?? entry.transactionType}
                          </td>
                          <td className="py-2 pr-3">
                            <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5", eStatus.className)}>
                              {eStatus.label}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums font-mono">
                            {parseFloat(entry.totalDebit) > 0 ? fmtMoney(entry.totalDebit) : "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums font-mono">
                            {parseFloat(entry.totalCredit) > 0 ? fmtMoney(entry.totalCredit) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Right — status + pricing + details */}
        <div className="space-y-5">
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status</h2>
            <div className="mb-3"><StatusBadge status={status} /></div>
            <div className="flex flex-col gap-2">
              {isDraft && can("invoice:update") && isOwner && (
                <Button size="sm" className="w-full gap-1.5 h-8 text-xs" disabled={!!actioning}
                  onClick={() => act("send", () => sendInvoice(invoice.id), "sent", "Invoice sent")}>
                  <SendIcon className="w-3.5 h-3.5" />
                  {actioning === "send" ? "Sending…" : "Mark as Sent"}
                </Button>
              )}
              {(status === "sent" || status === "overdue") && can("invoice:update") && (
                <Button size="sm" className="w-full gap-1.5 h-8 text-xs bg-green-600 hover:bg-green-700 text-white" disabled={!!actioning}
                  onClick={() => act("paid", () => markInvoicePaid(invoice.id), "paid", "Invoice marked as paid")}>
                  <CheckIcon className="w-3.5 h-3.5" />
                  {actioning === "paid" ? "Updating…" : "Mark as Paid"}
                </Button>
              )}
              {status === "sent" && can("invoice:update") && (
                <Button size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs text-red-600 hover:text-red-600 border-red-200 dark:border-red-900" disabled={!!actioning}
                  onClick={() => act("overdue", () => markInvoiceOverdue(invoice.id), "overdue", "Invoice marked as overdue")}>
                  <AlertCircleIcon className="w-3.5 h-3.5" />
                  {actioning === "overdue" ? "Updating…" : "Mark as Overdue"}
                </Button>
              )}
              {!isPaid && !isCancelled && !isDraft && can("invoice:update") && (
                <Button size="sm" variant="outline" className="w-full gap-1.5 h-8 text-xs text-destructive hover:text-destructive border-destructive/30" disabled={!!actioning}
                  onClick={() => act("cancel", () => cancelInvoice(invoice.id), "cancelled", "Invoice cancelled")}>
                  <XIcon className="w-3.5 h-3.5" />
                  {actioning === "cancel" ? "Cancelling…" : "Cancel Invoice"}
                </Button>
              )}
            </div>
          </section>

          <section className="border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pricing</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{fmtMoney(invoice.subtotal)}</span>
              </div>
              {parseFloat(invoice.overallDiscountAmt ?? "0") > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="tabular-nums text-red-600">−{fmtMoney(invoice.overallDiscountAmt)}</span>
                </div>
              )}
              {parseFloat(invoice.sstPct ?? "0") > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SST ({invoice.sstPct}%)</span>
                  <span className="tabular-nums">{fmtMoney(invoice.sst)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-border pt-2 mt-2">
                <span>Grand total</span>
                <span className="tabular-nums">{fmtMoney(invoice.grandTotal)}</span>
              </div>
              {invoice.profit !== null && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Profit</span>
                  <span className={cn("tabular-nums font-mono", parseFloat(invoice.profit ?? "0") >= 0 ? "text-green-600" : "text-red-600")}>
                    {parseFloat(invoice.profit ?? "0") >= 0 ? "+" : ""}{fmtMoney(invoice.profit)}
                  </span>
                </div>
              )}
              {invoice.paidAt && (
                <div className="flex justify-between text-xs border-t border-border pt-2 mt-2">
                  <span className="text-muted-foreground">Paid on</span>
                  <span className="tabular-nums">{fmtDate(invoice.paidAt)}</span>
                </div>
              )}
            </div>
          </section>

          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Details</h2>
            <div className="flex items-start gap-2">
              <ReceiptIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground">Items</p>
                <p className="text-xs">{invoice.items.length} line{invoice.items.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            {invoice.dueDate && (
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Due date</p>
                  <p className="text-xs">{fmtDate(invoice.dueDate)}</p>
                </div>
              </div>
            )}
            {invoice.paymentTerms && (
              <div className="flex items-start gap-2">
                <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Payment terms</p>
                  <p className="text-xs">{invoice.paymentTerms}</p>
                </div>
              </div>
            )}
            {(invoice.salesOrderNo || invoice.deliveryOrderNo || invoice.customerPoNo) && (
              <div className="border-t border-border/50 pt-2.5 space-y-2">
                {invoice.salesOrderNo && (
                  <div className="flex items-start gap-2">
                    <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Sales order</p>
                      <p className="text-xs font-mono">{invoice.salesOrderNo}</p>
                    </div>
                  </div>
                )}
                {invoice.deliveryOrderNo && (
                  <div className="flex items-start gap-2">
                    <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Delivery order</p>
                      <p className="text-xs font-mono">{invoice.deliveryOrderNo}</p>
                    </div>
                  </div>
                )}
                {invoice.customerPoNo && (
                  <div className="flex items-start gap-2">
                    <PackageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Customer PO</p>
                      <p className="text-xs font-mono">{invoice.customerPoNo}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="border-t border-border/50 pt-2.5 space-y-2">
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Created</p>
                  <p className="text-xs">{fmtDate(invoice.createdAt)}</p>
                </div>
              </div>
              {invoice.createdByName && (
                <div className="flex items-start gap-2">
                  <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Prepared by</p>
                    <p className="text-xs">{invoice.createdByName}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
