// "use client";

// import { useState, useEffect, useRef, useCallback } from "react";
// import { searchProducts, getDistinctBrands } from "@/server/products";
// import {
//   SearchIcon,
//   ShieldCheckIcon,
//   ShieldXIcon,
//   AlertTriangleIcon,
//   ChevronLeftIcon,
//   ChevronRightIcon,
//   XIcon,
//   ImageIcon,
//   ExternalLinkIcon,
// } from "lucide-react";
// import { cn } from "@/lib/utils";
// import Link from "next/link";

// type Product = Awaited<ReturnType<typeof searchProducts>>[number];

// const PAGE_SIZE = 10;

// // 1. Standard Numerical Format: DD/MM/YYYY (30/04/2026)
// function malaysiaDate(date: Date) {
//   if (!date) return "n.a";
//   return new Intl.DateTimeFormat("ms-MY", {
//     day: "2-digit",
//     month: "2-digit",
//     year: "numeric",
//   })
//     .format(date)
//     .toString();
// }

// function highlight(text: string, query: string): React.ReactNode {
//   if (!query || !text) return text;
//   const regex = new RegExp(
//     `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
//     "gi",
//   );
//   const parts = text.split(regex);
//   return parts.map((part, i) =>
//     regex.test(part) ? (
//       <mark
//         key={i}
//         className="bg-yellow-200 dark:bg-yellow-800/60 text-yellow-900 dark:text-yellow-100 rounded-sm px-0.5"
//       >
//         {part}
//       </mark>
//     ) : (
//       part
//     ),
//   );
// }

// function getCertStatus(p: Product): "certified" | "expired" | "nocert" {
//   if (!p.mdaRegistrationNo) return "nocert";
//   if (p.mdaExpiredOn) {
//     const parts = p.mdaExpiredOn.split("/");
//     if (parts.length === 3) {
//       const expDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
//       if (expDate < new Date()) return "expired";
//     }
//   }
//   return "certified";
// }

// function CertBadge({ status }: { status: "certified" | "expired" | "nocert" }) {
//   if (status === "certified")
//     return (
//       <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5">
//         <ShieldCheckIcon className="w-3 h-3" /> Certified
//       </span>
//     );
//   if (status === "expired")
//     return (
//       <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded px-1.5 py-0.5">
//         <AlertTriangleIcon className="w-3 h-3" /> Expired
//       </span>
//     );
//   return (
//     <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5">
//       <ShieldXIcon className="w-3 h-3" /> No cert
//     </span>
//   );
// }

// function ProductImage({
//   productCode,
//   className,
// }: {
//   productCode: string;
//   className?: string;
// }) {
//   const [failed, setFailed] = useState(false);
//   const [extIndex, setExtIndex] = useState(0);
//   const exts = ["jpg", "jpeg", "png", "webp"];
//   const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL;

//   if (!base || failed || extIndex >= exts.length) {
//     return (
//       <div
//         className={cn("flex items-center justify-center bg-muted", className)}
//       >
//         <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
//       </div>
//     );
//   }

//   return (
//     <img
//       src={`${base}/${encodeURIComponent(productCode)}.${exts[extIndex]}`}
//       alt={productCode}
//       className={cn("object-contain", className)}
//       onError={() => {
//         if (extIndex + 1 < exts.length) setExtIndex((i) => i + 1);
//         else setFailed(true);
//       }}
//     />
//   );
// }

// // ── Product detail slide-over ─────────────────────────────────────────────────
// function ProductSlideOver({
//   product: p,
//   onClose,
// }: {
//   product: Product;
//   onClose: () => void;
// }) {
//   const status = getCertStatus(p);

//   // Close on Escape
//   useEffect(() => {
//     const handler = (e: KeyboardEvent) => {
//       if (e.key === "Escape") onClose();
//     };
//     window.addEventListener("keydown", handler);
//     return () => window.removeEventListener("keydown", handler);
//   }, [onClose]);

