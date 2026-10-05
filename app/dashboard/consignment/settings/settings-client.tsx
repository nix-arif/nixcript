"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2Icon, SearchIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { MachineSetting } from "@/components/consignment/machine-setting";
import { getPriceList, saveConsignmentPairSetting, saveConsignmentSetting, searchProductsForPriceList, setPriceListItem } from "@/server/consign";

type Settings = Awaited<ReturnType<typeof import("@/server/consign").getConsignmentSettings>>;
type Pair = Settings["pairs"][number];

function Radio<T extends string>({ name, value, onChange, options, disabled }: { name: string; value: T; onChange: (v: T) => void; options: [T, string, string][]; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      {options.map(([v, label, hint]) => (
        <label key={v} className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} disabled={disabled} className="mt-1" />
          <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
        </label>
      ))}
    </div>
  );
}

async function run(fn: () => Promise<{ ok: true } | { ok: false; title: string; details?: string[] }>, okMsg: string) {
  const res = await fn();
  if (res.ok) toast.success(okMsg);
  else toast.error(res.title, res.details?.length ? { description: res.details.join(" · ") } : undefined);
}

export function ConsignmentSettingsClient({ settings }: { settings: Settings }) {
  const [own, setOwn] = useState(settings.setting);
  const [saving, setSaving] = useState(false);
  const dis = !settings.canEdit;

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4">
      <PageHeader title="Consignment settings" description={`Rules ${settings.orgName} decides for its own consignments`} />
      {dis && <p className="text-xs text-muted-foreground">You can view these settings; changing them needs the “Send / Return Consignment Stock & Settings” permission.</p>}

      <section className="border border-border rounded-xl p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">When {settings.orgName} is the agent</h2>
          <p className="text-xs text-muted-foreground">Which stock a Case DO uses first when a specialist holds both consigned stock and {settings.orgName}&apos;s own.</p>
        </div>
        <Radio name="order" value={own.consumeOrder} onChange={(v) => setOwn({ ...own, consumeOrder: v })} disabled={dis} options={[
          ["consigned_first", "Consigned stock first", "Use the owner company's stock before your own (it gets settled sooner)."],
          ["own_first", "Own stock first", "Use your own stock; consigned stock only when your own runs out."],
        ]} />
        <div className="border-t border-border pt-4">
          <h2 className="text-sm font-semibold">When {settings.orgName} is the owner</h2>
          <p className="text-xs text-muted-foreground mb-2">How often your consignment locations should be counted.</p>
          <Radio name="count" value={own.countFrequency} onChange={(v) => setOwn({ ...own, countFrequency: v })} disabled={dis} options={[
            ["monthly", "Monthly", "Count every location each month."],
            ["quarterly", "Quarterly", "Count every location each quarter."],
            ["none", "Only when needed", "No scheduled counts."],
          ]} />
        </div>
        {!dis && (
          <Button size="sm" disabled={saving} onClick={async () => { setSaving(true); await run(() => saveConsignmentSetting(own), "Settings saved"); setSaving(false); }} className="gap-1.5">
            {saving && <Loader2Icon className="w-3.5 h-3.5 animate-spin" />} Save
          </Button>
        )}
      </section>

      {settings.pairs.length > 0 && (
        <div className="pt-2">
          <h2 className="text-sm font-semibold">Consignment terms with your other companies</h2>
          <p className="text-xs text-muted-foreground">Consignment with a company runs only on terms set up here. Until then nothing can be sent to it, its specialists can&apos;t use {settings.orgName}&apos;s stock on Case DOs, and nothing is settled — stock already there can still be returned.</p>
        </div>
      )}
      {settings.pairs.map((p) => <PairCard key={p.agentOrgId} owner={settings.orgName} pair={p} disabled={dis} />)}
    </div>
  );
}

const PRICE_SUMMARY: Record<Pair["priceMethod"], (p: Pair) => string> = {
  cost_plus: (p) => `cost + ${Number(p.markupPct)}%`,
  price_list: (p) => `fixed price list (others cost + ${Number(p.markupPct)}%)`,
  pct_of_sale: (p) => `${Number(p.sharePct)}% of the selling price`,
};
const MACHINE_SUMMARY: Record<string, (p: Pair) => string> = {
  free: () => "free",
  per_case: (p) => `RM ${Number(p.machineFee).toFixed(2)} per case`,
  share_of_fee: (p) => `${Number(p.machineSharePct)}% of the usage fee`,
  monthly_rental: (p) => `RM ${Number(p.machineFee).toFixed(2)} per machine per month`,
  hospital_fee: () => "hospital invoiced per case",
};

