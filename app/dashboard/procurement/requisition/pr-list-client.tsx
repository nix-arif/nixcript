"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deletePurchaseRequisition, type PrListRow } from "@/server/purchase-requisition";
import { hasAccess } from "@/lib/permissions/has-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { PlusIcon, SearchIcon, TrashIcon, FileTextIcon, LinkIcon, AlertCircleIcon, ClockIcon, CheckCircleIcon } from "lucide-react";

const fmt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const PR_STATUS: Record<string, { label: string; className: string }> = {
  draft:             { label: "Draft",             className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted:         { label: "Pending Approval",  className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  approved:          { label: "Approved",          className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  partially_ordered: { label: "Partially Ordered", className: "bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400" },
  ordered:           { label: "Fully Ordered",     className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled:         { label: "Cancelled",         className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

interface Props {
  requisitions: PrListRow[];
  permissions: string[];
}

export function PrListClient({ requisitions, permissions }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canCreate  = hasAccess(permissions, "purchase-order:create");
  const canDelete  = hasAccess(permissions, "purchase-order:delete");
  const canApprove = hasAccess(permissions, "purchase-order:approve");

  const counts = {
    draft:     requisitions.filter((r) => r.status === "draft").length,
    submitted: requisitions.filter((r) => r.status === "submitted").length,
    approved:  requisitions.filter((r) => r.status === "approved").length,
  };

  const filtered = search.trim()
    ? requisitions.filter((r) =>
        r.prNo.toLowerCase().includes(search.toLowerCase()) ||
        (r.salesOrderNo ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : requisitions;

  async function handleDelete(id: string, prNo: string) {
    if (!confirm(`Delete requisition ${prNo}? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await deletePurchaseRequisition(id);
      toast.success("Requisition deleted");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Purchase Requisitions"
        description="Internal requests for procurement. Approved PRs are converted to Purchase Orders."
        action={
          canCreate && (
            <Button size="sm" className="gap-1.5" onClick={() => router.push("/dashboard/procurement/requisition/create")}>
              <PlusIcon className="w-3.5 h-3.5" /> New Requisition
            </Button>
          )
        }
      />

      {/* Pending summary — only shown when there's something to act on */}
      {(counts.draft > 0 || counts.submitted > 0 || counts.approved > 0) && (
        <div className="flex flex-wrap gap-2.5">
          {counts.draft > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/15 flex-1 min-w-48">
              <ClockIcon className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  {counts.draft} draft {counts.draft === 1 ? "requisition" : "requisitions"}
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                  Not yet submitted — open and submit to send for approval.
                </p>
              </div>
            </div>
          )}
          {counts.submitted > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/15 flex-1 min-w-48">
              <AlertCircleIcon className="w-4 h-4 text-purple-600 dark:text-purple-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-purple-800 dark:text-purple-200">
                  {counts.submitted} awaiting approval
                </p>
                <p className="text-[11px] text-purple-700 dark:text-purple-400 mt-0.5">
                  {canApprove
                    ? "Pending your review — approve or reject to proceed."
                    : "Submitted and waiting for a manager to approve."}
                </p>
              </div>
            </div>
          )}
          {counts.approved > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/15 flex-1 min-w-48">
              <CheckCircleIcon className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                  {counts.approved} approved — ready to order
                </p>
                <p className="text-[11px] text-blue-700 dark:text-blue-400 mt-0.5">
                  Convert these to Purchase Orders to place with suppliers.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by PR number or SO number…"
          className="pl-9 h-9 text-sm max-w-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-background p-10 text-center">
          <FileTextIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {search ? "No requisitions match your search" : "No purchase requisitions yet"}
          </p>
          {!search && canCreate && (
            <Button size="sm" className="mt-3 gap-1.5" onClick={() => router.push("/dashboard/procurement/requisition/create")}>
              <PlusIcon className="w-3.5 h-3.5" /> Create first requisition
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-medium">PR No.</th>
                <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Linked SO</th>
                <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Customer PO</th>
                <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Items</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Requested by</th>
                <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Date</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((pr) => {
                const st = PR_STATUS[pr.status] ?? { label: pr.status, className: "bg-muted text-muted-foreground" };
                return (
                  <tr
                    key={pr.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => router.push(`/dashboard/procurement/requisition/${pr.id}`)}
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-sm">
                      <Highlight text={pr.prNo} query={search} />
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {pr.salesOrderNo ? (
                        <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                          <LinkIcon className="w-3 h-3" />
                          <Highlight text={pr.salesOrderNo} query={search} />
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {pr.customerPoNo ? (
                        <span className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          {pr.customerPoNo}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                      {pr.itemCount} item{pr.itemCount !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${st.className}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {pr.requestedByName ?? "—"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {fmt(pr.createdAt)}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {canDelete && pr.status === "draft" && (
                        <button
                          onClick={() => handleDelete(pr.id, pr.prNo)}
                          disabled={deletingId === pr.id}
                          className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
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