//   const DetailRow = ({
//     label,
//     value,
//     mono,
//     link,
//   }: {
//     label: string;
//     value?: string | null;
//     mono?: boolean;
//     link?: boolean;
//   }) => {
//     if (!value) return null;
//     return (
//       <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
//         <span className="text-xs text-muted-foreground shrink-0">{label}</span>
//         {link ? (
//           <Link
//             href={value}
//             target="_blank"
//             rel="noreferrer"
//             className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
//           >
//             {value.split("/").pop()} <ExternalLinkIcon className="w-3 h-3" />
//           </Link>
//         ) : (
//           <span
//             className={cn(
//               "text-xs text-right ml-4",
//               mono
//                 ? "font-mono text-blue-600 dark:text-blue-400"
//                 : "text-foreground",
//             )}
//           >
//             {value}
//           </span>
//         )}
//       </div>
//     );
//   };

//   return (
//     <>
//       {/* Backdrop */}
//       <div
//         className="fixed inset-0 bg-black/40 z-40 transition-opacity"
//         onClick={onClose}
//       />

//       {/* Panel */}
//       <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-background border-l border-border z-50 flex flex-col overflow-hidden">
//         {/* Header */}
//         <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
//           <div className="text-sm font-medium">Product detail</div>
//           <button
//             onClick={onClose}
//             className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
//             aria-label="Close"
//           >
//             <XIcon className="w-4 h-4" />
//           </button>
//         </div>

//         {/* Scrollable content */}
//         <div className="flex-1 overflow-y-auto">
//           {/* Product image */}
//           <div className="w-full aspect-square bg-muted border-b border-border overflow-hidden">
//             <ProductImage
//               productCode={p.productCode}
//               className="w-full h-full"
//             />
//           </div>

//           <div className="p-4 space-y-4">
//             {/* Name + badges */}
//             <div>
//               <div className="font-medium text-sm leading-snug mb-2">
//                 {p.description ?? "—"}
//               </div>
//               <div className="flex items-center gap-2 flex-wrap">
//                 <span className="text-xs font-mono text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5">
//                   {p.productCode}
//                 </span>
//                 <CertBadge status={status} />
//                 {p.brand && (
//                   <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
//                     {p.brand}
//                   </span>
//                 )}
//               </div>
//             </div>

//             {/* Price + UOM */}
//             <div className="grid grid-cols-2 gap-2">
//               <div className="bg-muted/50 rounded-lg p-3">
//                 <div className="text-xs text-muted-foreground mb-1">
//                   Unit price
//                 </div>
//                 <div className="text-base font-medium">
//                   {p.unitPrice
//                     ? `RM ${Number(p.unitPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
//                     : "—"}
//                 </div>
//               </div>
//               <div className="bg-muted/50 rounded-lg p-3">
//                 <div className="text-xs text-muted-foreground mb-1">UOM</div>
//                 <div className="text-base font-medium">{p.uom ?? "—"}</div>
//               </div>
//             </div>

//             {/* MDA Certificate */}
//             {(p.mdaRegistrationNo ||
//               p.mdaValidFrom ||
//               p.mdaExpiredOn ||
//               p.mdaPdfFile ||
//               p.mdaPageNo) && (
//               <div className="border border-border rounded-lg overflow-hidden">
//                 <div className="px-3 py-2 bg-muted/40 border-b border-border">
//                   <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
//                     MDA certificate
//                   </span>
//                 </div>
//                 <div className="px-3 py-1">
//                   <DetailRow
//                     label="Registration no."
//                     value={p.mdaRegistrationNo}
//                     mono
//                   />
//                   <DetailRow
//                     label="Valid from"
//                     value={malaysiaDate(new Date(p.mdaValidFrom))}
//                   />
//                   <DetailRow label="Expired on" value={p.mdaExpiredOn} />
//                   {status === "expired" && p.mdaExpiredOn && (
//                     <div className="py-2 border-b border-border/50">
//                       <span className="text-xs text-red-600 dark:text-red-400">
//                         Certificate has expired
//                       </span>
//                     </div>
//                   )}
//                   <DetailRow label="Page no." value={p.mdaPageNo} />
//                   <DetailRow label="PDF file" value={p.mdaPdfFile} link />
//                 </div>
//               </div>
//             )}

//             {/* Supplier info */}
//             {(p.supplier || p.brand) && (
//               <div className="border border-border rounded-lg overflow-hidden">
//                 <div className="px-3 py-2 bg-muted/40 border-b border-border">
//                   <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
//                     Supplier info
//                   </span>
//                 </div>
//                 <div className="px-3 py-1">
//                   <DetailRow label="Supplier" value={p.supplier} />
//                   <DetailRow label="Brand" value={p.brand} />
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>
//       </div>
//     </>
//   );
// }

