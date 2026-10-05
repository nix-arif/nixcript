"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, BuildingIcon, HandshakeIcon, HospitalIcon, Loader2Icon, SearchIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { adjustConsignmentStock, closeConsignment, recordUsage, returnConsignmentStock, type ConsignmentDetail } from "@/server/consign";
import { searchCustomerOrganizations } from "@/server/customer";

const fmtDate = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtQty = (n: number | string) => { const v = typeof n === "string" ? parseFloat(n) || 0 : n; return Number.isInteger(v) ? String(v) : v.toFixed(2); };

const EVENT: Record<string, { label: string; cls: string }> = {
  send:    { label: "Sent",     cls: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  consume: { label: "Used",     cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  return:  { label: "Returned", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  adjust:  { label: "Adjusted", cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  reverse: { label: "Use reversed", cls: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  machine_use: { label: "Asset used", cls: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  rental:  { label: "Rental", cls: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  move_out: { label: "Moved out", cls: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
  move_in:  { label: "Moved in", cls: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
};

type Mode = null | "return" | "adjust" | "usage";

function showError(res: { title: string; details?: string[] }) {
  toast.error(res.title, res.details?.length ? { description: <ul className="mt-1 space-y-0.5">{res.details.map((d) => <li key={d}>• {d}</li>)}</ul>, duration: 10000 } : undefined);
}

export function ConsignmentDetailClient({ data }: { data: ConsignmentDetail }) {
  const router = useRouter();
  const { header: h, lines, events, permissions } = data;
  const [mode, setMode] = useState<Mode>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<"lost" | "damaged" | "expired" | "count">("lost");
  const [charge, setCharge] = useState(true);
  const [usageDate, setUsageDate] = useState(new Date().toISOString().slice(0, 10));
  const [usageRef, setUsageRef] = useState("");
  const [usageHospital, setUsageHospital] = useState<{ id: string; name: string } | null>(null);
  const [linePrice, setLinePrice] = useState<Record<string, string>>({});
  // company assets used on a case: why it went out (rental / loan / demo)
  const [linePurpose, setLinePurpose] = useState<Record<string, "RENTAL" | "LOAN" | "DEMO">>({});
  const [busy, setBusy] = useState(false);

  const totalOnHand = lines.reduce((s, l) => s + l.onHand, 0);
  const isCustomer = h.consigneeType === "customer";
  const isPartner = h.consigneeType === "partner";
  const isSalesAgent = h.partnerModel === "sales_agent";
  const showPriceCol = isSalesAgent || lines.some((l) => l.isMachine && l.onHand > 0);
  const hasMoved = lines.some((l) => parseFloat(l.qtyMoved) > 0);
  const usesOf = (lineId: string) => events.filter((e) => e.lineId === lineId && e.type === "machine_use" && !(e.reason ?? "").startsWith("reversed")).length;
  const canRecordUsage = isCustomer || isPartner;
  const Icon = isCustomer ? HospitalIcon : isPartner ? HandshakeIcon : h.repName ? UserIcon : BuildingIcon;

  const startMode = (m: Mode) => {
    setMode(m);
    // Serial lines are all-or-nothing (1 unit); prefill nothing so the user picks
    setQty({});
  };

  async function submit() {
    const items = lines.map((l) => ({ lineId: l.id, qty: Number(qty[l.id] || 0) })).filter((i) => i.qty > 0);
    if (!items.length) { toast.error("Enter a quantity for at least one line"); return; }
    setBusy(true);
    try {
      const res = mode === "return"
        ? await returnConsignmentStock(h.id, items)
        : mode === "usage"
          ? await recordUsage({
              consignmentId: h.id, usageDate, reference: usageRef, hospitalOrgId: usageHospital?.id ?? null,
              items: items.map((i) => ({ ...i, unitPrice: linePrice[i.lineId] ?? null, purpose: linePurpose[i.lineId] ?? "RENTAL" })),
            })
          : await adjustConsignmentStock(h.id, items, reason, charge);
      if (!res.ok) { showError(res); return; }
      const auto = (res as { settledInvoices?: string[] }).settledInvoices;
      const settled = auto?.length ? ` — invoiced automatically (${auto.join(", ")})` : "";
      toast.success(mode === "return" ? "Stock returned to " + h.sourceWarehouseLabel : mode === "usage" ? (settled ? `Usage recorded${settled}` : "Usage recorded — ready to invoice in Settlement") : "Adjustment posted");
      setUsageHospital(null); setLinePrice({}); setLinePurpose({});
      setMode(null); setQty({});
      router.refresh();
    } finally { setBusy(false); }
  }

  async function close() {
    if (!confirm(`Close ${h.consignmentNo}? Nothing is left on hand.`)) return;
    setBusy(true);
    try {
      const res = await closeConsignment(h.id);
      if (!res.ok) { showError(res); return; }
      toast.success(`${h.consignmentNo} closed`);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <PageHeader
        title={h.consignmentNo}
        description={`${isCustomer ? "Customer" : isPartner ? (isSalesAgent ? "Sales agent" : "Dealer") : "Agent"} consignment · owned by ${h.ownerName}`}
        action={<Button variant="outline" size="sm" onClick={() => router.back()} className="gap-1.5"><ArrowLeftIcon className="w-3.5 h-3.5" /> Back</Button>}
      />

      {/* Summary */}
      <div className="grid gap-3 md:grid-cols-3 mb-4">
        <div className="md:col-span-2 border border-border rounded-xl p-4 flex items-start gap-3">
          <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
            isCustomer ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : isPartner ? "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400")}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 text-sm">
            <div className="font-semibold break-words">{isCustomer ? h.customerOrgName : isPartner ? h.partnerName : h.agentName}</div>
            <div className="text-muted-foreground">{isCustomer ? (h.customerName ?? "Hospital site") : isPartner ? (isSalesAgent ? "External sales agent — hospitals are invoiced, agent earns commission" : "External dealer — invoiced when it reports usage") : h.repName ? `With specialist ${h.repName}` : "At their warehouse"}</div>
            <div className="text-xs text-muted-foreground mt-1">
              From {h.sourceWarehouseLabel} · sent {fmtDate(h.sentDate)} by {h.createdByName}{h.soNo ? ` · SO ${h.soNo}` : ""}
            </div>
            {h.notes && <div className="text-xs mt-1 whitespace-pre-line">{h.notes}</div>}
          </div>
        </div>
        <div className="border border-border rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="text-xs text-muted-foreground">On hand</div>
            <div className="text-2xl font-semibold tabular-nums">{fmtQty(totalOnHand)}</div>
          </div>
          <span className={cn("self-start mt-2 text-[11px] font-medium rounded px-1.5 py-0.5", h.status === "open" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
            {h.status === "open" ? "Open" : "Closed"}
          </span>
        </div>
      </div>

      {/* Actions */}
      {h.status === "open" && (permissions.canManage || permissions.canAdjust) && mode === null && (
        <div className="flex flex-wrap gap-2 mb-4">
          {permissions.canManage && canRecordUsage && totalOnHand > 0 && <Button size="sm" onClick={() => startMode("usage")}>Record usage</Button>}
          {permissions.canManage && totalOnHand > 0 && <Button variant="outline" size="sm" onClick={() => startMode("return")}>Return to {h.sourceWarehouseLabel}</Button>}
          {permissions.canAdjust && totalOnHand > 0 && <Button variant="outline" size="sm" onClick={() => startMode("adjust")}>Adjust after count</Button>}
          {permissions.canManage && totalOnHand <= 0 && <Button variant="outline" size="sm" onClick={close} disabled={busy}>Close consignment</Button>}
        </div>
      )}
      {!permissions.isOwner && (
        <p className="text-xs text-muted-foreground mb-4">This stock is held by your company on consignment. Only {h.ownerName} can return or adjust it; it is used through your Case DOs.</p>
      )}

      {mode && (
        <div className="border border-primary/30 bg-primary/5 rounded-xl p-4 mb-4 space-y-3">
          <div className="text-sm font-semibold">{mode === "return" ? `Return stock to ${h.sourceWarehouseLabel}` : mode === "usage" ? `Record what ${isPartner ? h.partnerName : h.customerOrgName ?? "the customer"} used` : "Adjust after a count"}</div>
          {mode === "usage" && isPartner && (
            <div className="space-y-1 text-sm">
              <div>Hospital where it was used{isSalesAgent ? <span className="text-destructive"> *</span> : <span className="text-muted-foreground text-xs"> (optional)</span>}</div>
              {usageHospital ? (
                <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
                  <HospitalIcon className="w-3.5 h-3.5 text-muted-foreground" />{usageHospital.name}
                  <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setUsageHospital(null)}>change</button>
                </div>
              ) : <HospitalSearch onPick={setUsageHospital} />}
              {isSalesAgent && <p className="text-[11px] text-muted-foreground">It is invoiced to this hospital; enter the price charged per line below (blank = catalogue price).</p>}
            </div>
          )}
          {mode === "usage" && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">Date <Input type="date" value={usageDate} onChange={(e) => setUsageDate(e.target.value)} className="h-8 w-40 text-sm" /></label>
              <label className="flex items-center gap-2">Reference <Input value={usageRef} onChange={(e) => setUsageRef(e.target.value)} placeholder="usage sheet / hospital PO no." className="h-8 w-56 text-sm" /></label>
            </div>
          )}
          {mode === "adjust" && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">Reason
                <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="lost">Lost</option><option value="damaged">Damaged</option><option value="expired">Expired</option><option value="count">Count difference</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
                Charge to {isCustomer ? "the customer" : h.agentName}
              </label>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Enter the quantity for each line below, then confirm.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={busy} className="gap-1.5">{busy && <Loader2Icon className="w-3.5 h-3.5 animate-spin" />} Confirm {mode === "return" ? "return" : mode === "usage" ? "usage" : "adjustment"}</Button>
            <Button size="sm" variant="outline" onClick={() => setMode(null)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Lines */}
      <section className="border border-border rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-2.5 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wide">Items</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-muted-foreground border-b border-border">
                <th className="text-left font-medium px-4 py-2">Product</th>
                <th className="text-right font-medium px-2 py-2">Sent</th>
                <th className="text-right font-medium px-2 py-2">Used</th>
                <th className="text-right font-medium px-2 py-2">Returned</th>
                <th className="text-right font-medium px-2 py-2">Adjusted</th>
                {hasMoved && <th className="text-right font-medium px-2 py-2" title="Moved by the agent to another of its locations — see the linked consignment">Moved</th>}
                <th className="text-right font-medium px-4 py-2">On hand</th>
                {mode && <th className="text-right font-medium px-4 py-2">{mode === "return" ? "Return qty" : mode === "usage" ? "Used qty" : "Adjust qty"}</th>}
                {mode === "usage" && showPriceCol && <th className="text-right font-medium px-4 py-2">{isSalesAgent ? "Price / usage fee (RM)" : "Usage fee (RM)"}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs font-medium">{l.productCode}</div>
                    <div className="text-xs text-muted-foreground break-words">{l.description}</div>
                    {(l.serialNo || l.lotNo) && (
                      <div className="text-[11px] text-muted-foreground font-mono">{l.serialNo ? `SN ${l.serialNo}` : `Lot ${l.lotNo}${l.expiryDate ? ` · exp ${fmtDate(l.expiryDate)}` : ""}`}</div>
                    )}
                    {l.unitId && !l.isMachine && (
                      <div className="text-[10px] mt-0.5"><span className="rounded px-1.5 py-0.5 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 font-medium">For sale</span>
                        <span className="text-muted-foreground"> · sold once, billed when sold</span></div>
                    )}
                    {l.isMachine && (
                      <div className="text-[10px] mt-0.5"><span className="rounded px-1.5 py-0.5 bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-medium">Company asset</span>
                        <span className="text-muted-foreground"> · used on {usesOf(l.id)} case{usesOf(l.id) === 1 ? "" : "s"}</span></div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtQty(l.qtySent)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtQty(l.qtyConsumed)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtQty(l.qtyReturned)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtQty(l.qtyAdjusted)}</td>
                  {hasMoved && <td className="px-2 py-2.5 text-right tabular-nums">{fmtQty(l.qtyMoved)}</td>}
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtQty(l.onHand)}</td>
                  {mode && (
                    <td className="px-4 py-2 text-right">
                      {l.onHand > 0 ? (
                        l.unitId ? (
                          <label className="inline-flex items-center gap-1.5 text-xs">
                            <input type="checkbox" checked={qty[l.id] === "1"} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.checked ? "1" : "" }))} /> {mode === "usage" && l.isMachine ? "used on a case" : "this unit"}
                            {mode === "usage" && l.isMachine && qty[l.id] === "1" && (
                              <select value={linePurpose[l.id] ?? "RENTAL"} onChange={(e) => setLinePurpose((m) => ({ ...m, [l.id]: e.target.value as "RENTAL" | "LOAN" | "DEMO" }))}
                                className="h-7 rounded-md border border-input bg-background px-1.5 text-xs" title="Why it went out this time">
                                <option value="RENTAL">Rental</option><option value="LOAN">Loan</option><option value="DEMO">Demo</option>
                              </select>
                            )}
                          </label>
                        ) : (
                          <Input type="number" min="0" max={l.onHand} step="1" value={qty[l.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} className="h-8 w-20 ml-auto text-right text-sm" />
                        )
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  )}
                  {mode === "usage" && showPriceCol && (
                    <td className="px-4 py-2 text-right">
                      {l.onHand > 0 && (isSalesAgent || l.isMachine) && <Input type="number" min="0" step="0.01" placeholder={l.isMachine ? "no fee" : "catalogue"} value={linePrice[l.id] ?? ""} onChange={(e) => setLinePrice((m) => ({ ...m, [l.id]: e.target.value }))} className="h-8 w-28 ml-auto text-right text-sm" />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* History */}
      <section className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wide">History</div>
        {events.length === 0 ? <div className="px-4 py-6 text-sm text-muted-foreground">No events yet.</div> : (
          <div className="divide-y divide-border/60">
            {events.map((e) => {
              const cfg = EVENT[e.type] ?? { label: e.type, cls: "bg-muted" };
              return (
                <div key={e.id} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                  <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 mt-0.5", cfg.cls)}>{cfg.label}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs">{e.productCode}</span>
                    {e.serialNo && <span className="font-mono text-xs text-muted-foreground"> SN {e.serialNo}</span>}
                    {e.lotNo && <span className="font-mono text-xs text-muted-foreground"> lot {e.lotNo}</span>}
                    <span className="tabular-nums"> × {fmtQty(e.qty)}</span>
                    {e.reason && !(e.type === "machine_use" && e.reason === "no-commission") && e.type !== "rental" && !e.type.startsWith("move_") && <span className="text-xs text-muted-foreground"> · {e.reason}{e.billable && e.type === "adjust" ? " · charged" : ""}</span>}
                    {e.sourceNo && (e.type.startsWith("move_") && e.sourceId
                      ? <span className="text-xs text-muted-foreground"> · {e.type === "move_out" ? "to" : "from"} <Link href={`/dashboard/consignment/${e.sourceId}`} className="text-primary hover:underline">{e.sourceNo}</Link></span>
                      : <span className="text-xs text-muted-foreground"> · {e.sourceNo}</span>)}
                    {e.hospitalName && <span className="text-xs text-muted-foreground"> · at {e.hospitalName}</span>}
                    {e.type === "machine_use" && e.purpose && <span className="text-xs text-muted-foreground"> · {({ RENTAL: "rental", LOAN: "loan", DEMO: "demo" } as Record<string, string>)[e.purpose] ?? e.purpose}</span>}
                    {e.unitPrice && <span className="text-xs text-muted-foreground"> · {e.type === "machine_use" ? "usage fee " : ""}RM {e.unitPrice}</span>}
                    {(e.type === "machine_use" || e.type === "rental") && <span className="text-xs text-muted-foreground"> · {e.billable && e.chargePrice ? `charged RM ${Number(e.chargePrice).toFixed(2)}` : "no charge"}</span>}
                    <div className="text-[11px] text-muted-foreground">{fmtDate(e.eventDate)} · {e.byName}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function HospitalSearch({ onPick }: { onPick: (h: { id: string; name: string }) => void }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ q: string; rows: { id: string; name: string; address: string | null }[] } | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => { const rows = await searchCustomerOrganizations(q); if (!cancelled) setAnswer({ q, rows }); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  const rows = q.trim().length >= 2 && answer?.q === q ? answer.rows : [];
  return (
    <div className="relative max-w-md">
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hospital…" className="pl-9 h-9 text-sm" autoComplete="off" />
      {rows.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => { onPick({ id: r.id, name: r.name }); setQ(""); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 border-b border-border/40 last:border-0">{r.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
