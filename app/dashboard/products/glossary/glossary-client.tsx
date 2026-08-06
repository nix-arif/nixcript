"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchIcon, PackageIcon, ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { getGlossaryByLetter, searchGlossary } from "@/server/products";
import type { GlossaryProduct } from "@/server/products";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// ── Types ──────────────────────────────────────────────────────────────────

type IndexEntry = { letter: string; count: number };
type PaneState =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "letter"; letter: string; rows: GlossaryProduct[]; total: number; page: number }
  | { kind: "search"; query: string; rows: GlossaryProduct[]; total: number; page: number };

const PAGE_SIZE = 100;

// ── Image ──────────────────────────────────────────────────────────────────

function ProductThumb({ productCode, imageUploadedAt }: {
  productCode: string;
  imageUploadedAt?: Date | string | null;
}) {
  const [extIdx, setExtIdx] = useState(0);
  const [failed, setFailed]   = useState(false);
  const exts = ["jpg", "jpeg", "png", "webp"];
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL;
  const v    = imageUploadedAt ? new Date(imageUploadedAt).getTime() : null;

  if (!base || failed || extIdx >= exts.length) {
    return (
      <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
        <PackageIcon className="w-4 h-4 text-muted-foreground/40" />
      </div>
    );
  }
  return (
    <img
      src={`${base}/${productCode}.${exts[extIdx]}${v ? `?v=${v}` : ""}`}
      alt={productCode}
      className="w-10 h-10 rounded-md object-contain bg-muted shrink-0"
      onError={() => extIdx + 1 < exts.length ? setExtIdx((i) => i + 1) : setFailed(true)}
    />
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtPrice(price: string | null | undefined, currency: string | null | undefined) {
  if (!price || isNaN(parseFloat(price))) return null;
  return `${currency ?? "MYR"} ${parseFloat(price).toLocaleString("en-MY", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

const ALL_LETTERS = ["#", ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];

// ── Highlight ──────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-500/40 text-foreground rounded-sm px-0.5 not-italic">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

// ── Product list ───────────────────────────────────────────────────────────

function ProductRow({ p, last, query, onOpen }: { p: GlossaryProduct; last: boolean; query?: string; onOpen: () => void }) {
  const price = fmtPrice(p.sellingUnitPrice, p.sellingPriceCurrency);
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", !last && "border-b border-border/40")}>
      <button
        onClick={onOpen}
        className="shrink-0 rounded-md ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer hover:opacity-75 transition-opacity"
        title="View product"
      >
        <ProductThumb productCode={p.productCode} imageUploadedAt={p.imageUploadedAt} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono font-medium">
          <Highlight text={p.productCode} query={query} />
        </div>
        {p.description && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate uppercase" title={p.description}>
            <Highlight text={p.description} query={query} />
          </div>
        )}
      </div>
      {p.brand && (
        <div className="hidden sm:block text-xs text-muted-foreground w-28 truncate shrink-0 text-right lowercase">
          <Highlight text={p.brand} query={query} />
        </div>
      )}
      {p.uom && (
        <div className="hidden md:flex w-14 shrink-0 justify-end">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium uppercase">
            {p.uom}
          </span>
        </div>
      )}
      <div className="w-28 shrink-0 text-right">
        {price && <span className="text-xs font-medium tabular-nums">{price}</span>}
      </div>
    </div>
  );
}

function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  const [draft, setDraft] = useState(String(page));

  useEffect(() => { setDraft(String(page)); }, [page]);

  if (totalPages <= 1) return null;

  function commit() {
    const n = Math.trunc(Number(draft));
    if (Number.isFinite(n) && n >= 1 && n <= totalPages && n !== page) {
      onChange(n);
    } else {
      setDraft(String(page));
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border/40 text-xs text-muted-foreground">
      <span>{((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeftIcon className="w-3.5 h-3.5" />
        </Button>
        <span className="px-2 flex items-center gap-1">
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.currentTarget.blur(); }
              if (e.key === "Escape") { setDraft(String(page)); e.currentTarget.blur(); }
            }}
            className="h-6 w-12 px-1.5 text-center text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span>/ {totalPages}</span>
        </span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          <ChevronRightIcon className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Product dialog ─────────────────────────────────────────────────────────

function ProductImage({ productCode, imageUploadedAt, className }: {
  productCode: string;
  imageUploadedAt?: Date | string | null;
  className?: string;
}) {
  const [extIdx, setExtIdx] = useState(0);
  const [failed, setFailed]   = useState(false);
  const exts = ["jpg", "jpeg", "png", "webp"];
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL;
  const v    = imageUploadedAt ? new Date(imageUploadedAt).getTime() : null;

  useEffect(() => { setExtIdx(0); setFailed(false); }, [productCode]);

  const imgCls = className ?? "w-full aspect-square rounded-xl object-contain bg-muted";
  const divCls = cn(className ?? "w-full aspect-square rounded-xl bg-muted", "flex items-center justify-center");

  if (!base || failed || extIdx >= exts.length) {
    return (
      <div className={divCls}>
        <PackageIcon className="w-8 h-8 text-muted-foreground/30" />
      </div>
    );
  }
  return (
    <img
      src={`${base}/${productCode}.${exts[extIdx]}${v ? `?v=${v}` : ""}`}
      alt={productCode}
      className={imgCls}
      onError={() => extIdx + 1 < exts.length ? setExtIdx((i) => i + 1) : setFailed(true)}
    />
  );
}

function ProductDialog({ rows, index, onClose, onNavigate }: {
  rows: GlossaryProduct[];
  index: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
}) {
  const p       = rows[index];
  const price   = fmtPrice(p?.sellingUnitPrice, p?.sellingPriceCurrency);
  const hasPrev = index > 0;
  const hasNext = index < rows.length - 1;

  const PERSPECTIVE = 1400;
  const RADIUS      = 155;
  const SLOT_H      = 148;
  const ANGLE       = 28;
  const BUFFER      = 4;
  const start       = Math.max(0, index - BUFFER);
  const end         = Math.min(rows.length - 1, index + BUFFER);

  useEffect(() => {
    let last = 0;
    function onWheel(e: WheelEvent) {
      const now = Date.now();
      if (now - last < 200) return;
      last = now;
      if (e.deltaY > 0 && hasNext) onNavigate(index + 1);
      if (e.deltaY < 0 && hasPrev) onNavigate(index - 1);
    }
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [index, hasPrev, hasNext, onNavigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown" && hasNext) onNavigate(index + 1);
      if (e.key === "ArrowUp"   && hasPrev) onNavigate(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, hasPrev, hasNext, onNavigate]);

  if (!p) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="border-0 shadow-none p-0 gap-0 overflow-hidden [&>button]:z-20 [&>button]:text-white/60 [&>button]:hover:text-white [&>button]:bg-transparent"
        style={{ background: "transparent", width: 620, maxWidth: "96vw", height: "min(960px, 93svh)" }}
      >
        <DialogTitle className="sr-only">
          {p.productCode}{p.description ? ` — ${p.description}` : ""}
        </DialogTitle>

        {/* ── Product showcase — top 65% ── */}
        <div style={{
          position: "absolute",
          top: 0, left: 0, right: 0, height: "65%",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "16px 40px 12px",
          gap: 14,
          color: "rgba(255,255,255,0.92)",
          userSelect: "none",
        }}>
          <ProductImage
            key={p.productCode}
            productCode={p.productCode}
            imageUploadedAt={p.imageUploadedAt}
            className="w-full h-110 object-contain"
          />

          <div style={{ textAlign: "center", width: "100%" }}>
            <div style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 26, fontWeight: 700, lineHeight: 1.1,
              color: "white", letterSpacing: "0.02em",
            }}>
              {p.productCode}
            </div>

            {p.description && (
              <div
                title={p.description}
                style={{
                  fontSize: 13, color: "rgba(255,255,255,0.52)",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                  lineHeight: 1.45, marginTop: 8,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {p.description}
              </div>
            )}

            {(p.brand || p.uom || price) && (
              <div style={{
                display: "flex", gap: 8, alignItems: "center",
                justifyContent: "center", flexWrap: "wrap", marginTop: 12,
              }}>
                {p.brand && (
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.38)", textTransform: "lowercase" }}>
                    {p.brand}
                  </span>
                )}
                {p.uom && (
                  <span style={{
                    background: "rgba(255,255,255,0.14)", padding: "3px 10px",
                    borderRadius: 5, fontSize: 11,
                    color: "rgba(255,255,255,0.85)", textTransform: "uppercase", fontWeight: 500,
                  }}>
                    {p.uom}
                  </span>
                )}
                {price && (
                  <span style={{
                    fontSize: 15, fontVariantNumeric: "tabular-nums",
                    fontWeight: 700, color: "white",
                  }}>
                    {price}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Drum picker — bottom 35% ── */}
        <div style={{
          position: "absolute",
          top: "65%", left: 0, right: 0, bottom: 0,
          perspective: PERSPECTIVE,
          overflow: "hidden",
          userSelect: "none",
          maskImage: "linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)",
        }}>
          {/* Center selection band */}
          <div aria-hidden style={{
            position: "absolute",
            top: "50%", left: 12, right: 12,
            height: SLOT_H, marginTop: -(SLOT_H / 2),
            background: "rgba(255,255,255,0.07)",
            borderRadius: 12,
            zIndex: 9, pointerEvents: "none",
          }} />

          {/* Counter */}
          <div aria-hidden style={{
            position: "absolute", bottom: 8, left: 0, right: 0,
            textAlign: "center", zIndex: 11,
            fontSize: 11, color: "rgba(255,255,255,0.28)",
          }}>
            {index + 1} / {rows.length} · ↑↓ or scroll
          </div>

          {/* Drum rotor */}
          <div style={{
            position: "absolute",
            top: "50%", left: 0, right: 0, height: 0,
            transformStyle: "preserve-3d",
            transform: `rotateX(${index * ANGLE}deg)`,
            transition: "transform 0.32s cubic-bezier(0.2, 1, 0.3, 1)",
          }}>
            {Array.from({ length: end - start + 1 }, (_, i) => {
              const absIdx   = start + i;
              const prod     = rows[absIdx];
              const offset   = absIdx - index;
              const isCenter = offset === 0;

              return (
                <div
                  key={absIdx}
                  onClick={() => offset !== 0 && onNavigate(absIdx)}
                  style={{
                    position: "absolute",
                    left: 0, right: 0,
                    height: SLOT_H, marginTop: -(SLOT_H / 2),
                    transform: `rotateX(${-absIdx * ANGLE}deg) translateZ(${RADIUS}px)`,
                    backfaceVisibility: "hidden",
                    cursor: offset !== 0 ? "pointer" : "default",
                    borderRadius: 12,
                    background: isCenter
                      ? "rgba(255,255,255,0.09)"
                      : `rgba(255,255,255,${Math.max(0.01, 0.035 - Math.abs(offset) * 0.006)})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "8px 20px",
                  }}
                >
                  <div style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: isCenter ? 20 : 13,
                    fontWeight: isCenter ? 700 : 400,
                    lineHeight: 1.1,
                    color: isCenter ? "white" : `rgba(255,255,255,${Math.max(0.15, 0.55 - Math.abs(offset) * 0.12)})`,
                    textAlign: "center",
                    letterSpacing: "0.02em",
                  }}>
                    {prod.productCode}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function GlossaryClient({ index }: { index: IndexEntry[] }) {
  const [search, setSearch]   = useState("");
  const [pane, setPane]       = useState<PaneState>({ kind: "empty" });
  const [dialogIdx, setDialogIdx] = useState<number | null>(null);
  const debouncedSearch       = useDebounce(search, 350);
  const presentLetters        = new Set(index.map((e) => e.letter));
  const totalProducts         = index.reduce((s, e) => s + e.count, 0);
  const listTopRef            = useRef<HTMLDivElement>(null);

  function scrollToList() {
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Load a letter
  const loadLetter = useCallback(async (letter: string, page = 1) => {
    setPane({ kind: "loading" });
    const result = await getGlossaryByLetter(letter, page, PAGE_SIZE);
    setPane({ kind: "letter", letter, page, ...result });
    if (page > 1) scrollToList();
  }, []);

  // Search effect
  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setPane((prev) => prev.kind === "search" ? { kind: "empty" } : prev);
      return;
    }
    let cancelled = false;
    setPane({ kind: "loading" });
    searchGlossary(debouncedSearch, 1, PAGE_SIZE).then((result) => {
      if (!cancelled) setPane({ kind: "search", query: debouncedSearch, page: 1, ...result });
    });
    return () => { cancelled = true; };
  }, [debouncedSearch]);

  const handleSearchPage = useCallback(async (page: number) => {
    if (pane.kind !== "search") return;
    setPane({ kind: "loading" });
    const result = await searchGlossary(pane.query, page, PAGE_SIZE);
    setPane({ kind: "search", query: pane.query, page, ...result });
    scrollToList();
  }, [pane]);

  const activeLetter = pane.kind === "letter" ? pane.letter : null;

  return (
    <div className="min-h-svh overflow-x-clip" style={{ background: "var(--color-background-secondary)" }}>

      {/* Header */}
      <div className="p-6 pb-3">
        <PageHeader
          title="Product Glossary"
          description={`${totalProducts.toLocaleString()} products · A–Z index`}
        />
        <div className="relative w-80 mt-4">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <Input
            placeholder="Search code, description, brand…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="pl-8 h-9 text-sm"
          />
        </div>
      </div>

      {/* Letter bar */}
      <div className="border-y border-border/60 bg-background px-6 py-2">
        <div className="flex flex-wrap items-center gap-0.5">
          {ALL_LETTERS.map((letter) => {
            const entry  = index.find((e) => e.letter === letter);
            const active = presentLetters.has(letter);
            const current = activeLetter === letter;
            return (
              <button
                key={letter}
                disabled={!active || pane.kind === "loading"}
                onClick={() => { setSearch(""); loadLetter(letter); }}
                className={cn(
                  "w-7 h-7 rounded text-xs font-semibold transition-colors",
                  !active   && "text-muted-foreground/25 cursor-default",
                  active && !current && "text-muted-foreground hover:bg-muted hover:text-foreground",
                  current   && "bg-primary text-primary-foreground",
                )}
                title={entry ? `${letter}: ${entry.count.toLocaleString()} products` : undefined}
              >
                {letter}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content pane */}
      <div className="px-6 py-6" ref={listTopRef}>

        {/* Empty state */}
        {pane.kind === "empty" && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <PackageIcon className="w-5 h-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">
              Select a letter above or search to browse products.
            </p>
          </div>
        )}

        {/* Loading */}
        {pane.kind === "loading" && (
          <div className="flex items-center justify-center py-20">
            <LoaderCircleIcon className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Letter results */}
        {pane.kind === "letter" && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-base font-bold shrink-0">
                {pane.letter}
              </div>
              <div className="h-px flex-1 bg-border/60" />
              <span className="text-xs text-muted-foreground">{pane.total.toLocaleString()} products</span>
            </div>
            <div className="bg-background border border-border/50 rounded-xl overflow-x-auto">
              {pane.rows.map((p, i) => (
                <ProductRow key={p.productCode} p={p} last={i === pane.rows.length - 1} onOpen={() => setDialogIdx(i)} />
              ))}
              <Pagination
                page={pane.page}
                total={pane.total}
                pageSize={PAGE_SIZE}
                onChange={(p) => loadLetter(pane.letter, p)}
              />
            </div>
          </div>
        )}

        {/* Search results */}
        {pane.kind === "search" && (
          <div>
            <p className="text-xs text-muted-foreground mb-4">
              {pane.total.toLocaleString()} result{pane.total !== 1 ? "s" : ""} for <span className="font-medium text-foreground">"{pane.query}"</span>
            </p>
            {pane.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No products match your search.</p>
            ) : (
              <div className="bg-background border border-border/50 rounded-xl overflow-x-auto">
                {pane.rows.map((p, i) => (
                  <ProductRow key={p.productCode} p={p} last={i === pane.rows.length - 1} query={pane.query} onOpen={() => setDialogIdx(i)} />
                ))}
                <Pagination
                  page={pane.page}
                  total={pane.total}
                  pageSize={PAGE_SIZE}
                  onChange={handleSearchPage}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transparent drum overlay */}
      {dialogIdx !== null && (pane.kind === "letter" || pane.kind === "search") && (
        <ProductDialog
          rows={pane.rows}
          index={dialogIdx}
          onClose={() => setDialogIdx(null)}
          onNavigate={setDialogIdx}
        />
      )}
    </div>
  );
}