// // ── Product card ──────────────────────────────────────────────────────────────
// function ProductCard({
//   product: p,
//   query,
//   onView,
// }: {
//   product: Product;
//   query: string;
//   onView: (p: Product) => void;
// }) {
//   const status = getCertStatus(p);

//   return (
//     <div className="bg-background border border-border rounded-xl p-4 flex items-center gap-4 hover:border-border/80 hover:bg-muted/10 transition-colors">
//       <div className="w-14 h-14 rounded-lg bg-muted border border-border overflow-hidden shrink-0">
//         <ProductImage productCode={p.productCode} imageUploadedAt={p.imageUploadedAt} className="w-full h-full" />
//       </div>

//       <div className="flex-1 min-w-0">
//         <div className="flex items-center gap-2 mb-1.5 flex-wrap">
//           <span className="text-xs font-mono text-foreground bg-muted border border-border rounded px-1.5 py-0.5">
//             {highlight(p.productCode, query)}
//           </span>
//           <CertBadge status={status} />
//           {p.brand && (
//             <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
//               {p.brand}
//             </span>
//           )}
//         </div>
//         <div className="text-sm text-foreground mb-1.5 truncate">
//           {highlight(p.description ?? "—", query)}
//         </div>
//         <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
//           {p.unitPrice && (
//             <span className="font-medium text-foreground">
//               RM{" "}
//               {Number(p.unitPrice).toLocaleString("en-MY", {
//                 minimumFractionDigits: 2,
//               })}
//             </span>
//           )}
//           {p.mdaRegistrationNo && (
//             <>
//               <span className="text-muted-foreground/40">·</span>
//               <span className="font-mono text-blue-600 dark:text-blue-400">
//                 {p.mdaRegistrationNo}
//               </span>
//             </>
//           )}
//           {status === "certified" && p.mdaValidFrom && p.mdaExpiredOn && (
//             <>
//               <span className="text-muted-foreground/40">·</span>
//               <span>
//                 Valid {malaysiaDate(new Date(p.mdaValidFrom))} –{" "}
//                 {malaysiaDate(new Date(p.mdaExpiredOn))}
//               </span>
//             </>
//           )}
//           {status === "expired" && p.mdaExpiredOn && (
//             <>
//               <span className="text-muted-foreground/40">·</span>
//               <span className="text-red-600 dark:text-red-400">
//                 Expired {malaysiaDate(new Date(p.mdaExpiredOn))}
//               </span>
//             </>
//           )}
//           {status === "nocert" && (
//             <>
//               <span className="text-muted-foreground/40">·</span>
//               <span className="italic">No registration number</span>
//             </>
//           )}
//           {p.supplier && (
//             <>
//               <span className="text-muted-foreground/40">·</span>
//               <span>{highlight(p.supplier, query)}</span>
//             </>
//           )}
//         </div>
//       </div>

//       <button
//         onClick={() => onView(p)}
//         className="shrink-0 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/60 transition-colors"
//       >
//         View
//       </button>
//     </div>
//   );
// }

// // ── Main component ────────────────────────────────────────────────────────────
// export function ProductSearch() {
//   const [query, setQuery] = useState("");
//   const [brand, setBrand] = useState("");
//   const [brands, setBrands] = useState<string[]>([]);
//   const [results, setResults] = useState<Product[]>([]);
//   const [loading, setLoading] = useState(false);
//   const [searched, setSearched] = useState(false);
//   const [page, setPage] = useState(1);
//   const [selected, setSelected] = useState<Product | null>(null);
//   const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
//   const inputRef = useRef<HTMLInputElement>(null);

//   useEffect(() => {
//     getDistinctBrands()
//       .then(setBrands)
//       .catch(() => {});
//   }, []);

//   const doSearch = useCallback(async (q: string, b: string) => {
//     if (q.trim().length < 3) {
//       setResults([]);
//       setSearched(false);
//       setPage(1);
//       return;
//     }
//     setLoading(true);
//     setSearched(true);
//     try {
//       const res = await searchProducts(q.trim(), b || undefined);
//       setResults(res);
//       setPage(1);
//     } catch {
//       setResults([]);
//     } finally {
//       setLoading(false);
//     }
//   }, []);