function PairCard({ owner, pair, disabled }: { owner: string; pair: Pair; disabled: boolean }) {
  const [p, setP] = useState(pair);
  const [saved, setSaved] = useState(pair); // what Cancel goes back to
  const [configured, setConfigured] = useState(pair.configured);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const head = (
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <h2 className="text-sm font-semibold">{owner} → {p.agentName}</h2>
        <p className="text-xs text-muted-foreground">How {owner}&apos;s stock placed with {p.agentName} is handled and billed.</p>
      </div>
      {configured
        ? <span className="text-[11px] font-medium rounded px-2 py-0.5 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">Active</span>
        : <span className="text-[11px] font-medium rounded px-2 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">Not set up</span>}
    </div>
  );

  if (!editing) {
    return (
      <section className={cn("border rounded-xl p-4 space-y-3", configured ? "border-border" : "border-dashed border-amber-300 dark:border-amber-700")}>
        {head}
        {configured ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Settlement</dt><dd>{p.settlementMode === "auto" ? "Automatic" : "Manual"}, {p.settlementFrequency === "per_use" ? "per use (each Case DO)" : "monthly"}</dd>
            <dt className="text-muted-foreground">Consumables</dt><dd>{PRICE_SUMMARY[p.priceMethod](p)}</dd>
            <dt className="text-muted-foreground">Machines</dt><dd>{(MACHINE_SUMMARY[p.machineMethod] ?? (() => p.machineMethod))(p)}</dd>
            <dt className="text-muted-foreground">At its customers</dt><dd>{p.allowPassOn ? `${p.agentName} may place this stock at hospitals` : "Not allowed"}</dd>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">No consignment with {p.agentName} until terms are set: {owner} can&apos;t send stock to it, its specialists can&apos;t use {owner}&apos;s stock on Case DOs, and nothing is settled.</p>
        )}
        {!disabled && (
          <Button size="sm" variant={configured ? "outline" : "default"} onClick={() => setEditing(true)}>
            {configured ? "Edit terms" : "Set up terms"}
          </Button>
        )}
      </section>
    );
  }

  return (
    <section className="border border-primary/40 rounded-xl p-4 space-y-4">
      {head}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={p.allowPassOn} onChange={(e) => setP({ ...p, allowPassOn: e.target.checked })} disabled={disabled} className="mt-1" />
        <span><span className="font-medium">Allow {p.agentName} to place this stock at its customers</span>
          <span className="block text-xs text-muted-foreground">e.g. put {owner} stock on consignment at a hospital through {p.agentName}.</span></span>
      </label>

      <div className="grid sm:grid-cols-2 gap-4 border-t border-border pt-4">
        <div>
          <div className="text-xs font-medium mb-1.5">Settlement</div>
          <Radio name={`mode-${p.agentOrgId}`} value={p.settlementMode} onChange={(v) => setP({ ...p, settlementMode: v })} disabled={disabled} options={[
            ["manual", "Manual", "Someone with the Settle permission generates it."],
            ["auto", "Automatic", "Generated on the schedule below."],
          ]} />
        </div>
        <div>
          <div className="text-xs font-medium mb-1.5">Frequency</div>
          <Radio name={`freq-${p.agentOrgId}`} value={p.settlementFrequency} onChange={(v) => setP({ ...p, settlementFrequency: v })} disabled={disabled} options={[
            ["monthly", "Monthly", "One intercompany invoice + PO per month."],
            ["per_use", "Per use", "One per Case DO that used consigned stock."],
          ]} />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <div className="text-xs font-medium mb-1.5">Transfer price for consumables ({owner} charges {p.agentName} per unit used)</div>
        <Radio name={`price-${p.agentOrgId}`} value={p.priceMethod} onChange={(v) => setP({ ...p, priceMethod: v })} disabled={disabled} options={[
          ["cost_plus", "Cost-plus", `${owner}'s unit cost + a markup %.`],
          ["price_list", "Fixed price list", "An intercompany price per product; unlisted products fall back to cost-plus."],
          ["pct_of_sale", "% of selling price", `A share of what ${p.agentName} invoiced the customer.`],
        ]} />
        {p.priceMethod === "cost_plus" && (
          <label className="flex items-center gap-2 text-sm mt-2">Markup
            <Input type="number" min="0" step="0.5" value={p.markupPct} onChange={(e) => setP({ ...p, markupPct: e.target.value })} disabled={disabled} className="h-8 w-24 text-sm" /> %
          </label>
        )}
        {p.priceMethod === "price_list" && (
          <>
            <label className="flex items-center gap-2 text-sm mt-2">Fallback markup
              <Input type="number" min="0" step="0.5" value={p.markupPct} onChange={(e) => setP({ ...p, markupPct: e.target.value })} disabled={disabled} className="h-8 w-24 text-sm" /> % on cost
            </label>
            <PriceList agentOrgId={p.agentOrgId} disabled={disabled} />
          </>
        )}
        {p.priceMethod === "pct_of_sale" && (
          <label className="flex items-center gap-2 text-sm mt-2">Share
            <Input type="number" min="0" max="100" step="0.5" value={p.sharePct} onChange={(e) => setP({ ...p, sharePct: e.target.value })} disabled={disabled} className="h-8 w-24 text-sm" /> % to {owner}
          </label>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <MachineSetting kind="agent" owner={owner} consignee={p.agentName} name={`machine-${p.agentOrgId}`} disabled={disabled}
          value={{ machineMethod: p.machineMethod, machineFee: p.machineFee, machineSharePct: p.machineSharePct }}
          onChange={(v) => setP({ ...p, ...v })} />
      </div>

      {!disabled && (
        <div className="flex gap-2">
          <Button size="sm" disabled={saving} className="gap-1.5" onClick={async () => {
            setSaving(true);
            const res = await saveConsignmentPairSetting({ agentOrgId: p.agentOrgId, allowPassOn: p.allowPassOn, settlementMode: p.settlementMode, settlementFrequency: p.settlementFrequency, priceMethod: p.priceMethod, markupPct: p.markupPct, sharePct: p.sharePct, machineMethod: p.machineMethod, machineFee: p.machineFee, machineSharePct: p.machineSharePct });
            setSaving(false);
            if (!res.ok) { toast.error(res.title, res.details?.length ? { description: res.details.join(" · ") } : undefined); return; }
            toast.success(configured ? `Saved ${owner} → ${p.agentName}` : `Consignment with ${p.agentName} is now active`);
            setSaved(p); setConfigured(true); setEditing(false);
          }}>
            {saving && <Loader2Icon className="w-3.5 h-3.5 animate-spin" />} {configured ? "Save" : "Save and activate"}
          </Button>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => { setP(saved); setEditing(false); }}>Cancel</Button>
        </div>
      )}
    </section>
  );
}

