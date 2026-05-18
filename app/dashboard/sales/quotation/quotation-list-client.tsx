"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getQuotations, deleteQuotation } from "@/server/quotation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, SearchIcon, EyeIcon, TrashIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Quotation = Awaited<ReturnType<typeof getQuotations>>[number];

const fmt = (v: string | number) =>
  `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const STATUS_CONFIG = {
  draft: {
    label: "Draft",
    className:
      "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400",
  },
  final: {
    label: "Final",
    className:
      "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  },
};

interface Props {
  initialQuotations: Quotation[];
}

export function QuotationListClient({ initialQuotations }: Props) {
  const router = useRouter();
  const [quotations, setQuotations] = useState(initialQuotations);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = quotations.filter((q) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const cust = q.customerSnapshot as any;
    return (
      q.quotationNo.toLowerCase().includes(s) ||
      cust?.name?.toLowerCase().includes(s) ||
      cust?.organizationName?.toLowerCase().includes(s) ||
      q.salesPersonName?.toLowerCase().includes(s)
    );
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this quotation?")) return;
    setDeleting(id);
    try {
      await deleteQuotation(id);
      const updated = await getQuotations();
      setQuotations(updated);
      toast.success("Quotation deleted");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Quotations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage and generate customer quotations
          </p>
        </div>
        <Button
          onClick={() => router.push("/dashboard/sales/quotation/new")}
          className="gap-2"
        >
          <PlusIcon className="w-4 h-4" /> New quotation
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by quotation no., customer, sales person..."
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} quotation{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Table */}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1.5fr_2fr_1.2fr_1fr_1fr_90px] px-4 py-2.5 bg-muted/20 border-b border-border">
          {[
            "Quotation no.",
            "Customer",
            "Sales person",
            "Total",
            "Status",
            "",
          ].map((h) => (
            <div
              key={h}
              className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {h}
            </div>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <div className="text-sm font-medium mb-1">No quotations yet</div>
            <div className="text-xs mb-4">
              Create your first quotation to get started
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => router.push("/dashboard/sales/quotation/new")}
            >
              <PlusIcon className="w-3.5 h-3.5" /> New quotation
            </Button>
          </div>
        ) : (
          filtered.map((q, i) => {
            const cust = q.customerSnapshot as any;
            const status =
              STATUS_CONFIG[q.status as keyof typeof STATUS_CONFIG] ??
              STATUS_CONFIG.draft;
            return (
              <div
                key={q.id}
                className={cn(
                  "grid grid-cols-[1.5fr_2fr_1.2fr_1fr_1fr_90px] px-4 py-3 items-center",
                  i < filtered.length - 1 ? "border-b border-border" : "",
                  i % 2 === 1 ? "bg-muted/10" : "",
                )}
              >
                <div>
                  <div className="text-sm font-mono font-medium">
                    {q.quotationNo}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {q.createdAt
                      ? new Date(q.createdAt).toLocaleDateString("en-MY", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : ""}
                  </div>
                </div>
                <div>
                  <div className="text-sm truncate">
                    {cust
                      ? [cust.title, cust.name].filter(Boolean).join(" ")
                      : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {cust?.organizationName ?? ""}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {q.salesPersonName ?? "—"}
                </div>
                <div className="text-sm font-medium tabular-nums">
                  {fmt(q.grandTotal)}
                </div>
                <div>
                  <span
                    className={cn(
                      "text-[11px] font-medium rounded px-2 py-0.5",
                      status.className,
                    )}
                  >
                    {status.label}
                  </span>
                </div>
                <div className="flex items-center gap-1 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground"
                    onClick={() =>
                      router.push(`/dashboard/sales/quotation/${q.id}`)
                    }
                  >
                    <EyeIcon className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    disabled={deleting === q.id}
                    onClick={() => handleDelete(q.id)}
                  >
                    {deleting === q.id ? (
                      <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <TrashIcon className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