//   useEffect(() => {
//     if (debounceRef.current) clearTimeout(debounceRef.current);
//     debounceRef.current = setTimeout(() => doSearch(query, brand), 400);
//     return () => {
//       if (debounceRef.current) clearTimeout(debounceRef.current);
//     };
//   }, [query, brand, doSearch]);

//   const totalPages = Math.ceil(results.length / PAGE_SIZE);
//   const paged = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
//   const certified = results.filter(
//     (p) => getCertStatus(p) === "certified",
//   ).length;
//   const expired = results.filter((p) => getCertStatus(p) === "expired").length;
//   const nocert = results.filter((p) => getCertStatus(p) === "nocert").length;

//   return (
//     <>
//       <div className="p-6">
//         {/* Header */}
//         <div className="mb-6">
//           <h1 className="text-xl font-semibold tracking-tight">
//             Product search
//           </h1>
//           <p className="text-sm text-muted-foreground mt-1">
//             Search by product code, description, supplier or brand
//           </p>
//         </div>

//         {/* Search input */}
//         <div className="relative mb-3">
//           <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
//           <input
//             ref={inputRef}
//             type="text"
//             value={query}
//             onChange={(e) => setQuery(e.target.value)}
//             placeholder="Type at least 3 characters to search…"
//             className="w-full h-10 pl-9 pr-24 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
//             autoFocus
//           />
//           {query && (
//             <button
//               onClick={() => {
//                 setQuery("");
//                 setResults([]);
//                 setSearched(false);
//                 inputRef.current?.focus();
//               }}
//               className="absolute right-16 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
//             >
//               <XIcon className="w-3.5 h-3.5" />
//             </button>
//           )}
//           {searched && (
//             <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
//               {loading ? "Searching…" : `${results.length} results`}
//             </span>
//           )}
//         </div>

//         {/* Hint */}
//         {!searched && query.length > 0 && query.length < 3 && (
//           <p className="text-xs text-muted-foreground mb-3">
//             {3 - query.length} more character{3 - query.length > 1 ? "s" : ""}{" "}
//             needed
//           </p>
//         )}

//         {/* Brand filter */}
//         {brands.length > 0 && (
//           <div className="flex items-center gap-2 mb-4 flex-wrap">
//             <span className="text-xs text-muted-foreground shrink-0">
//               Brand:
//             </span>
//             <button
//               onClick={() => setBrand("")}
//               className={cn(
//                 "text-xs px-2.5 py-1 rounded-full border transition-colors",
//                 brand === ""
//                   ? "bg-primary text-primary-foreground border-primary"
//                   : "border-border text-muted-foreground hover:bg-muted/60",
//               )}
//             >
//               All
//             </button>
//             {brands.map((b) => (
//               <button
//                 key={b}
//                 onClick={() => setBrand(b === brand ? "" : b)}
//                 className={cn(
//                   "text-xs px-2.5 py-1 rounded-full border transition-colors",
//                   brand === b
//                     ? "bg-primary text-primary-foreground border-primary"
//                     : "border-border text-muted-foreground hover:bg-muted/60",
//                 )}
//               >
//                 {b}
//               </button>
//             ))}
//           </div>
//         )}

//         {/* Stats row */}
//         {searched && !loading && results.length > 0 && (
//           <div className="flex items-center gap-3 mb-4 flex-wrap">
//             <span className="text-xs text-muted-foreground">
//               Results for{" "}
//               <span className="font-medium text-foreground">"{query}"</span>
//               {brand && (
//                 <>
//                   {" "}
//                   · brand:{" "}
//                   <span className="font-medium text-foreground">{brand}</span>
//                 </>
//               )}
//             </span>
//             <div className="flex items-center gap-2 ml-auto">
//               {certified > 0 && (
//                 <span className="text-[10px] bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5">
//                   {certified} certified
//                 </span>
//               )}
//               {expired > 0 && (
//                 <span className="text-[10px] bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded px-1.5 py-0.5">
//                   {expired} expired
//                 </span>
//               )}
//               {nocert > 0 && (
//                 <span className="text-[10px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5">
//                   {nocert} no cert
//                 </span>
//               )}
//             </div>
//           </div>
//         )}

