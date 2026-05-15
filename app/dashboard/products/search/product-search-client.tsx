"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getDistinctBrands, searchProducts } from "@/server/products";
import {
  SearchIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
  ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";

type Product = Awaited<ReturnType<typeof searchProducts>>[number];

const PAGE_SIZE = 10;

function highlight(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark
        key={i}
        className="bg-yellow-200 dark:bg-yellow-800/60 text-yellow-900 dark:text-yellow-100 rounded-sm px-0.5"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function getCertStatus(p: Product): "certified" | "expired" | "nocert" {
  if (!p.registrationNo) return "nocert";
  if (p.expiredOn) {
    const parts = p.expiredOn.split("/");
    if (parts.length === 3) {
      const expDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      if (expDate < new Date()) return "expired";
    }
  }
  return "certified";
}

function CertBadge({ status }: { status: "certified" | "expired" | "nocert" }) {
  if (status === "certified")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5">
        <ShieldCheckIcon className="w-3 h-3" /> Certified
      </span>
    );
  if (status === "expired")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded px-1.5 py-0.5">
        <AlertTriangleIcon className="w-3 h-3" /> Expired
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5">
      <ShieldXIcon className="w-3 h-3" /> No cert
    </span>
  );
}

function ProductCard({
  product: p,
  query,
}: {
  product: Product;
  query: string;
}) {
  const status = getCertStatus(p);

  return (
    <div className="bg-background border border-border rounded-xl p-4 flex items-center gap-4 hover:border-border/80 hover:bg-muted/10 transition-colors">
      {/* Image */}
      <div className="w-14 h-14 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0 overflow-hidden">
        <ProductImage productCode={p.productCode} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-xs font-mono text-foreground bg-muted border border-border rounded px-1.5 py-0.5">
            {highlight(p.productCode, query)}
          </span>
          <CertBadge status={status} />
          {p.brand && (
            <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
              {p.brand}
            </span>
          )}
        </div>

        <div className="text-sm text-foreground mb-1.5 truncate">
          {highlight(p.description ?? "—", query)}
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          {p.unitPrice && (
            <span className="font-medium text-foreground">
              RM{" "}
              {Number(p.unitPrice).toLocaleString("en-MY", {
                minimumFractionDigits: 2,
              })}
            </span>
          )}
          {p.registrationNo && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-mono text-blue-600 dark:text-blue-400">
                {p.registrationNo}
              </span>
            </>
          )}
          {status === "certified" && p.validFrom && p.expiredOn && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>
                Valid {p.validFrom} – {p.expiredOn}
              </span>
            </>
          )}
          {status === "expired" && p.expiredOn && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-red-600 dark:text-red-400">
                Expired {p.expiredOn}
              </span>
            </>
          )}
          {status === "nocert" && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="italic">No registration number</span>
            </>
          )}
          {p.supplier && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{highlight(p.supplier, query)}</span>
            </>
          )}
        </div>
      </div>

      <button className="shrink-0 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/60 transition-colors">
        View
      </button>
    </div>
  );
}

