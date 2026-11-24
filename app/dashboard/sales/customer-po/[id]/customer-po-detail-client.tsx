"use client";

import { navigateBack } from "@/hooks/use-back";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon, CheckIcon, AlertCircleIcon,
  FileTextIcon, PackageIcon, TruckIcon, ReceiptIcon,
  BanknoteIcon, PencilIcon, LinkIcon, DatabaseIcon,
  BuildingIcon, UserIcon, PaperclipIcon,
  LayersIcon, AlertTriangleIcon, RouteIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CustomerPoTrackingData, CpoItemInput } from "@/server/customer-purchase-order";
import { isNotAsSetLabel, NOT_AS_SET_ID, sourceQuotationNo } from "@/lib/customer-po/item-order";
import { CPO_STATUS, StatusBadge, trailStates, type StepState } from "./fulfilment-trail";

type Data = CustomerPoTrackingData;

// nanoid prefix is 21 chars + dash, original filename follows
const docFilename = (key: string) => key.split("/").pop()?.slice(22) || key.split("/").pop() || "document";

// ── Formatters ─────────────────────────────────────────────────────────────
const fmt = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ── Main component ─────────────────────────────────────────────────────────
export function CustomerPoDetailClient({
  data,
  permissions,
  backHref = "/dashboard/sales/customer-po",
  organizationName,
  editHref,
  trailHref,
}: {
  data: Data;
  permissions: string[];
  backHref?: string;
  organizationName?: string;
  // When provided, overrides both the Edit destination and whether the Edit
  // button shows at all — used by the centralized view, whose Edit rights
  // are gated by a separate permission (customer-po:update:centralized)
  // resolved server-side rather than the plain `permissions` array here.
  editHref?: string;
  // The fulfilment trail page — defaults to the plain (non-centralized) one.
  trailHref?: string;
}) {
  const router = useRouter();
  const { cpo, createdByName, so, dos, invoices } = data;
  const snap = cpo.customerSnapshot as any;
  const can  = (p: string) => permissions.includes("*") || permissions.includes(p);
  const showEdit = editHref !== undefined || can("customer-po:update");
  const resolvedEditHref = editHref ?? `/dashboard/sales/customer-po/${cpo.id}/edit`;

  const { prOpenCount, activeSpoList, soState, prState, spoState, doState, invState, pmt } = trailStates(data);
  const resolvedTrailHref = trailHref ?? `/dashboard/sales/customer-po/${cpo.id}/trail`;

  const cpoStatusCfg = CPO_STATUS[cpo.status] ?? CPO_STATUS.received;

  return (
    <div className="p-6 space-y-6">
      {cpo.status === "draft" && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800/40">
          <span className="font-medium">This is a draft.</span>
          <span className="text-muted-foreground">It is not recorded yet: nobody was told and no sales order can be made from it.</span>
          <Button size="sm" className="ml-auto" onClick={() => router.push(`/dashboard/sales/customer-po/${cpo.id}/edit`)}>Finish and record it</Button>
        </div>
      )}
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button variant="ghost" size="icon" className="w-7 h-7 -ml-1.5" onClick={() => navigateBack(router, backHref)}>
              <ArrowLeftIcon className="w-3.5 h-3.5" />
            </Button>
            <h1 className="text-lg font-bold font-mono">{cpo.customerPoNo}</h1>
            <StatusBadge label={cpoStatusCfg.label} color={cpoStatusCfg.color} />
            {organizationName && (
              <span className="text-[10px] font-medium text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded px-1.5 py-0.5">
                {organizationName}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground pl-9">
            {snap?.organizationName ?? snap?.name ?? "Unknown customer"}
            {" · "}Received {fmtDate(cpo.receivedDate ?? cpo.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => router.push(resolvedTrailHref)}>
            <RouteIcon className="w-3.5 h-3.5" /> Fulfilment Trail
          </Button>
          {showEdit && (
            <Button variant="outline" size="sm" className="gap-1.5"
              onClick={() => router.push(resolvedEditHref)}>
              <PencilIcon className="w-3.5 h-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      {/* ── Items ── */}
      {cpo.items && cpo.items.length > 0 && <ItemsSection items={cpo.items} currency={cpo.currency} quotations={cpo.quotationLinks ?? []} />}

      {/* ── Info cards (the fulfilment trail has its own page) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {/* Customer details */}
          <section className="border border-border rounded-xl p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Customer</h2>
            {snap ? (
              <div className="space-y-1.5">
                {snap.name && (
                  <div className="flex items-center gap-2">
                    <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{[snap.title, snap.name].filter(Boolean).join(" ")}</span>
                  </div>
                )}
                {snap.organizationName && (
                  <div className="flex items-center gap-2">
                    <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">{snap.organizationName}</span>
                  </div>
                )}
                {snap.email && <p className="text-xs text-muted-foreground pl-5">{snap.email}</p>}
                {snap.contactNo && <p className="text-xs text-muted-foreground pl-5">{snap.contactNo}</p>}
                {snap.organizationAddress && (
                  <p className="text-xs text-muted-foreground pl-5 leading-relaxed">{snap.organizationAddress}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No customer info</p>
            )}
          </section>

          {/* PO details */}
          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">PO Details</h2>
            <Row label="PO No" value={cpo.customerPoNo} mono />
            <Row label="Amount" value={`${fmt(cpo.amount)}${cpo.currency !== "MYR" ? ` ${cpo.currency}` : ""}`} />
            <Row label="Received" value={fmtDate(cpo.receivedDate ?? cpo.createdAt)} />
            <Row label="Status" value={cpoStatusCfg.label} />
            {cpo.quotationNo && <Row label="Quotation" value={cpo.quotationNo} mono />}
            {cpo.salesOrderNo && <Row label="Sales Order" value={cpo.salesOrderNo} mono />}
            {createdByName && <Row label="Recorded by" value={createdByName} />}
          </section>

          {/* Progress summary */}
          <section className="border border-border rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Progress</h2>
              <button type="button" onClick={() => router.push(resolvedTrailHref)} className="text-[11px] text-primary hover:underline">
                View trail
              </button>
            </div>
            <ProgressRow icon={PackageIcon} label="Sales Order" state={soState} note={so?.soNo} />
            <ProgressRow icon={FileTextIcon} label="Purch. Req." state={prState}
              note={prOpenCount > 0 ? `${prOpenCount} open` : undefined} />
            <ProgressRow icon={PackageIcon} label="Supplier PO" state={spoState}
              note={activeSpoList.length > 0 ? `${activeSpoList.length} PO${activeSpoList.length > 1 ? "s" : ""}` : undefined} />
            <ProgressRow icon={TruckIcon} label="Delivery" state={doState}
              note={dos.length > 0 ? `${dos.filter((d) => d.status === "delivered").length}/${dos.length} delivered` : undefined} />
            <ProgressRow icon={ReceiptIcon} label="Invoice" state={invState}
              note={invoices.length > 0 ? `${invoices.length} invoice${invoices.length > 1 ? "s" : ""}` : undefined} />
            <ProgressRow icon={BanknoteIcon} label="Payment" state={pmt.state} note={pmt.label} />
          </section>

          {/* Attached document */}
          {cpo.documentKey && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Attached Document</h2>
              <a
                href={`/api/customer-po/download/${cpo.documentKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <PaperclipIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{docFilename(cpo.documentKey)}</span>
              </a>
            </section>
          )}

          {/* Notes */}
          {cpo.notes && (
            <section className="border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{cpo.notes}</p>
            </section>
          )}
      </div>
    </div>
  );
}

// ── Small helper components ────────────────────────────────────────────────
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function ProgressRow({
  icon: Icon, label, state, note,
}: {
  icon: React.ElementType;
  label: string;
  state: StepState;
  note?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
        state === "done"    && "bg-green-500 text-white",
        state === "active"  && "bg-primary text-primary-foreground",
        state === "warn"    && "bg-red-500 text-white",
        state === "pending" && "bg-muted border border-border text-muted-foreground",
      )}>
        {state === "done" ? <CheckIcon className="w-2.5 h-2.5" />
          : state === "warn" ? <AlertCircleIcon className="w-2.5 h-2.5" />
          : <Icon className="w-2.5 h-2.5" />}
      </div>
      <span className={cn("text-xs flex-1", state === "pending" ? "text-muted-foreground" : "text-foreground")}>{label}</span>
      {note && <span className="text-[10px] text-muted-foreground">{note}</span>}
    </div>
  );
}

// ── Items ───────────────────────────────────────────────────────────────────
type SourceKind = "quote" | "catalog" | "user";
type ViewItem = CpoItemInput & { _srcNo: string };

const asSources = (v: unknown): SourceKind[] => (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is SourceKind => x === "quote" || x === "catalog" || x === "user");

// "from quotation AFF-QT-…", "from product table" or "<name> edited CPO", as saved with the line
function SourceBadges({ sources, item }: { sources: SourceKind[]; item: ViewItem }) {
  if (sources.length === 0) return null;
  const base = "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border";
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {sources.map((s) =>
        s === "quote" ? (
          <span key={s} className={cn(base, "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800")}>
            <LinkIcon className="w-3 h-3 shrink-0" />from quotation{item._srcNo ? ` ${item._srcNo}` : ""}
          </span>
        ) : s === "catalog" ? (
          <span key={s} className={cn(base, "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800")}>
            <DatabaseIcon className="w-3 h-3 shrink-0" />from product table
          </span>
        ) : (
          <span key={s} className={cn(base, "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800")}>
            <PencilIcon className="w-3 h-3 shrink-0" />{item._editedBy || "user"} edited CPO
          </span>
        ),
      )}
    </div>
  );
}

// The description as written on the customer's PO
function CpoDescription({ text }: { text: string }) {
  return (
    <div className="mt-1 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground whitespace-pre-line">
      <span className="font-medium text-foreground/70">CPO description: </span>
      {text}
    </div>
  );
}

function ItemsSection({ items: rawItems, currency, quotations }: { items: CpoItemInput[]; currency: string; quotations: { quotationId: string; quotationNo: string }[] }) {
  // Older CPOs kept one "not-as-set" group per quotation; show them as the single group they are
  // Which quotation each line came from: saved with the line, else read from its group id, else the CPO's only quotation.
  // (Worked out before the groups are merged, because merging drops the quotation id from the group id.)
  const sourceOf = (it: CpoItemInput) => sourceQuotationNo(it, quotations);
  const items: ViewItem[] = rawItems.map((it) => ({
    ...it,
    ...(isNotAsSetLabel(it.setGroupLabel) ? { setGroupId: NOT_AS_SET_ID, setQty: "1" } : {}),
    _srcNo: sourceOf(it),
  }));

  const acct = (v: number) =>
    v.toLocaleString("en-MY", { style: "currency", currency: currency || "MYR", minimumFractionDigits: 2 });

  const seenGroupIds = new Set<string>();
  const groupOrder: string[] = [];
  for (const it of items) {
    if (it.setGroupId && !seenGroupIds.has(it.setGroupId)) {
      seenGroupIds.add(it.setGroupId);
      groupOrder.push(it.setGroupId);
    }
  }

  type Entry =
    | { kind: "group"; gid: string; first: ViewItem; groupTotal: number }
    | { kind: "item"; item: ViewItem; inSet: boolean };

  const entries: Entry[] = [];
  for (const gid of groupOrder) {
    const gItems = items.filter((it) => it.setGroupId === gid);
    const first = gItems[0];
    const groupTotal = gItems.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);
    entries.push({ kind: "group", gid, first, groupTotal });
    gItems.forEach((it) => entries.push({ kind: "item", item: it, inSet: true }));
  }
  items.filter((it) => !it.setGroupId).forEach((it) => entries.push({ kind: "item", item: it, inSet: false }));

  const grandTotal = items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);

  const TypeBadge = ({ isRent }: { isRent: boolean }) => (
    <span className={cn(
      "text-[8px] font-bold px-1 py-0.5 rounded border",
      isRent
        ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400"
        : "bg-green-50 border-green-300 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400",
    )}>
      {isRent ? "RENT" : "SELL"}
    </span>
  );

  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between gap-4">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Items</span>
        <span className="text-xs text-muted-foreground">{items.length} item{items.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium w-12">#</th>
              <th className="px-3 py-2 text-left font-medium">Code</th>
              <th className="px-3 py-2 text-left font-medium min-w-48">Description</th>
              <th className="px-3 py-2 text-center font-medium">Qty</th>
              <th className="px-3 py-2 text-center font-medium">UOM</th>
              <th className="px-3 py-2 text-right font-medium">Unit Price</th>
              <th className="px-3 py-2 text-center font-medium">Disc.</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              if (e.kind === "group") {
                return (
                  <tr key={`hdr-${e.gid}`} className="bg-blue-50/60 dark:bg-blue-900/10 border-b border-blue-200/60 dark:border-blue-800/40">
                    <td colSpan={3} className="px-3 py-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <LayersIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                          {e.first.setGroupLabel || "Set"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          × {Number(e.first.setQty || 1)} {Number(e.first.setQty || 1) === 1 ? "set" : "sets"}
                        </span>
                      </div>
                      {e.first.setCpoTitle && (
                        <div className="mt-1 pl-5 text-[12px] font-semibold text-foreground whitespace-pre-line">{e.first.setCpoTitle}</div>
                      )}
                    </td>
                    <td colSpan={4} />
                    <td className="px-3 py-1.5 text-right text-xs font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
                      {acct(e.groupTotal)}
                    </td>
                  </tr>
                );
              }
              const isRent = e.item.lineType === "rent";
              return (
                <tr
                  key={`${e.item.rowNo}-${e.item.productCode}`}
                  className={cn("border-b border-border/60 last:border-0", e.inSet && "bg-blue-50/20 dark:bg-blue-900/5")}
                >
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-muted-foreground text-[10px]">{e.item.rowNo}</span>
                      <TypeBadge isRent={isRent} />
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] align-top">
                    {e.item._codeSource === "user" ? (
                      <>
                        {/* the code was changed by a user: hard to miss, as it is on the edit page */}
                        <span className="inline-block rounded border-2 border-amber-500 bg-amber-100 px-1.5 py-0.5 font-bold text-amber-950 ring-2 ring-amber-300/80 dark:bg-amber-900/40 dark:text-amber-50">
                          {e.item.productCode || "—"}
                        </span>
                        <div className="mt-1 flex items-start gap-1 font-sans text-[10px] font-medium leading-snug text-amber-700 dark:text-amber-400">
                          <AlertTriangleIcon className="mt-px h-3 w-3 shrink-0" />
                          <span>
                            Code changed{e.item.originalCode && e.item.originalCode !== e.item.productCode ? <> from <span className="font-mono">{e.item.originalCode}</span></> : ""}
                          </span>
                        </div>
                      </>
                    ) : (
                      e.item.productCode || "—"
                    )}
                    <SourceBadges sources={asSources(e.item._codeSource)} item={e.item} />
                  </td>
                  <td className="px-3 py-2 align-top whitespace-normal">
                    {e.item.description || "—"}
                    {e.item.cpoDescription && <CpoDescription text={e.item.cpoDescription} />}
                    <SourceBadges sources={asSources(e.item._descriptionSource)} item={e.item} />
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums align-top">
                    {e.item.qty}
                    <SourceBadges sources={asSources(e.item._qtySource)} item={e.item} />
                  </td>
                  <td className="px-3 py-2 text-center text-muted-foreground align-top">{e.item.uom || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums align-top">
                    {acct(Number(e.item.unitPrice ?? 0))}
                    <div className="flex justify-end"><SourceBadges sources={asSources(e.item._unitPriceSource)} item={e.item} /></div>
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums align-top">
                    {Number(e.item.discountPct ?? 0) > 0 ? `${e.item.discountPct}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium align-top">{acct(Number(e.item.totalPrice ?? 0))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={7} className="px-3 py-2 text-right text-xs font-semibold">Items total</td>
              <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">{acct(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden divide-y divide-border/60">
        {entries.map((e) => {
          if (e.kind === "group") {
            return (
              <div key={`hdr-${e.gid}`} className="px-3 py-2 bg-blue-50/60 dark:bg-blue-900/10">
                <div className="flex items-center gap-2 flex-wrap">
                  <LayersIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{e.first.setGroupLabel || "Set"}</span>
                  <span className="text-[10px] text-muted-foreground">
                    × {Number(e.first.setQty || 1)} {Number(e.first.setQty || 1) === 1 ? "set" : "sets"}
                  </span>
                  <span className="ml-auto text-xs font-semibold text-blue-700 dark:text-blue-300 tabular-nums">{acct(e.groupTotal)}</span>
                </div>
                {e.first.setCpoTitle && (
                  <div className="mt-1 text-[12px] font-semibold text-foreground whitespace-pre-line">{e.first.setCpoTitle}</div>
                )}
              </div>
            );
          }
          const isRent = e.item.lineType === "rent";
          return (
            <div key={`${e.item.rowNo}-${e.item.productCode}`} className={cn("px-3 py-2.5 space-y-1 text-xs", e.inSet && "bg-blue-50/20 dark:bg-blue-900/5")}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-[10px]">#{e.item.rowNo}</span>
                  <TypeBadge isRent={isRent} />
                  <span className="font-mono text-[11px]">{e.item.productCode || "—"}</span>
                </div>
                <span className="font-medium tabular-nums">{acct(Number(e.item.totalPrice ?? 0))}</span>
              </div>
              <div className="text-foreground">{e.item.description || "—"}</div>
              {e.item.cpoDescription && <CpoDescription text={e.item.cpoDescription} />}
              <SourceBadges
                sources={[...new Set([...asSources(e.item._codeSource), ...asSources(e.item._descriptionSource), ...asSources(e.item._qtySource), ...asSources(e.item._unitPriceSource)])]}
                item={e.item}
              />
              <div className="flex items-center gap-3 text-muted-foreground">
                <span>{e.item.qty} {e.item.uom}</span>
                <span>{acct(Number(e.item.unitPrice ?? 0))}/unit</span>
                {Number(e.item.discountPct ?? 0) > 0 && <span>{e.item.discountPct}% off</span>}
              </div>
            </div>
          );
        })}
        <div className="px-3 py-2.5 flex items-center justify-between text-xs font-semibold bg-muted/10">
          <span>Items total</span>
          <span className="tabular-nums">{acct(grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}