//         {/* Loading skeleton */}
//         {loading && (
//           <div className="space-y-3">
//             {[1, 2, 3].map((i) => (
//               <div
//                 key={i}
//                 className="bg-background border border-border rounded-xl p-4 flex items-center gap-4 animate-pulse"
//               >
//                 <div className="w-14 h-14 rounded-lg bg-muted shrink-0" />
//                 <div className="flex-1 space-y-2">
//                   <div className="h-3 bg-muted rounded w-24" />
//                   <div className="h-3 bg-muted rounded w-48" />
//                   <div className="h-3 bg-muted rounded w-36" />
//                 </div>
//               </div>
//             ))}
//           </div>
//         )}

//         {/* No results */}
//         {searched && !loading && results.length === 0 && (
//           <div className="text-center py-16 text-muted-foreground">
//             <SearchIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
//             <div className="text-sm font-medium">No results for "{query}"</div>
//             <div className="text-xs mt-1">
//               Try a different product code or description
//             </div>
//           </div>
//         )}

//         {/* Empty state */}
//         {!searched && (
//           <div className="text-center py-16 text-muted-foreground">
//             <SearchIcon className="w-8 h-8 mx-auto mb-3 opacity-20" />
//             <div className="text-sm">Start typing to search products</div>
//             <div className="text-xs mt-1">
//               Searches product code, description, supplier and brand
//             </div>
//           </div>
//         )}

//         {/* Results */}
//         {!loading && paged.length > 0 && (
//           <div className="space-y-2">
//             {paged.map((p) => (
//               <ProductCard
//                 key={p.id}
//                 product={p}
//                 query={query}
//                 onView={setSelected}
//               />
//             ))}
//           </div>
//         )}

//         {/* Pagination */}
//         {totalPages > 1 && (
//           <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
//             <span className="text-xs text-muted-foreground">
//               Showing {(page - 1) * PAGE_SIZE + 1}–
//               {Math.min(page * PAGE_SIZE, results.length)} of {results.length}{" "}
//               results
//             </span>
//             <div className="flex items-center gap-2">
//               <button
//                 onClick={() => setPage((p) => Math.max(1, p - 1))}
//                 disabled={page === 1}
//                 className="flex items-center gap-1 text-xs px-3 py-1.5 border border-border rounded-lg disabled:opacity-40 hover:bg-muted/60 transition-colors"
//               >
//                 <ChevronLeftIcon className="w-3.5 h-3.5" /> Previous
//               </button>
//               <span className="text-xs text-muted-foreground px-2">
//                 {page} / {totalPages}
//               </span>
//               <button
//                 onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
//                 disabled={page === totalPages}
//                 className="flex items-center gap-1 text-xs px-3 py-1.5 bg-foreground text-background rounded-lg disabled:opacity-40 hover:opacity-90 transition-colors"
//               >
//                 Next <ChevronRightIcon className="w-3.5 h-3.5" />
//               </button>
//             </div>
//           </div>
//         )}
//       </div>