export function ProductSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [brand, setBrand] = useState("");
  const [brands, setBrands] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (q: string, b: string) => {
    if (q.trim().length < 3) {
      setResults([]);
      setSearched(false);
      setPage(1);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await searchProducts(q.trim(), b || undefined);
      setResults(res);
      setPage(1);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query, brand), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, brand, doSearch]);

  // Fetch distinct brands on mount
  useEffect(() => {
    async function loadBrands() {
      try {
        const res = await getDistinctBrands();
        setBrands(res);
      } catch {}
    }
    loadBrands();
  }, []);

  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  const paged = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const certified = results.filter(
    (p) => getCertStatus(p) === "certified",
  ).length;
  const expired = results.filter((p) => getCertStatus(p) === "expired").length;
  const nocert = results.filter((p) => getCertStatus(p) === "nocert").length;

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Product search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search by product code, description, supplier or brand
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type at least 3 characters to search…"
          className="w-full h-10 pl-9 pr-24 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          autoFocus
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              setSearched(false);
              inputRef.current?.focus();
            }}
            className="absolute right-16 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
        {searched && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {loading ? "Searching…" : `${results.length} results`}
          </span>
        )}
      </div>

      {/* Hint */}
      {!searched && query.length > 0 && query.length < 3 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
          <span>
            {3 - query.length} more character{3 - query.length > 1 ? "s" : ""}{" "}
            needed
          </span>
        </div>
      )}

      {/* Brand filter */}
      {brands.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">Brand:</span>
          <button
            onClick={() => setBrand("")}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              brand === ""
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted/60",
            )}
          >
            All
          </button>
          {brands.map((b) => (
            <button
              key={b}
              onClick={() => setBrand(b === brand ? "" : b)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                brand === b
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted/60",
              )}
            >
              {b}
            </button>
          ))}
        </div>
      )}

      {/* Stats row */}
      {searched && !loading && results.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-xs text-muted-foreground">
            Matched in product code, description, supplier or brand for{" "}
            <span className="font-medium text-foreground">"{query}"</span>
          </span>
          <div className="flex items-center gap-2 ml-auto">
            {certified > 0 && (
              <span className="text-[10px] bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5">
                {certified} certified
              </span>
            )}
            {expired > 0 && (
              <span className="text-[10px] bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded px-1.5 py-0.5">
                {expired} expired
              </span>
            )}
            {nocert > 0 && (
              <span className="text-[10px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5">
                {nocert} no cert
              </span>
            )}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-background border border-border rounded-xl p-4 flex items-center gap-4 animate-pulse"
            >
              <div className="w-14 h-14 rounded-lg bg-muted shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-muted rounded w-24" />
                <div className="h-3 bg-muted rounded w-48" />
                <div className="h-3 bg-muted rounded w-36" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No results */}
      {searched && !loading && results.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <SearchIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium">No results for "{query}"</div>
          <div className="text-xs mt-1">
            Try a different product code or description
          </div>
        </div>
      )}

      {/* Empty state */}
      {!searched && (
        <div className="text-center py-16 text-muted-foreground">
          <SearchIcon className="w-8 h-8 mx-auto mb-3 opacity-20" />
          <div className="text-sm">Start typing to search products</div>
          <div className="text-xs mt-1">
            Searches product code, description, supplier and brand
          </div>
        </div>
      )}

      {/* Results */}
      {!loading && paged.length > 0 && (
        <div className="space-y-2">
          {paged.map((p) => (
            <ProductCard key={p.id} product={p} query={query} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <span className="text-xs text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}–
            {Math.min(page * PAGE_SIZE, results.length)} of {results.length}{" "}
            results
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 text-xs px-3 py-1.5 border border-border rounded-lg disabled:opacity-40 hover:bg-muted/60 transition-colors"
            >
              <ChevronLeftIcon className="w-3.5 h-3.5" /> Previous
            </button>
            <span className="text-xs text-muted-foreground px-2">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-foreground text-background rounded-lg disabled:opacity-40 hover:opacity-90 transition-colors"
            >
              Next <ChevronRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductImage({ productCode }: { productCode: string }) {
  const [failed, setFailed] = useState(false);
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL;

  // Try common extensions
  const [extIndex, setExtIndex] = useState(0);
  const exts = ["jpg", "jpeg", "png", "webp"];

  console.log(`${base}/${encodeURIComponent(productCode)}.${exts[extIndex]}`);

  if (!base || failed || extIndex >= exts.length) {
    return (
      <div className="w-14 h-14 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
        <ImageIcon className="w-5 h-5 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="w-14 h-14 rounded-lg bg-muted border border-border overflow-hidden shrink-0">
      <Image
        src={`${base}/${encodeURIComponent(productCode)}.${exts[extIndex]}`}
        alt={productCode}
        className="w-full h-full object-cover"
        width={100}
        height={100}
        onError={() => {
          if (extIndex + 1 < exts.length) {
            setExtIndex(extIndex + 1); // try next extension
          } else {
            setFailed(true); // all extensions failed, show placeholder
          }
        }}
      />
    </div>
  );
}
