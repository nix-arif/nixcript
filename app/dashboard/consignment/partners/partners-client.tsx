"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandshakeIcon, Loader2Icon, PlusIcon, SearchIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { MachineSetting, type MachineMethod } from "@/components/consignment/machine-setting";
import { getPartnerPriceList, savePartner, searchProductsForPriceList, setPartnerPriceItem, type SavePartnerInput } from "@/server/consign";

type Data = Awaited<ReturnType<typeof import("@/server/consign").listPartners>>;
type Partner = Data["partners"][number];

const EMPTY: SavePartnerInput = {
  name: "", model: "dealer", contactPerson: "", phone: "", email: "", address: "",
  priceMethod: "discount", discountPct: "0", markupPct: "0", commissionPct: "0",
  settlementMode: "manual", settlementFrequency: "monthly", active: true,
  machineMethod: "free", machineFee: "0", machineSharePct: "0", machineCommission: true,
};

function machineTerms(p: Partner) {
  switch (p.machineMethod) {
    case "per_case": return `machines RM ${Number(p.machineFee).toFixed(2)}/case`;
    case "share_of_fee": return `machines ${p.machineSharePct}% of usage fee`;
    case "monthly_rental": return `machines RM ${Number(p.machineFee).toFixed(2)}/month`;
    case "hospital_fee": return "machines: hospital invoiced per case";
    default: return "machines free";
  }
}

function terms(p: Partner) {
  return `${consumableTerms(p)} · ${machineTerms(p)}`;
}

function consumableTerms(p: Partner) {
  if (p.model === "sales_agent") return `${p.commissionPct}% commission`;
  if (p.priceMethod === "price_list") return `Price list (else ${p.discountPct}% off selling price)`;
  if (p.priceMethod === "cost_plus") return `Cost + ${p.markupPct}%`;
  return `${p.discountPct}% off selling price`;
}

