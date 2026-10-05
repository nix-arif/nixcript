"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { generateAgentSettlement, generateCustomerInvoice, generatePartnerSettlement, previewAgentSettlement, previewPartnerSettlement } from "@/server/consign";
import type { PricedLine } from "@/lib/consignment/settle";

type Overview = Awaited<ReturnType<typeof import("@/server/consign").getSettlementOverview>>;

const rm = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const thisMonth = () => new Date().toISOString().slice(0, 7);

function showError(res: { title: string; details?: string[] }) {
  toast.error(res.title, res.details?.length ? { description: res.details.join(" · ") } : undefined);
}

function LinesTable({ lines, salesAgent }: { lines: PricedLine[]; salesAgent?: boolean }) {
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-muted-foreground border-b border-border bg-muted/30">
            <th className="text-left font-medium px-3 py-2">Date</th>
            <th className="text-left font-medium px-3 py-2">Used on</th>
            {salesAgent && <th className="text-left font-medium px-3 py-2">Hospital</th>}
            <th className="text-left font-medium px-3 py-2">Product</th>
            <th className="text-right font-medium px-3 py-2">Qty</th>
            <th className="text-right font-medium px-3 py-2">Unit price</th>
            <th className="text-right font-medium px-3 py-2">Amount</th>
            {salesAgent && <th className="text-right font-medium px-3 py-2">Commission</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {lines.map((l) => (
            <tr key={l.eventId} className={cn(l.unitPrice === null && "opacity-60")}>
              <td className="px-3 py-2 whitespace-nowrap text-xs">{fmtDate(l.eventDate)}</td>
              <td className="px-3 py-2 text-xs"><div className="font-mono">{l.sourceNo ?? "—"}</div><div className="text-muted-foreground">{l.consignmentNo}</div></td>
              {salesAgent && <td className="px-3 py-2 text-xs">{l.hospitalName ?? <span className="text-amber-700 dark:text-amber-400">no hospital</span>}</td>}
              <td className="px-3 py-2">
                <div className="font-mono text-xs font-medium">{l.productCode}</div>
                {(l.lotNo || l.serialNo) && <div className="text-[11px] text-muted-foreground font-mono">{l.serialNo ? `SN ${l.serialNo}` : `Lot ${l.lotNo}`}</div>}
                {(l.eventType === "machine_use" || l.eventType === "rental") && (
                  <div className="text-[11px] text-orange-700 dark:text-orange-400">{l.eventType === "rental" ? l.description?.split(" — ")[0] : "Machine use (per case)"}</div>
                )}
                {l.note && <div className="text-[11px] text-amber-700 dark:text-amber-400">{l.note}</div>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtQty(l.qty)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{l.unitPrice === null ? "—" : rm(l.unitPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">{l.unitPrice === null ? "pending" : rm(l.amount)}</td>
              {salesAgent && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{l.unitPrice === null ? "—" : rm(l.commission ?? 0)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SettlementClient({ overview }: { overview: Overview }) {
  const router = useRouter();
  const [tab, setTab] = useState<"agent" | "partner" | "customer">(overview.agents.length || !overview.partners.length ? "agent" : "partner");
  const [agentId, setAgentId] = useState(overview.agents[0]?.id ?? "");
  const [partnerId, setPartnerId] = useState(overview.partners[0]?.id ?? "");
  const partner = overview.partners.find((x) => x.id === partnerId);
  const isPartner = tab === "partner";
  const payeeId = isPartner ? partnerId : agentId;
  const [month, setMonth] = useState(thisMonth());
  const [allUnsettled, setAllUnsettled] = useState(false);
  const [lines, setLines] = useState<PricedLine[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    setBusy(true);
    try {
      const res = await (isPartner ? previewPartnerSettlement : previewAgentSettlement)(payeeId, allUnsettled ? "" : month);
      if (!res.ok) { showError(res); return; }
      setLines(res.lines);
    } finally { setBusy(false); }
  }
  async function generate() {
    if (!lines?.some((l) => l.unitPrice !== null)) return;
    if (isPartner) return generatePartner();
    if (!confirm("Create the intercompany invoice and PO for these lines?")) return;
    setBusy(true);
    try {
      const res = await generateAgentSettlement(agentId, allUnsettled ? "" : month);
      if (!res.ok) { showError(res); return; }
      toast.success(`Settled ${rm(res.total)} — invoice ${res.invoiceNo}, PO ${res.poNo}${res.skipped ? ` (${res.skipped} line(s) still pending)` : ""}`);
      setLines(null);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function generatePartner() {
    const dealer = partner?.model === "dealer";
    if (!confirm(dealer ? `Create an invoice to ${partner?.name} for these lines?` : `Create an invoice per hospital and a commission PO to ${partner?.name}?`)) return;
    setBusy(true);
    try {
      const res = await generatePartnerSettlement(partnerId, allUnsettled ? "" : month);
      if (!res.ok) { showError(res); return; }
      toast.success(`Settled ${rm(res.total)} — invoice ${res.invoiceNos.join(", ")}${res.poNo ? `, commission PO ${res.poNo} (${rm(res.commission)})` : ""}${res.skipped ? ` (${res.skipped} line(s) still pending)` : ""}`);
      setLines(null);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function invoiceCustomer(id: string) {
    setBusy(true);
    try {
      const res = await generateCustomerInvoice(id);
      if (!res.ok) { showError(res); return; }
      toast.success(`Invoice ${res.invoiceNo} created (${rm(res.total)}, draft)`);
      router.refresh();
    } finally { setBusy(false); }
  }

  const ready = lines?.filter((l) => l.unitPrice !== null) ?? [];
  const total = ready.reduce((s, l) => s + l.amount, 0);
  const commission = ready.reduce((s, l) => s + (l.commission ?? 0), 0);
  const salesAgent = isPartner && partner?.model === "sales_agent";

  return (
    <div className="p-4 md:p-6 max-w-5xl space-y-4">
      <PageHeader title="Consignment settlement" description="Bill consigned stock that has been used — only consumption is billed" />

      <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
        {(["agent", "partner", "customer"] as const).map((t) => (
          <button key={t} type="button" onClick={() => { setTab(t); setLines(null); }}
            className={cn("px-3 sm:px-4 h-8 text-sm rounded-md", tab === t ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
            {t === "agent" ? "Our companies" : t === "partner" ? "External agents" : `Customers${overview.customers.length ? ` (${overview.customers.length})` : ""}`}
          </button>
        ))}
      </div>

      {isPartner && overview.partners.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl py-12 text-center text-sm text-muted-foreground">
          No external agents yet. <Link href="/dashboard/consignment/partners" className="underline">Add one</Link>
        </div>
      ) : tab !== "customer" ? (
        <section className="border border-border rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {isPartner ? (
              <label className="space-y-1 text-xs">External agent
                <select value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setLines(null); }} className="block h-9 rounded-md border border-input bg-background px-2 text-sm">
                  {overview.partners.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.model === "dealer" ? "dealer" : "sales agent"})</option>)}
                </select>
              </label>
            ) : (
              <label className="space-y-1 text-xs">Agent company
                <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setLines(null); }} className="block h-9 rounded-md border border-input bg-background px-2 text-sm">
                  {overview.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            <label className="space-y-1 text-xs">Month
              <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setLines(null); }} disabled={allUnsettled} className="h-9 w-40 text-sm" />
            </label>
            <label className="flex items-center gap-1.5 text-xs h-9">
              <input type="checkbox" checked={allUnsettled} onChange={(e) => { setAllUnsettled(e.target.checked); setLines(null); }} /> all unsettled
            </label>
            <Button size="sm" variant="outline" onClick={preview} disabled={busy || !payeeId} className="gap-1.5">{busy && <Loader2Icon className="w-3.5 h-3.5 animate-spin" />} Preview</Button>
          </div>
          {lines && (lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to settle for this period.</p>
          ) : (
            <>
              {isPartner && <p className="text-xs text-muted-foreground">{salesAgent
                ? `Each hospital is invoiced at the price recorded with its usage; ${partner?.name} earns ${partner?.commissionPct}% commission (raised as a PO to them).`
                : `${partner?.name} is invoiced at its dealer price.`}</p>}
              <LinesTable lines={lines} salesAgent={salesAgent} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">{ready.length} line(s) ready · <span className="font-semibold">{rm(total)}</span>{salesAgent && <span className="text-muted-foreground"> · commission {rm(commission)}</span>}{lines.length > ready.length && <span className="text-muted-foreground"> · {lines.length - ready.length} pending (left for later)</span>}</div>
                <Button size="sm" onClick={generate} disabled={busy || ready.length === 0}>{!isPartner ? "Generate invoice + PO" : salesAgent ? "Generate invoices + commission PO" : "Generate invoice"}</Button>
              </div>
            </>
          ))}
        </section>
      ) : (
        <section className="space-y-3">
          {overview.customers.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl py-12 text-center text-sm text-muted-foreground">No unbilled customer usage.</div>
          ) : overview.customers.map((c) => (
            <div key={c.consignmentId} className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm"><Link href={`/dashboard/consignment/${c.consignmentId}`} className="font-mono font-semibold hover:underline">{c.consignmentNo}</Link> · {c.hospital}</div>
                <Button size="sm" onClick={() => invoiceCustomer(c.consignmentId)} disabled={busy}>Create invoice · {rm(c.total)}</Button>
              </div>
              <LinesTable lines={c.lines} />
            </div>
          ))}
        </section>
      )}

      <section className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wide">Settlement history</div>
        {overview.history.length === 0 ? <div className="px-4 py-6 text-sm text-muted-foreground">No settlements yet.</div> : (
          <div className="divide-y divide-border/60">
            {overview.history.map((h) => (
              <div key={h.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <span className="font-medium">{h.type === "customer" ? "Customer" : h.agentName}</span>
                  <span className="text-muted-foreground text-xs"> · {fmtDate(h.createdAt)}{h.periodFrom ? ` · ${new Date(h.periodFrom).toLocaleDateString("en-MY", { month: "long", year: "numeric" })}` : ""}</span>
                  <div className="text-xs">
                    {h.invoices.length > 0
                      ? h.invoices.map((i, k) => <span key={i.id}>{k > 0 && ", "}<Link href={`/dashboard/fulfillment/invoice/${i.id}`} className="font-mono hover:underline">{i.no}</Link></span>)
                      : h.invoiceId && <Link href={`/dashboard/fulfillment/invoice/${h.invoiceId}`} className="font-mono hover:underline">{h.invoiceNo}</Link>}
                    {h.poNo && <span className="font-mono text-muted-foreground"> · {h.type === "partner" ? `commission PO ${h.poNo}` : `PO ${h.poNo} (in ${h.agentName})`}</span>}
                    {h.commission !== null && <span className="text-muted-foreground"> · commission {rm(h.commission)}</span>}
                  </div>
                </div>
                <span className="tabular-nums font-semibold">{rm(h.total)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
