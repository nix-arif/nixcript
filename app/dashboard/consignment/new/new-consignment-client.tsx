"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, BuildingIcon, HandshakeIcon, HospitalIcon, Loader2Icon, SearchIcon, TrashIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { isLendable, unitUseLabel } from "@/lib/inventory/constants";
import { createConsignment, searchSendableStock } from "@/server/consign";
import { searchCustomerOrganizations } from "@/server/customer";

type Options = Awaited<ReturnType<typeof import("@/server/consign").getConsignmentFormOptions>>;
type Stock = Awaited<ReturnType<typeof searchSendableStock>>[number];
interface Row { key: string; stock: Stock; qty: string; lotNo: string; unitIds: string[] }

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const today = () => new Date().toISOString().slice(0, 10);

export function NewConsignmentClient({ options, soId, soNo }: { options: Options; soId: string | null; soNo: string | null }) {
  const router = useRouter();
  const [type, setType] = useState<"agent" | "customer" | "partner">(soId ? "customer" : "agent");
  const [partnerId, setPartnerId] = useState(options.partners[0]?.id ?? "");
  const [warehouse, setWarehouse] = useState(options.warehouses[0] ?? "Default");
  const [agentOrgId, setAgentOrgId] = useState(options.agents[0]?.id ?? "");
  const [repId, setRepId] = useState("");
  const [hospital, setHospital] = useState<{ id: string; name: string } | null>(null);
  const [sentDate, setSentDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  const agent = options.agents.find((a) => a.id === agentOrgId);


  const updateRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit() {
    if (type === "agent" && !agentOrgId) { toast.error("Choose the agent company"); return; }
    if (type === "customer" && !hospital) { toast.error("Choose the hospital"); return; }
    if (type === "partner" && !partnerId) { toast.error("Choose the external agent"); return; }
    if (rows.length === 0) { toast.error("Add at least one item"); return; }
    setSaving(true);
    try {
      const res = await createConsignment({
        consigneeType: type,
        agentOrgId: type === "agent" ? agentOrgId : undefined,
        agentRepId: type === "agent" ? repId || null : null,
        partnerId: type === "partner" ? partnerId : undefined,
        customerOrgId: type === "customer" ? hospital!.id : undefined,
        soId,
        sourceWarehouseLabel: warehouse,
        sentDate,
        notes,
        items: rows.map((r) => ({ productId: r.stock.productId, qty: Number(r.qty), lotNo: r.lotNo || null, unitIds: r.unitIds })),
      });
      if (!res.ok) {
        toast.error(res.title, res.details?.length ? { description: <ul className="mt-1 space-y-0.5">{res.details.map((d) => <li key={d}>• {d}</li>)}</ul>, duration: 10000 } : undefined);
        return;
      }
      toast.success(`Consignment ${res.consignmentNo} sent`);
      router.push(`/dashboard/consignment/${res.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <PageHeader
        title="New consignment"
        description={`Send ${options.ownerName} stock to an agent or a customer — it stays ${options.ownerName}'s until it's used`}
        action={<Button variant="outline" size="sm" onClick={() => router.back()} className="gap-1.5"><ArrowLeftIcon className="w-3.5 h-3.5" /> Back</Button>}
      />

      <div className="space-y-4">
        {/* Consignee */}
        <section className="border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold">Send to</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(["agent", "partner", "customer"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={cn("flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  type === t ? "border-primary bg-primary/5 font-medium" : "border-border text-muted-foreground hover:bg-muted/40")}>
                {t === "agent" ? <BuildingIcon className="w-4 h-4 shrink-0" /> : t === "partner" ? <HandshakeIcon className="w-4 h-4 shrink-0" /> : <HospitalIcon className="w-4 h-4 shrink-0" />}
                <span>{t === "agent" ? "Your other company" : t === "partner" ? "External agent" : "Customer (hospital)"}</span>
              </button>
            ))}
          </div>

          {type === "partner" ? (
            options.partners.length === 0 ? (
              <p className="text-xs text-muted-foreground">No external agents yet — <Link href="/dashboard/consignment/partners" className="underline">add a dealer or sales agent</Link> first.</p>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">External agent</Label>
                <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm">
                  {options.partners.map((pt) => <option key={pt.id} value={pt.id}>{pt.name} — {pt.model === "dealer" ? "dealer" : "sales agent"}</option>)}
                </select>
              </div>
            )
          ) : type === "agent" ? (
            options.agents.length === 0 ? (
              <p className="text-xs text-muted-foreground">You have no other companies to consign to.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Agent company</Label>
                  <select value={agentOrgId} onChange={(e) => { setAgentOrgId(e.target.value); setRepId(""); }}
                    className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm">
                    {options.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Where at {agent?.name ?? "the agent"}</Label>
                  <select value={repId} onChange={(e) => setRepId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm">
                    <option value="">Their warehouse</option>
                    {agent?.reps.map((r) => <option key={r.id} value={r.id}>Specialist: {r.name}</option>)}
                  </select>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">Hospital</Label>
              {hospital ? (
                <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><HospitalIcon className="w-4 h-4 text-muted-foreground" />{hospital.name}</span>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setHospital(null)}>Change</Button>
                </div>
              ) : (
                <HospitalPicker onPick={setHospital} />
              )}
              {soNo && <p className="text-[11px] text-muted-foreground">Linked to sales order {soNo}</p>}
            </div>
          )}
        </section>

        {/* Source + dates */}
        <section className="border border-border rounded-xl p-4 grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">From warehouse ({options.ownerName})</Label>
            {/* Changing warehouse clears picked stock — availability is per warehouse */}
            <select value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setRows([]); }} className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm">
              {options.warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sent date</Label>
            <Input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} className="h-9 text-sm" />
          </div>
        </section>

        {/* Items */}
        <section className="border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold">Items</h2>
          <StockPicker warehouse={warehouse} excluded={rows.filter((r) => r.stock.serial || r.stock.lots.length === 0).map((r) => r.stock.productId)}
            onPick={(s) => setRows((rs) => [...rs, { key: `${s.productId}-${Date.now()}`, stock: s, qty: s.serial ? "" : "1", lotNo: s.lots.length === 1 ? s.lots[0].lotNo : "", unitIds: [] }])} />
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Search above to add stock from {warehouse}.</p>
          ) : (
            <div className="divide-y divide-border border border-border rounded-lg">
              {rows.map((r) => (
                <div key={r.key} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-medium">{r.stock.productCode}</div>
                      <div className="text-xs text-muted-foreground break-words">{r.stock.description}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{fmtQty(r.stock.available)} {r.stock.uom ?? ""} available at {warehouse}</div>
                    </div>
                    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-muted-foreground hover:text-destructive p-1" aria-label="Remove">
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                  {r.stock.serial ? (
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1">Serial numbers ({r.unitIds.length} selected)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {r.stock.units.length === 0 && <span className="text-xs text-muted-foreground">No registered units in stock here.</span>}
                        {r.stock.units.map((u) => {
                          const on = r.unitIds.includes(u.id);
                          return (
                            <button key={u.id} type="button"
                              onClick={() => updateRow(r.key, { unitIds: on ? r.unitIds.filter((x) => x !== u.id) : [...r.unitIds, u.id] })}
                              className={cn("font-mono text-xs rounded-md border px-2 py-1", on ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}>
                              {u.serialNo}
                              <span className={cn("ml-1.5 font-sans", isLendable(u.intendedUse) ? "text-amber-700 dark:text-amber-400" : "opacity-60")}>{unitUseLabel(u.intendedUse).toLowerCase()}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-end gap-3">
                      {r.stock.lots.length > 0 && (
                        <div className="space-y-1">
                          <Label className="text-[11px]">Lot</Label>
                          <select value={r.lotNo} onChange={(e) => updateRow(r.key, { lotNo: e.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                            <option value="">Choose lot…</option>
                            {r.stock.lots.map((l) => (
                              <option key={l.lotNo} value={l.lotNo}>
                                {l.lotNo} · {fmtQty(l.qty)}{l.expiryDate ? ` · exp ${new Date(l.expiryDate).toLocaleDateString("en-MY", { month: "short", year: "numeric" })}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-[11px]">Quantity</Label>
                        <Input type="number" min="0" step="1" inputMode="decimal" value={r.qty} onChange={(e) => updateRow(r.key, { qty: e.target.value })} className="h-9 w-28 text-sm" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border border-border rounded-xl p-4 space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" className="text-sm resize-none" />
        </section>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={saving} className="gap-2 min-w-40">
            {saving && <Loader2Icon className="w-4 h-4 animate-spin" />} Send consignment
          </Button>
        </div>
      </div>
    </div>
  );
}

// Results are keyed by the query they answer, so "loading" and stale results
// are derived during render instead of being reset from inside the effect.
function useDebouncedSearch<T>(fn: (q: string) => Promise<T[]>, deps: unknown[] = []) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ key: string; results: T[] } | null>(null);
  const key = JSON.stringify([q.trim(), ...deps]);
  const active = q.trim().length >= 2;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try { const r = await fn(q); if (!cancelled) setAnswer({ key, results: r }); }
      catch { if (!cancelled) setAnswer({ key, results: [] }); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  const fresh = active && answer?.key === key;
  return { q, setQ, results: fresh ? answer!.results : [], loading: active && !fresh };
}

function StockPicker({ warehouse, excluded, onPick }: { warehouse: string; excluded: string[]; onPick: (s: Stock) => void }) {
  const { q, setQ, results, loading } = useDebouncedSearch((query) => searchSendableStock(query, warehouse), [warehouse]);
  const shown = results.filter((r) => !excluded.includes(r.productId));
  return (
    <div className="relative">
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search stock in ${warehouse}…`} className="pl-9 pr-9 h-10 text-sm" autoComplete="off" />
      {loading && <Loader2Icon className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      {q.trim().length >= 2 && !loading && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          {shown.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">No stock matching “{q.trim()}” in {warehouse}.</div>
          ) : shown.map((s) => (
            <button key={s.productId} type="button" onClick={() => { onPick(s); setQ(""); }}
              className="w-full text-left px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/40">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium">{s.productCode}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{fmtQty(s.available)} {s.uom ?? ""}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate">{s.description}</div>
              {(s.serial || s.lots.length > 0) && (
                <div className="text-[10px] text-muted-foreground mt-0.5">{s.serial ? `serial-tracked · ${s.units.length} unit(s)` : `${s.lots.length} lot(s)`}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HospitalPicker({ onPick }: { onPick: (h: { id: string; name: string }) => void }) {
  const { q, setQ, results, loading } = useDebouncedSearch((query) => searchCustomerOrganizations(query));
  return (
    <div className="relative">
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hospital…" className="pl-9 pr-9 h-10 text-sm" autoComplete="off" />
      {loading ? <Loader2Icon className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
        : q && <button type="button" onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><XIcon className="w-3.5 h-3.5" /></button>}
      {q.trim().length >= 2 && !loading && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          {results.length === 0 ? <div className="px-3 py-3 text-xs text-muted-foreground">No hospital matches “{q.trim()}”.</div>
            : results.map((h) => (
              <button key={h.id} type="button" onClick={() => { onPick({ id: h.id, name: h.name }); setQ(""); }}
                className="w-full text-left px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/40">
                <div className="text-sm font-medium">{h.name}</div>
                {h.address && <div className="text-[11px] text-muted-foreground truncate">{h.address.replace(/\s*\n\s*/g, ", ")}</div>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