//       {/* Slide-over */}
//       {selected && (
//         <ProductSlideOver
//           product={selected}
//           onClose={() => setSelected(null)}
//         />
//       )}
//     </>
//   );
// }

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { searchProducts, getDistinctBrands, setProductRental } from "@/server/products";
import {
  SearchIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
  ImageIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";

type Product = Awaited<ReturnType<typeof searchProducts>>[number];

const PAGE_SIZE = 10;

// Type-safe Malaysia formatting handler (Accepts native ISO strings from your schema safely)
function malaysiaDate(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return "n.a";

  const parsedDate =
    typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(parsedDate.getTime())) return "n.a";

  return new Intl.DateTimeFormat("ms-MY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsedDate);
}

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

// FIXED: Now accurately reads standard ISO timestamp strings instead of assuming text contains slashes
function getCertStatus(p: Product): "certified" | "expired" | "nocert" {
  if (!p.mdaRegistrationNo) return "nocert";
  if (p.mdaExpiredOn) {
    const expDate = new Date(p.mdaExpiredOn);
    if (!isNaN(expDate.getTime()) && expDate < new Date()) {
      return "expired";
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

function ProductImage({
  productCode,
  imageUploadedAt,
  className,
}: {
  productCode: string;
  imageUploadedAt?: Date | string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [extIndex, setExtIndex] = useState(0);
  const exts = ["jpg", "jpeg", "png", "webp"];
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL;
  const v = imageUploadedAt ? new Date(imageUploadedAt).getTime() : null;

  if (!base || failed || extIndex >= exts.length) {
    return (
      <div
        className={cn("flex items-center justify-center bg-muted", className)}
      >
        <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
      </div>
    );
  }

  const encodedCode = encodeURIComponent(productCode.replace(/\//g, ":"));
  const src = `${base}/${encodedCode}.${exts[extIndex]}${v ? `?v=${v}` : ""}`;

  return (
    <img
      src={src}
      alt={productCode}
      className={cn("object-contain", className)}
      onError={() => {
        if (extIndex + 1 < exts.length) setExtIndex((i) => i + 1);
        else setFailed(true);
      }}
    />
  );
}

// ── Product detail slide-over ─────────────────────────────────────────────────
function ProductSlideOver({
  product: p,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const status = getCertStatus(p);
  const [isRental, setIsRental] = useState(p.isRental);
  const [toggling, setToggling] = useState(false);

  async function handleToggleRental() {
    setToggling(true);
    try {
      await setProductRental(p.id, !isRental);
      setIsRental((v) => !v);
    } catch {
      // leave state unchanged on error
    } finally {
      setToggling(false);
    }
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const DetailRow = ({
    label,
    value,
    mono,
    link,
  }: {
    label: string;
    value?: string | null;
    mono?: boolean;
    link?: boolean;
  }) => {
    if (!value) return null;
    return (
      <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
        <span className="text-xs text-muted-foreground shrink-0">{label}</span>
        {link ? (
          <Link
            href={value}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {value.split("/").pop()} <ExternalLinkIcon className="w-3 h-3" />
          </Link>
        ) : (
          <span
            className={cn(
              "text-xs text-right ml-4",
              mono
                ? "font-mono text-blue-600 dark:text-blue-400"
                : "text-foreground",
            )}
          >
            {value}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-background border-l border-border z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
          <div className="text-sm font-medium">Product detail</div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
            aria-label="Close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Product image */}
          <div className="w-full aspect-square bg-muted border-b border-border overflow-hidden">
            <ProductImage
              productCode={p.productCode}
              imageUploadedAt={p.imageUploadedAt}
              className="w-full h-full"
            />
          </div>

          <div className="p-4 space-y-4">
            {/* Name + badges */}
            <div>
              <div className="font-medium text-sm leading-snug mb-2">
                {p.description ?? "—"}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5">
                  {p.productCode}
                </span>
                <CertBadge status={status} />
                {p.brand && (
                  <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                    {p.brand}
                  </span>
                )}
              </div>
            </div>

            {/* Price + UOM */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  Unit price
                </div>
                <div className="text-base font-medium">
                  {p.sellingUnitPrice
                    ? `RM ${Number(p.sellingUnitPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
                    : "—"}
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">UOM</div>
                <div className="text-base font-medium">{p.uom ?? "—"}</div>
              </div>
            </div>

            {/* MDA Certificate */}
            {(p.mdaRegistrationNo ||
              p.mdaValidFrom ||
              p.mdaExpiredOn ||
              p.mdaPdfFile ||
              p.mdaPageNo) && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 border-b border-border">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    MDA certificate
                  </span>
                </div>
                <div className="px-3 py-1">
                  <DetailRow
                    label="Registration no."
                    value={p.mdaRegistrationNo}
                    mono
                  />
                  {/* FIXED: Removed raw new Date constructor wrapper inline to allow malaysiaDate utility safely parse it */}
                  <DetailRow
                    label="Valid from"
                    value={malaysiaDate(p.mdaValidFrom)}
                  />
                  <DetailRow
                    label="Expired on"
                    value={malaysiaDate(p.mdaExpiredOn)}
                  />
                  {status === "expired" && p.mdaExpiredOn && (
                    <div className="py-2 border-b border-border/50">
                      <span className="text-xs text-red-600 dark:text-red-400">
                        Certificate has expired
                      </span>
                    </div>
                  )}
                  <DetailRow label="Page no." value={p.mdaPageNo} />
                  <DetailRow label="PDF file" value={p.mdaPdfFile} link />
                </div>
              </div>
            )}

            {/* Supplier info */}
            {(p.supplier || p.brand) && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 border-b border-border">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Supplier info
                  </span>
                </div>
                <div className="px-3 py-1">
                  <DetailRow label="Supplier" value={p.supplier} />
                  <DetailRow label="Brand" value={p.brand} />
                </div>
              </div>
            )}

            {/* Rental flag */}
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 border-b border-border">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Item type
                </span>
              </div>
              <div className="px-3 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{isRental ? "Rental-capable (machine / equipment)" : "Consumable / disposable"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isRental
                      ? "Can be rented (loan out, returned) or sold — chosen per case DO line."
                      : "Always sold / consumed — stock permanently deducted on case DO."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={toggling}
                  onClick={handleToggleRental}
                  className={cn(
                    "shrink-0 text-xs px-3 py-1.5 rounded-md border font-medium transition-colors disabled:opacity-50",
                    isRental
                      ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {toggling ? "saving…" : isRental ? "rental" : "consumable"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Product card ──────────────────────────────────────────────────────────────
function ProductCard({
  product: p,
  query,
  onView,
}: {
  product: Product;
  query: string;
  onView: (p: Product) => void;
}) {
  const status = getCertStatus(p);

  return (
    <div className="bg-background border border-border rounded-xl p-4 flex items-center gap-4 hover:border-border/80 hover:bg-muted/10 transition-colors">
      <div
        className="w-14 h-14 rounded-lg bg-muted border border-border overflow-hidden shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => onView(p)}
      >
        <ProductImage productCode={p.productCode} imageUploadedAt={p.imageUploadedAt} className="w-full h-full" />
      </div>

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
          {p.sellingUnitPrice && (
            <span className="font-medium text-foreground">
              RM{" "}
              {Number(p.sellingUnitPrice).toLocaleString("en-MY", {
                minimumFractionDigits: 2,
              })}
            </span>
          )}
          {p.mdaRegistrationNo && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-mono text-blue-600 dark:text-blue-400">
                {p.mdaRegistrationNo}
              </span>
            </>
          )}
          {/* FIXED: Replaced inline string constructors with updated malaysiaDate parser metrics */}
          {status === "certified" && p.mdaValidFrom && p.mdaExpiredOn && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>
                Valid {malaysiaDate(p.mdaValidFrom)} –{" "}
                {malaysiaDate(p.mdaExpiredOn)}
              </span>
            </>
          )}
          {status === "expired" && p.mdaExpiredOn && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-red-600 dark:text-red-400">
                Expired {malaysiaDate(p.mdaExpiredOn)}
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

      <button
        onClick={() => onView(p)}
        className="shrink-0 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/60 transition-colors"
      >
        View
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ProductSearch() {
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [brands, setBrands] = useState<string[]>([]);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Product | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchGenRef = useRef(0);

  useEffect(() => {
    getDistinctBrands()
      .then(setBrands)
      .catch(() => {});
  }, []);

  const doSearch = useCallback(async (q: string, b: string) => {
    if (q.trim().length < 3) {
      setResults([]);
      setSearched(false);
      setPage(1);
      return;
    }
    const gen = ++searchGenRef.current;
    setLoading(true);
    setSearched(true);
    setResults([]);
    try {
      const res = await searchProducts(q.trim(), b || undefined);
      if (gen !== searchGenRef.current) return;
      setResults(res);
      setPage(1);
    } catch {
      if (gen !== searchGenRef.current) return;
      setResults([]);
    } finally {
      if (gen === searchGenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query, brand), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, brand, doSearch]);

  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  const paged = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const certified = results.filter(
    (p) => getCertStatus(p) === "certified",
  ).length;
  const expired = results.filter((p) => getCertStatus(p) === "expired").length;
  const nocert = results.filter((p) => getCertStatus(p) === "nocert").length;

  return (
    <>
      <div className="p-6">
        <PageHeader
          title="Product search"
          description="Search by product code, description, supplier or brand"
        />

        {/* Search input */}
        <div className="relative mb-3">
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
          <p className="text-xs text-muted-foreground mb-3">
            {3 - query.length} more character{3 - query.length > 1 ? "s" : ""}{" "}
            needed
          </p>
        )}

        {/* Brand filter */}
        {brands.length > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">
              Brand:
            </span>
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
              Results for{" "}
              <span className="font-medium text-foreground">"{query}"</span>
              {brand && (
                <>
                  {" "}
                  · brand:{" "}
                  <span className="font-medium text-foreground">{brand}</span>
                </>
              )}
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
        {loading && results.length === 0 && (
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
        {paged.length > 0 && (
          <div className="space-y-2">
            {paged.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                query={query}
                onView={setSelected}
              />
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

      {/* Slide-over */}
      {selected && (
        <ProductSlideOver
          product={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
