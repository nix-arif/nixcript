"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangleIcon, CheckCircle2Icon, ClipboardCheckIcon, HistoryIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldIcon, XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { resolveShortfall, saveStockRules, type ShortfallRow } from "@/server/stock-rules";
import { searchProducts } from "@/server/inventory";
import type { StockRuleMode, StockRules } from "@/lib/inventory/stock-rules";

type Data = Awaited<ReturnType<typeof import("@/server/stock-rules").getStockRulesPage>>;

const MODES: { key: StockRuleMode; title: string; icon: React.ElementType; when: string; what: string; tone: string }[] = [
  { key: "record_flag", title: "Record & flag", icon: ShieldIcon, when: "Pilot — stock not reconciled yet",
    what: "Usage beyond what's held is saved; the gap is listed under Shortfalls to reconcile.", tone: "text-blue-700 dark:text-blue-400" },
  { key: "warn", title: "Warn", icon: ShieldAlertIcon, when: "The last weeks before going live",
    what: "Same, but the person recording sees a warning and must give a reason.", tone: "text-amber-700 dark:text-amber-400" },
  { key: "enforce", title: "Enforce", icon: ShieldCheckIcon, when: "Stock reconciled",
    what: "Refused — transfer the stock, take it from another location, or correct the count first.", tone: "text-green-700 dark:text-green-400" },
];
const RESOLUTION: Record<string, string> = { transfer: "Transferred the stock", adjustment: "Corrected the count", explained: "Explained" };
const day = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const q = (v: string) => String(+parseFloat(v).toFixed(4));