export function PartnersClient({ data }: { data: Data }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SavePartnerInput | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await savePartner(editing);
      if (!res.ok) { toast.error(res.title, res.details?.length ? { description: res.details.join(" · ") } : undefined); return; }
      toast.success(`Saved ${editing.name}`);
      setEditing(editing.id ? editing : { ...editing, id: res.id }); // stay open so a new dealer's price list can be filled in
      router.refresh();
    } finally { setSaving(false); }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-4">
      <PageHeader
        title="External agents"
        description="Dealers (you invoice them when they use your stock) and sales agents (you invoice the hospital, they earn commission)"
        action={data.canEdit ? <Button onClick={() => setEditing({ ...EMPTY })} className="gap-2"><PlusIcon className="w-4 h-4" /> New agent</Button> : undefined}
      />

      {editing && <Editor value={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} saving={saving} />}

      {data.partners.length === 0 && !editing ? (
        <div className="border border-dashed border-border rounded-xl py-16 text-center text-sm text-muted-foreground">No external agents yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.partners.map((p) => (
            <button key={p.id} type="button" disabled={!data.canEdit}
              onClick={() => setEditing({
                id: p.id, name: p.name, model: p.model as SavePartnerInput["model"], contactPerson: p.contactPerson ?? "", phone: p.phone ?? "",
                email: p.email ?? "", address: p.address ?? "", priceMethod: p.priceMethod as SavePartnerInput["priceMethod"],
                discountPct: p.discountPct, markupPct: p.markupPct, commissionPct: p.commissionPct,
                settlementMode: p.settlementMode as SavePartnerInput["settlementMode"], settlementFrequency: p.settlementFrequency as SavePartnerInput["settlementFrequency"], active: p.active,
                machineMethod: p.machineMethod as MachineMethod, machineFee: p.machineFee, machineSharePct: p.machineSharePct, machineCommission: p.machineCommission,
              })}
              className={cn("text-left border border-border rounded-xl p-4 hover:bg-muted/30 transition-colors", !p.active && "opacity-60")}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 flex items-center justify-center shrink-0"><HandshakeIcon className="w-4 h-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm break-words">{p.name}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">{p.model === "dealer" ? "Dealer" : "Sales agent"}</span>
                    {!p.active && <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-muted text-muted-foreground">Inactive</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5">{terms(p)} · settled {p.settlementMode === "auto" ? "automatically" : "manually"}, {p.settlementFrequency === "monthly" ? "monthly" : "per report"}</div>
                  <div className="text-xs mt-0.5">{p.onHand > 0 ? `${p.onHand} unit(s) of your stock with them` : "No stock with them"}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Radio<T extends string>({ name, value, onChange, options }: { name: string; value: T; onChange: (v: T) => void; options: [T, string, string][] }) {
  return (
    <div className="space-y-1.5">
      {options.map(([v, label, hint]) => (
        <label key={v} className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} className="mt-1" />
          <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
        </label>
      ))}
    </div>
  );
}

function Editor({ value: v, onChange, onSave, onCancel, saving }: { value: SavePartnerInput; onChange: (v: SavePartnerInput) => void; onSave: () => void; onCancel: () => void; saving: boolean }) {
  const set = (patch: Partial<SavePartnerInput>) => onChange({ ...v, ...patch });
  return (
    <section className="border border-primary/30 bg-primary/5 rounded-xl p-4 space-y-4">
      <div className="text-sm font-semibold">{v.id ? `Edit ${v.name}` : "New external agent"}</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label className="text-xs">Name *</Label><Input value={v.name} onChange={(e) => set({ name: e.target.value })} className="h-9 text-sm bg-background" /></div>
        <div className="space-y-1.5"><Label className="text-xs">Contact person</Label><Input value={v.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} className="h-9 text-sm bg-background" /></div>
        <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={v.phone} onChange={(e) => set({ phone: e.target.value })} className="h-9 text-sm bg-background" /></div>
        <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input value={v.email} onChange={(e) => set({ email: e.target.value })} className="h-9 text-sm bg-background" /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Address</Label><Textarea value={v.address} onChange={(e) => set({ address: e.target.value })} rows={2} className="text-sm resize-none bg-background" /></div>
      </div>

      <div className="border-t border-border pt-4">
        <div className="text-xs font-medium mb-2">How this agent works</div>
        <Radio name="model" value={v.model} onChange={(m) => set({ model: m, machineMethod: "free" })} options={[
          ["dealer", "Dealer", "Sells in its own name. You invoice the dealer at a dealer price when it reports usage."],
          ["sales_agent", "Sales agent", "Sells on your behalf. You invoice each hospital at the selling price; the agent earns commission."],
        ]} />
      </div>

      {v.model === "dealer" ? (
        <div className="border-t border-border pt-4 space-y-2">
          <div className="text-xs font-medium">Dealer price</div>
          <Radio name="pm" value={v.priceMethod} onChange={(m) => set({ priceMethod: m })} options={[
            ["discount", "Discount off selling price", "Product selling price less a discount %."],
            ["price_list", "Dealer price list", "A price per product; unlisted products use the discount below."],
            ["cost_plus", "Cost-plus", "Your unit cost plus a markup %."],
          ]} />
          {v.priceMethod !== "cost_plus" ? (
            <label className="flex items-center gap-2 text-sm">Discount <Input type="number" min="0" max="100" step="0.5" value={v.discountPct} onChange={(e) => set({ discountPct: e.target.value })} className="h-8 w-24 text-sm bg-background" /> % off selling price</label>
          ) : (
            <label className="flex items-center gap-2 text-sm">Markup <Input type="number" min="0" step="0.5" value={v.markupPct} onChange={(e) => set({ markupPct: e.target.value })} className="h-8 w-24 text-sm bg-background" /> % on cost</label>
          )}
          {v.priceMethod === "price_list" && (v.id ? <PriceList partnerId={v.id} /> : <p className="text-xs text-muted-foreground">Save the agent first, then add its price list.</p>)}
        </div>
      ) : (
        <div className="border-t border-border pt-4">
          <label className="flex items-center gap-2 text-sm">Commission <Input type="number" min="0" max="100" step="0.5" value={v.commissionPct} onChange={(e) => set({ commissionPct: e.target.value })} className="h-8 w-24 text-sm bg-background" /> % of the hospital invoice</label>
        </div>
      )}

      <div className="border-t border-border pt-4">
        <MachineSetting kind={v.model} owner="You" consignee={v.name.trim() || "the agent"} name="partner-machine"
          value={{ machineMethod: v.machineMethod ?? "free", machineFee: v.machineFee ?? "0", machineSharePct: v.machineSharePct ?? "0", machineCommission: v.machineCommission }}
          onChange={(m) => set(m)} />
      </div>

      <div className="border-t border-border pt-4 grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-medium mb-1.5">Settlement</div>
          <Radio name="sm" value={v.settlementMode} onChange={(m) => set({ settlementMode: m })} options={[
            ["manual", "Manual", "Someone with the Settle permission generates it."],
            ["auto", "Automatic", "Generated on the schedule beside."],
          ]} />
        </div>
        <div>
          <div className="text-xs font-medium mb-1.5">Frequency</div>
          <Radio name="sf" value={v.settlementFrequency} onChange={(f) => set({ settlementFrequency: f })} options={[
            ["monthly", "Monthly", "One settlement per month."],
            ["per_use", "Per report", "Settled each time usage is recorded."],
          ]} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> Active (can receive new consignments)</label>

      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5">{saving && <Loader2Icon className="w-3.5 h-3.5 animate-spin" />} Save</Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>Close</Button>
      </div>
    </section>
  );
}

function PriceList({ partnerId }: { partnerId: string }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof getPartnerPriceList>>>([]);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ q: string; rows: Awaited<ReturnType<typeof searchProductsForPriceList>> } | null>(null);
  const reload = () => getPartnerPriceList(partnerId).then(setItems).catch(() => setItems([]));
  useEffect(() => { reload(); }, [partnerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => { const rows = await searchProductsForPriceList(q); if (!cancelled) setAnswer({ q, rows }); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  const results = q.trim().length >= 2 && answer?.q === q ? answer.rows : [];
  async function save(productId: string, price: string | null) {
    const res = await setPartnerPriceItem(partnerId, productId, price);
    if (!res.ok) { toast.error(res.title); return; }
    reload();
  }
  return (
    <div className="border border-border rounded-lg bg-background">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">Dealer price list ({items.length})</div>
      {items.map((it) => (
        <div key={it.productId} className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-border/60">
          <span className="font-mono text-xs w-28 shrink-0">{it.productCode}</span>
          <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{it.description}</span>
          <Input defaultValue={it.price} type="number" min="0" step="0.01" onBlur={(e) => { if (e.target.value !== it.price) save(it.productId, e.target.value); }} className="h-7 w-28 text-right text-sm" />
          <button type="button" onClick={() => save(it.productId, null)} className="text-muted-foreground hover:text-destructive p-1" aria-label="Remove"><TrashIcon className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <div className="relative p-2">
        <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a product…" className="pl-8 h-8 text-sm" />
        {results.length > 0 && (
          <div className="absolute z-20 left-2 right-2 top-full mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
            {results.filter((r) => !items.some((i) => i.productId === r.id)).map((r) => (
              <button key={r.id} type="button" onClick={() => { save(r.id, "0"); setQ(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 border-b border-border/40 last:border-0">
                <span className="font-mono text-xs font-medium">{r.productCode}</span> <span className="text-xs text-muted-foreground">{r.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
