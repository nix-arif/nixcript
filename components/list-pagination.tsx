"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ListPaginationProps {
  /** 1-based current page (already clamped to [1, totalPages]) */
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  /** Noun for the "Showing x–y of z <label>" summary, e.g. "customers" */
  itemLabel?: string;
  className?: string;
}

/** Page numbers to render: first, last, and a window around the current page,
 *  with "…" wherever a run of pages is skipped. */
function pageItems(page: number, totalPages: number): (number | "…")[] {
  const items: (number | "…")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) {
      const prev = items[items.length - 1];
      if (typeof prev === "number" && p - prev > 1) items.push("…");
      items.push(p);
    }
  }
  return items;
}

export function ListPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  itemLabel,
  className,
}: ListPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className={cn("flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-2", className)}>
      <p className="text-xs text-muted-foreground tabular-nums text-center md:text-left">
        Showing {from}–{to} of {totalItems}
        {itemLabel ? ` ${itemLabel}` : ""}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center justify-between md:justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-9 md:h-7 px-3 md:px-2 gap-1 text-xs"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            <span className="md:hidden">Prev</span>
          </Button>

          {/* Mobile: compact indicator instead of page buttons */}
          <span className="md:hidden text-xs text-muted-foreground tabular-nums">
            Page {page} of {totalPages}
          </span>

          <div className="hidden md:flex items-center gap-1">
            {pageItems(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={`gap-${i}`} className="text-xs text-muted-foreground px-1">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className="h-7 min-w-7 px-1.5 text-xs tabular-nums"
                  onClick={() => onPageChange(p)}
                  aria-current={p === page ? "page" : undefined}
                >
                  {p}
                </Button>
              ),
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 md:h-7 px-3 md:px-2 gap-1 text-xs"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            <span className="md:hidden">Next</span>
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