export function StockRulesClient({ data }: { data: Data }) {
  const router = useRouter();
  const ro = !data.canEdit;
  const [r, setR] = useState<StockRules>(data.rules);
  const [enforceFrom, setEnforceFrom] = useState(data.rules.enforceFrom ? new Date(data.rules.enforceFrom).toISOString().slice(0, 10) : "");
  const [products, setProducts] = useState(data.exemptProducts);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<StockRules>) => setR((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify({ ...r, enforceFrom: null }) !== JSON.stringify({ ...data.rules, enforceFrom: null })
    || enforceFrom !== (data.rules.enforceFrom ? new Date(data.rules.enforceFrom).toISOString().slice(0, 10) : "");
  const ready = data.readiness.openShortfalls === 0 && data.readiness.notCounted.length === 0 && data.readiness.negativeBalances === 0;

  async function save() {
    if (r.mode === "enforce" && data.rules.mode !== "enforce" && !ready
      && !confirm("The readiness checklist isn't all green. Enforce anyway? Case DOs will be refused wherever the records don't match what people hold.")) return;
    setSaving(true);
    const res = await saveStockRules({ ...r, enforceFrom: r.mode === "enforce" && enforceFrom ? new Date(enforceFrom) : null });
    setSaving(false);
    if (!res.ok) { toast.error(res.title); return; }
    toast.success("Stock rules saved");
    router.refresh();
  }

  const current = MODES.find((m) => m.key === data.modeNow)!;
  return (
    <div className="p-4 sm:p-6 max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold">Stock Rules</h1>
          <p className="text-sm text-muted-foreground">How strictly {data.orgName}&apos;s Case DOs must be covered by stock someone actually holds.</p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", current.tone)}>
          <current.icon className="h-3.5 w-3.5" /> Now: {current.title}
          {data.rules.mode === "enforce" && data.modeNow === "warn" && data.rules.enforceFrom && <> · enforce from {day(data.rules.enforceFrom)}</>}
        </span>
      </div>
      {ro && <p className="text-xs text-muted-foreground">You can view these rules; changing them needs the Manage Inventory Settings permission.</p>}

      <div className="grid lg:grid-cols-[1fr_20rem] gap-5 items-start">
        <div className="space-y-5">
          {/* 1. Mode */}
          <Section n={1} title="Stock check on Case DOs">
            <div className="grid sm:grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button key={m.key} type="button" disabled={ro} onClick={() => set({ mode: m.key, ...(m.key === "enforce" ? { allowNegative: false } : {}) })}
                  className={cn("rounded-xl border p-3 text-left transition-colors disabled:cursor-default", r.mode === m.key ? "border-foreground bg-muted/40 ring-1 ring-foreground" : "hover:bg-muted/30")}>
                  <div className={cn("flex items-center gap-1.5 text-sm font-semibold", m.tone)}><m.icon className="h-4 w-4" />{m.title}</div>
                  <div className="mt-1 text-[11px] font-medium text-muted-foreground">{m.when}</div>
                  <div className="mt-1 text-xs">{m.what}</div>
                </button>
              ))}
            </div>
            {r.mode === "enforce" && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <Label htmlFor="ef" className="text-xs">Enforce from</Label>
                <Input id="ef" type="date" value={enforceFrom} onChange={(e) => setEnforceFrom(e.target.value)} disabled={ro} className="h-9 w-44" />
                <span className="text-xs text-muted-foreground">{enforceFrom ? "Warn applies until then, so people get notice." : "Leave empty to enforce straight away."}</span>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">In every mode a shortfall is recorded and shown — it never disappears silently. Machines (serial numbers) must always be held by the person or taken from where the unit is.</p>
          </Section>

          {/* 2. When */}
          <Section n={2} title="When the check applies">
            <Check checked={r.checkOnRecord} disabled={ro} onChange={(v) => set({ checkOnRecord: v })}
              label="When recording the actual items used" hint="Where stock really moves — also covers “case done — record now” on the create form. Off: shortfalls are only recorded and flagged." />
            <Check checked={r.checkOnCreate} disabled={ro} onChange={(v) => set({ checkOnCreate: v })}
              label="When creating a Case DO" hint="The specialist must hold the template's items. The customer copy moves no stock, so leave this off to let DOs be prepared before stock arrives." />
          </Section>

          {/* 3. Where */}
          <Section n={3} title="Where stock may come from">
            <p className="text-xs text-muted-foreground mb-2">Always counted: the specialist&apos;s own field stock, and consigned stock whose owner has set up terms.</p>
            <Check checked={r.allowTakenFrom} disabled={ro} onChange={(v) => set({ allowTakenFrom: v })}
              label="Allow “taken from” another location" hint="A line can be taken from one of your warehouses or another of your people — it's deducted there. For shared cases, borrowed items and external specialists." />
            <Check checked={r.allowNegative} disabled={ro || r.mode === "enforce"} onChange={(v) => set({ allowNegative: v })}
              label="Allow negative balances (Record & flag / Warn only)" hint="Show the true gap as a negative balance instead of stopping at 0." />
          </Section>

          {/* 4. Exceptions */}
          <Section n={4} title="Exceptions — not checked yet">
            <p className="text-xs text-muted-foreground mb-2">Items still being counted during a staged rollout. Their shortfalls are recorded and flagged, never refused.</p>
            {data.groups.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {data.groups.map((g) => {
                  const on = r.exemptGroupIds.includes(g.id);
                  return (
                    <button key={g.id} type="button" disabled={ro} onClick={() => set({ exemptGroupIds: on ? r.exemptGroupIds.filter((x) => x !== g.id) : [...r.exemptGroupIds, g.id] })}
                      className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "bg-foreground text-background border-foreground" : "hover:bg-muted")}>
                      {g.name}
                    </button>
                  );
                })}
              </div>
            ) : <p className="text-xs text-muted-foreground">No item groups yet (Inventory → Item Groups).</p>}
            <ProductExceptions ro={ro} products={products} onChange={(list) => { setProducts(list); set({ exemptProductIds: list.map((p) => p.id) }); }} />
          </Section>

          {/* 5. Override */}
          <Section n={5} title="Override when enforcing">
            <p className="text-xs text-muted-foreground">People whose role has <b className="text-foreground">Record Case DO usage without enough stock</b> can still record a refused shortfall, with a reason. It&apos;s marked as an override in the shortfall list. Grant it in Organization → Roles, sparingly.</p>
          </Section>
        </div>

        {/* Readiness */}
        <div className="space-y-3 lg:sticky lg:top-16">
          <div className={cn("rounded-xl border p-4", ready ? "border-green-300 dark:border-green-800" : "border-amber-300 dark:border-amber-700")}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheckIcon className="h-4 w-4" /> Ready to enforce?
            </div>
            <ul className="mt-3 space-y-2.5 text-xs">
              <Ready ok={data.readiness.openShortfalls === 0} text={data.readiness.openShortfalls ? `${data.readiness.openShortfalls} shortfall(s) to reconcile` : "No open shortfalls"} />
              <Ready ok={data.readiness.notCounted.length === 0}
                text={data.readiness.notCounted.length ? `${data.readiness.notCounted.length} specialist(s) not counted in ${data.readiness.countDays} days` : `Every specialist counted in the last ${data.readiness.countDays} days`}
                detail={data.readiness.notCounted.slice(0, 8).map((h) => `${h.name} — ${h.last ? `last ${day(h.last)}` : "never"}`)} />
              <Ready ok={data.readiness.negativeBalances === 0} text={data.readiness.negativeBalances ? `${data.readiness.negativeBalances} negative balance(s)` : "No negative balances"} />
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">A count = an approved Adjustment or Opening Balance on the specialist&apos;s field stock.</p>
          </div>
          {!ro && (
            <Button className="w-full" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save stock rules" : "Saved"}</Button>
          )}
        </div>
      </div>

      <Shortfalls rows={data.shortfalls} canEdit={data.canEdit} />

      <section className="rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><HistoryIcon className="h-4 w-4" /> Changes to these rules</h2>
        {data.log.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No changes yet — the defaults apply (Record & flag, checked when recording).</p> : (
          <ul className="mt-2 divide-y text-xs">
            {data.log.map((l) => (
              <li key={l.id} className="py-2 flex flex-col sm:flex-row sm:gap-3">
                <span className="text-muted-foreground shrink-0 sm:w-44">{new Date(l.createdAt).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })} · {l.changedByName ?? "—"}</span>
                <span>{l.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4">
      <h2 className="text-sm font-semibold mb-3"><span className="text-muted-foreground mr-1.5">{n}.</span>{title}</h2>
      {children}
    </section>
  );
}

function Check({ checked, disabled, onChange, label, hint }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className={cn("flex items-start gap-2.5 py-1.5", disabled ? "opacity-60" : "cursor-pointer")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4" />
      <span><span className="text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
    </label>
  );
}

function Ready({ ok, text, detail }: { ok: boolean; text: string; detail?: string[] }) {
  return (
    <li className="flex gap-2">
      {ok ? <CheckCircle2Icon className="h-4 w-4 shrink-0 text-green-600" /> : <AlertTriangleIcon className="h-4 w-4 shrink-0 text-amber-600" />}
      <span>
        {text}
        {!ok && detail && detail.length > 0 && <span className="mt-1 block text-[11px] text-muted-foreground">{detail.join(" · ")}</span>}
      </span>
    </li>
  );
}

function ProductExceptions({ ro, products, onChange }: { ro: boolean; products: { id: string; code: string; description: string | null }[]; onChange: (p: { id: string; code: string; description: string | null }[]) => void }) {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<{ q: string; rows: { id: string; productCode: string; description: string | null }[] } | null>(null);
  useEffect(() => {
    if (term.trim().length < 2) return;
    let off = false;
    const t = setTimeout(() => { searchProducts(term).then((rows) => { if (!off) setFound({ q: term, rows }); }).catch(() => {}); }, 250);
    return () => { off = true; clearTimeout(t); };
  }, [term]);
  const results = found && found.q === term && term.trim().length >= 2 ? found.rows.filter((r) => !products.some((p) => p.id === r.id)).slice(0, 8) : [];
  return (
    <div className="mt-3 space-y-2">
      {products.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {products.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
              <span className="font-mono">{p.code}</span>
              {!ro && <button type="button" onClick={() => onChange(products.filter((x) => x.id !== p.id))} aria-label="Remove"><XIcon className="h-3 w-3" /></button>}
            </span>
          ))}
        </div>
      )}
      {!ro && (
        <div className="relative sm:max-w-sm">
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Add a product exception…" className="h-9" />
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border bg-background shadow-lg">
              {results.map((r) => (
                <button key={r.id} type="button" onClick={() => { onChange([...products, { id: r.id, code: r.productCode, description: r.description }]); setTerm(""); }}
                  className="block w-full border-b px-3 py-2 text-left text-xs last:border-0 hover:bg-muted/40">
                  <span className="font-mono font-medium">{r.productCode}</span> <span className="text-muted-foreground">{r.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Shortfalls({ rows, canEdit }: { rows: ShortfallRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<"open" | "resolved">("open");
  const [resolving, setResolving] = useState<null | { row: ShortfallRow; resolution: "transfer" | "adjustment" | "explained"; note: string }>(null);
  const [busy, setBusy] = useState(false);
  const shown = rows.filter((r) => r.status === view);
  const open = rows.filter((r) => r.status === "open").length;

  async function save() {
    if (!resolving) return;
    setBusy(true);
    const res = await resolveShortfall(resolving.row.id, resolving.resolution, resolving.note);
    setBusy(false);
    if (!res.ok) { toast.error(res.title); return; }
    toast.success("Shortfall resolved");
    setResolving(null);
    router.refresh();
  }

  return (
    <section className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold mr-auto">Shortfalls to reconcile</h2>
        <div className="inline-flex rounded-lg bg-muted p-1">
          {(["open", "resolved"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setView(k)} className={cn("px-3 h-7 rounded-md text-xs", view === k ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
              {k === "open" ? `Open (${open})` : `Resolved (${rows.length - open})`}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Case DO usage recorded beyond what the location held. Fix the records — transfer what was really there, or correct the count — then mark it resolved.</p>
      {shown.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{view === "open" ? "Nothing to reconcile." : "No resolved shortfalls yet."}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {shown.map((s) => {
            const repId = s.locationLabel.startsWith("Field:") ? s.locationLabel.slice(6).split(":")[0] : null;
            return (
              <div key={s.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm"><span className="font-mono font-semibold">{s.productCode}</span> · {s.locationName}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.deliveryOrderId ? <Link href={`/dashboard/fulfillment/delivery/${s.deliveryOrderId}`} className="text-primary hover:underline">{s.doNo}</Link> : s.doNo}
                      {" · "}{day(s.createdAt)}{s.recordedByName ? ` · by ${s.recordedByName}` : ""}
                    </div>
                  </div>
                  <div className="text-right text-xs tabular-nums">
                    <div>used <b>{q(s.usedQty)}</b> · held <b>{q(s.heldQty)}</b></div>
                    <div className="font-semibold text-amber-700 dark:text-amber-400">short {q(s.shortQty)}</div>
                  </div>
                </div>
                {(s.reason || s.override) && (
                  <p className="mt-1.5 text-xs">
                    {s.override && <span className="mr-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/20 dark:text-red-400">override</span>}
                    {s.reason && <span className="text-muted-foreground">“{s.reason}”</span>}
                  </p>
                )}
                {s.status === "resolved" ? (
                  <p className="mt-1.5 text-xs text-green-700 dark:text-green-400">{RESOLUTION[s.resolution ?? ""] ?? "Resolved"}{s.resolutionNote ? ` — ${s.resolutionNote}` : ""} · {s.resolvedByName ?? "—"}, {day(s.resolvedAt)}</p>
                ) : canEdit && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {repId && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => router.push(`/dashboard/inventory/field-stock/transfer?rep=${repId}`)}>Transfer to {s.locationName}</Button>}
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => router.push(`/dashboard/inventory/movements?new=1&location=${encodeURIComponent(s.locationLabel)}&product=${encodeURIComponent(s.productId)}`)}>Correct the count</Button>
                    <Button size="sm" className="h-8 text-xs" onClick={() => setResolving({ row: s, resolution: repId ? "transfer" : "adjustment", note: "" })}>Mark resolved</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!resolving} onOpenChange={(v) => { if (!v && !busy) setResolving(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Mark shortfall resolved</DialogTitle></DialogHeader>
          {resolving && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground"><span className="font-mono">{resolving.row.productCode}</span> · {resolving.row.locationName} · short {q(resolving.row.shortQty)} on {resolving.row.doNo}</p>
              <div className="space-y-1.5">
                {(["transfer", "adjustment", "explained"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={resolving.resolution === k} onChange={() => setResolving({ ...resolving, resolution: k })} />{RESOLUTION[k]}
                  </label>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Note{resolving.resolution === "explained" ? " *" : " (optional)"}</Label>
                <Input value={resolving.note} onChange={(e) => setResolving({ ...resolving, note: e.target.value })} placeholder="e.g. 2 transferred to Fareez on 6 Oct" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Mark resolved"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