function PriceList({ agentOrgId, disabled }: { agentOrgId: string; disabled: boolean }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof getPriceList>>>([]);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ q: string; results: Awaited<ReturnType<typeof searchProductsForPriceList>> } | null>(null);
  const results = q.trim().length >= 2 && answer?.q === q ? answer.results : [];
  const reload = () => getPriceList(agentOrgId).then(setItems).catch(() => setItems([]));
  useEffect(() => { reload(); }, [agentOrgId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => { const r = await searchProductsForPriceList(q); if (!cancelled) setAnswer({ q, results: r }); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  async function save(productId: string, price: string | null) {
    const res = await setPriceListItem(agentOrgId, productId, price);
    if (!res.ok) { toast.error(res.title); return; }
    reload();
  }

  return (
    <div className="mt-3 border border-border rounded-lg">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">Price list ({items.length})</div>
      {items.length > 0 && (
        <div className="divide-y divide-border/60">
          {items.map((it) => (
            <div key={it.productId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="font-mono text-xs w-28 shrink-0">{it.productCode}</span>
              <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{it.description}</span>
              <Input defaultValue={it.price} type="number" min="0" step="0.01" disabled={disabled}
                onBlur={(e) => { if (e.target.value !== it.price) save(it.productId, e.target.value); }}
                className="h-7 w-28 text-right text-sm" />
              {!disabled && <button type="button" onClick={() => save(it.productId, null)} className="text-muted-foreground hover:text-destructive p-1" aria-label="Remove"><TrashIcon className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="relative p-2">
          <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a product…" className="pl-8 h-8 text-sm" />
          {results.length > 0 && (
            <div className="absolute z-20 left-2 right-2 top-full mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
              {results.filter((r) => !items.some((i) => i.productId === r.id)).map((r) => (
                <button key={r.id} type="button" onClick={() => { save(r.id, r.costUnitPrice ?? "0"); setQ(""); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 border-b border-border/40 last:border-0">
                  <span className="font-mono text-xs font-medium">{r.productCode}</span> <span className="text-xs text-muted-foreground">{r.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
