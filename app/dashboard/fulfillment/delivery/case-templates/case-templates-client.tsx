"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardListIcon, Loader2Icon, PencilIcon, PlusIcon, SearchIcon, StarIcon, TrashIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { deleteCaseTemplate, getDoctorHospitals, makeCaseTemplateDefault, saveCaseTemplate, searchTemplateProducts, type CaseTemplateRow } from "@/server/case-template";
import { CaseCustomerPicker } from "../create/create-do-client";
import { customerViewSummary } from "@/components/customer-view-editor";
import type { CustomerView } from "@/lib/delivery/customer-view";
import { LOAN_PURPOSE_LABELS } from "@/lib/inventory/constants";
import { isMdaValid } from "@/lib/mda/valid";
import { pricedWithoutMdaMessage } from "@/lib/mda/priced-message";
import { ItemizedMdaWarning } from "@/components/itemized-mda-warning";

type Data = Awaited<ReturnType<typeof import("@/server/case-template").listCaseTemplates>>;
interface Draft {
  id?: string;
  customerId: string;
  customerOrgId: string | null; // the hospital; null = any of the doctor's hospitals
  doctorName: string;
  name: string;
  categoryIds: string[];
  description: string;
  items: DraftItem[];
  priceMode: "itemized" | "total";
  totalPrice: string;
}
type DraftItem = CustomerView & {
  key: string; productId: string | null; productCode: string; description: string; qty: string; uom: string;
  unitPrice: string;
  // MDA registration valid? null = a free-text line (prints as written)
  mdaValid?: boolean | null;
  isMachine: boolean;
  machineUse: "SALE" | "ASSET" | null;
  loanPurpose: "RENTAL" | "LOAN" | "DEMO" | null;
  loanReturnMode: "same_day" | "stays" | null;
  usageFee: string;
  custOpen?: boolean;
};
const blankItem = (): DraftItem => ({ key: key(), productId: null, productCode: "", description: "", qty: "1", uom: "", unitPrice: "", isMachine: false, machineUse: null, loanPurpose: null, loanReturnMode: null, usageFee: "" });

let seq = 0;
const key = () => `r${++seq}`;

export function CaseTemplatesClient({ data }: { data: Data }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const groups = new Map<string, { doctor: string; org: string | null; templates: CaseTemplateRow[] }>();
  for (const t of data.templates) {
    if (q && !`${t.doctorName} ${t.name} ${t.description ?? ""}`.toLowerCase().includes(q.toLowerCase())) continue;
    const g = groups.get(t.customerId) ?? { doctor: t.doctorName, org: t.doctorOrg, templates: [] };
    g.templates.push(t);
    groups.set(t.customerId, g);
  }

  const edit = (t: CaseTemplateRow) => setDraft({
    id: t.id, customerId: t.customerId, customerOrgId: t.customerOrgId ?? null, doctorName: t.doctorName, name: t.name,
    categoryIds: data.categories.filter((c) => t.categoryNames.some((n) => n.toLowerCase() === c.name.toLowerCase())).map((c) => c.id),
    description: t.description ?? "",
    priceMode: t.priceMode === "total" ? "total" : "itemized", totalPrice: t.totalPrice ?? "",
    items: t.items.map((i): DraftItem => ({
      key: key(), productId: i.productId, productCode: i.productCode ?? "", description: i.description ?? "", qty: i.qty, uom: i.uom ?? "",
      unitPrice: i.unitPrice ?? "", mdaValid: i.mdaValid, isMachine: i.isMachine, machineUse: (i.machineUse as DraftItem["machineUse"]) ?? null, loanPurpose: (i.loanPurpose as DraftItem["loanPurpose"]) ?? null,
      loanReturnMode: (i.loanReturnMode as DraftItem["loanReturnMode"]) ?? null, usageFee: i.usageFee ?? "",
      custShow: (i.custShow as CustomerView["custShow"]) ?? null, custProductId: i.custProductId, custCode: i.custCode, custDescription: i.custDescription,
      custQty: i.custQty, custUom: i.custUom, custReason: i.custReason,
    })),
  });

  async function save() {
    if (!draft) return;
    // itemized price + a product the customer copy won't show → totals won't tally
    const bad = draft.priceMode === "itemized" ? draft.items.filter((i) => i.mdaValid === false).map((i) => i.productCode) : [];
    if (bad.length) { toast.error(pricedWithoutMdaMessage(bad), { duration: 12000 }); return; }
    setSaving(true);
    try {
      const res = await saveCaseTemplate({ id: draft.id, customerId: draft.customerId, customerOrgId: draft.customerOrgId, name: draft.name, categoryIds: draft.categoryIds, description: draft.description, items: draft.items, priceMode: draft.priceMode, totalPrice: draft.totalPrice });
      if (!res.ok) { toast.error(res.title); return; }
      toast.success(`Saved "${draft.name}"`);
      setDraft(null);
      router.refresh();
    } finally { setSaving(false); }
  }
  async function makeDefault(t: CaseTemplateRow) {
    const res = await makeCaseTemplateDefault(t.id);
    if (!res.ok) { toast.error(res.title); return; }
    toast.success(`"${t.name}" is now ${t.doctorName}'s default`);
    router.refresh();
  }
  async function remove(t: CaseTemplateRow) {
    if (!confirm(`Delete template "${t.name}" for ${t.doctorName}?`)) return;
    const res = await deleteCaseTemplate(t.id);
    if (!res.ok) { toast.error(res.title); return; }
    toast.success("Template deleted");
    router.refresh();
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-4">
      <PageHeader title="Case templates" description="Each template is the CUSTOMER COPY of a doctor's usual case — the case category, description, the items the hospital sees (with MDA certificates) and the selling price. When anyone picks the doctor on a Case DO, the default one is filled in automatically. The items actually used are recorded on the DO after the case."
        action={data.canEdit ? <Button size="sm" className="gap-1.5" onClick={() => setPicking(true)}><PlusIcon className="w-4 h-4" /> New template</Button> : undefined} />

      {picking && !draft && (
        <section className="border border-primary/30 bg-primary/5 rounded-xl p-4 space-y-2">
          <div className="text-sm font-semibold">Which doctor is this template for?</div>
          <CaseCustomerPicker onPick={(c) => {
            if (!c) return;
            const doc = c as unknown as { id: string; title?: string | null; name: string };
            setPicking(false);
            setDraft({ customerId: doc.id, customerOrgId: null, doctorName: [doc.title, doc.name].filter(Boolean).join(" "), name: "", categoryIds: [], description: "", items: [blankItem()], priceMode: "itemized", totalPrice: "" });
          }} />
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>Cancel</Button>
        </section>
      )}

      {draft && <Editor draft={draft} setDraft={setDraft} categories={data.categories} onSave={save} onCancel={() => setDraft(null)} saving={saving} />}

      <div className="relative max-w-sm">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctor or template…" className="pl-9 h-9 text-sm" />
      </div>

      {groups.size === 0 ? (
        <div className="border border-dashed border-border rounded-xl py-14 text-center text-sm text-muted-foreground">
          {data.templates.length ? "No template matches your search." : "No case templates yet. Create one here, or save a Case DO as a template."}
        </div>
      ) : [...groups.entries()].map(([cid, g]) => (
        <section key={cid} className="border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">{g.doctor}</span>
            {g.org && <span className="text-xs text-muted-foreground">· {g.org}</span>}
            <span className="ml-auto text-xs text-muted-foreground">{g.templates.length} template{g.templates.length > 1 ? "s" : ""}</span>
          </div>
          <div className="divide-y divide-border/60">
            {g.templates.map((t) => (
              <div key={t.id} className="px-4 py-3 flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <ClipboardListIcon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5", t.hospitalName ? "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" : "bg-muted text-muted-foreground")}
                    title={t.hospitalName ? "Used on Case DOs for this doctor at this hospital" : "Used at any of the doctor's hospitals (unless that hospital has its own)"}>
                    {t.hospitalName ? `@ ${t.hospitalName}` : "any hospital"}
                  </span>
                  {t.isDefault ? (
                    <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 inline-flex items-center gap-1" title="Filled in automatically when this doctor is picked on a Case DO">
                      <StarIcon className="w-3 h-3 fill-current" /> Default
                    </span>
                  ) : data.canEdit && (
                    <button type="button" onClick={() => makeDefault(t)} className="text-[10px] text-muted-foreground hover:text-foreground underline">make default</button>
                  )}
                  {t.categoryNames.map((n) => {
                    const c = data.categories.find((x) => x.name.toLowerCase() === n.toLowerCase());
                    return <span key={n} className="text-[10px] font-medium rounded px-1.5 py-0.5 border" style={{ borderColor: c?.color ?? undefined, color: c?.color ?? undefined }}>{n}</span>;
                  })}
                  {data.canEdit && (
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => edit(t)} title="Edit"><PencilIcon className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => remove(t)} title="Delete"><TrashIcon className="w-3.5 h-3.5" /></Button>
                    </span>
                  )}
                </div>
                {t.description && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{t.description}</p>}
                <p className="text-xs text-muted-foreground">{priceSummary(t)}</p>
                {t.items.some((i) => i.mdaValid === false) && (
                  <p className="text-xs font-medium text-red-700 dark:text-red-400">
                    {t.items.filter((i) => i.mdaValid === false).map((i) => i.productCode).join(", ")}: no valid MDA registration — won&apos;t print on the customer copy
                  </p>
                )}
                {t.items.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.items.map((i) => (
                      <span key={i.id} className={cn("text-[11px] rounded border px-1.5 py-0.5", i.mdaValid === false ? "border-red-400 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300" : "border-border bg-background")}
                        title={i.mdaValid === false ? "No valid MDA registration — won't print on the customer copy" : customerViewSummary(i) ?? undefined}>
                        <span className="font-mono">{i.productCode || "—"}</span> <span className="text-muted-foreground">× {Number(i.qty)}</span>
                        {i.machineUse && <span className={cn("ml-1", i.machineUse === "ASSET" ? "text-amber-700 dark:text-amber-400" : "text-sky-700 dark:text-sky-400")}>
                          · {i.machineUse === "ASSET" ? `company asset${i.loanPurpose ? `, ${LOAN_PURPOSE_LABELS[i.loanPurpose as keyof typeof LOAN_PURPOSE_LABELS].toLowerCase()}` : ""}` : "for sale"}</span>}
                        {i.custShow && <span className="ml-1 text-sky-700 dark:text-sky-300">· {customerViewSummary(i)}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Editor({ draft, setDraft, categories, onSave, onCancel, saving }: {
  draft: Draft; setDraft: (d: Draft) => void; categories: Data["categories"]; onSave: () => void; onCancel: () => void; saving: boolean;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setItem = (k: string, patch: Partial<Draft["items"][number]>) => set({ items: draft.items.map((i) => (i.key === k ? { ...i, ...patch } : i)) });
  // the doctor's hospitals — a template can be for one of them, or any
  const [hospitals, setHospitals] = useState<{ id: string; name: string; isPrimary: boolean }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDoctorHospitals(draft.customerId).then((h) => { if (!cancelled) setHospitals(h); }).catch(() => { if (!cancelled) setHospitals([]); });
    return () => { cancelled = true; };
  }, [draft.customerId]);
  return (
    <section className="border border-primary/30 bg-primary/5 rounded-xl p-4 space-y-3">
      <div className="text-sm font-semibold">{draft.id ? "Edit template" : "New template"} — {draft.doctorName}</div>
      <div className="rounded-md border border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30 px-3 py-2 text-xs text-sky-900 dark:text-sky-200">
        <b>Customer copy DO template.</b> Everything here is what the hospital receives on the customer copy and is invoiced for. The items the specialist actually uses are recorded on the Case DO after the case (internal copy).
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Hospital</Label>
        <select value={draft.customerOrgId ?? ""} onChange={(e) => set({ customerOrgId: e.target.value || null })}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" disabled={hospitals === null}>
          <option value="">Any of {draft.doctorName}&apos;s hospitals</option>
          {(hospitals ?? []).map((h) => <option key={h.id} value={h.id}>{h.name}{h.isPrimary ? " (primary)" : ""}</option>)}
        </select>
        <p className="text-[11px] text-muted-foreground">A doctor at several hospitals can keep a template per hospital. On a Case DO, the chosen hospital&apos;s templates are offered (with the &ldquo;any hospital&rdquo; ones), and its default fills in.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Template name *</Label>
        <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder='e.g. "MILH standard"' className="h-9 text-sm bg-background" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Case category</Label>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const on = draft.categoryIds.includes(c.id);
            return (
              <button key={c.id} type="button" onClick={() => set({ categoryIds: on ? draft.categoryIds.filter((x) => x !== c.id) : [...draft.categoryIds, c.id] })}
                className={cn("text-xs rounded-full border px-2.5 py-0.5", on ? "text-white" : "bg-background")}
                style={on ? { background: c.color ?? "#555", borderColor: c.color ?? "#555" } : { borderColor: c.color ?? undefined, color: c.color ?? undefined }}>
                {c.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Case description</Label>
        <Textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} rows={2} className="text-sm bg-background" placeholder="e.g. Laser haemorrhoidoplasty (MILH), grade III" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Selling price</Label>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {([["itemized", "Itemized — a price per item"], ["total", "Total — one price for the case"]] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => set({ priceMode: m })}
              className={cn("rounded-full border px-2.5 py-0.5", draft.priceMode === m ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted/40")}>{label}</button>
          ))}
          {draft.priceMode === "total" ? (
            <span className="flex items-center gap-1.5 ml-2">RM
              <Input type="number" min="0" step="0.01" value={draft.totalPrice} onChange={(e) => set({ totalPrice: e.target.value })} placeholder="0.00" className="h-8 w-32 text-sm text-right bg-background" />
              <span className="text-muted-foreground">covers all items below (machine usage fees are charged on top)</span>
            </span>
          ) : (
            <span className="ml-2 text-muted-foreground">Items total: <b className="text-foreground tabular-nums">RM {itemsTotal(draft.items).toFixed(2)}</b></span>
          )}
        </div>
        {draft.priceMode === "itemized" && <ItemizedMdaWarning codes={draft.items.filter((i) => i.mdaValid === false).map((i) => i.productCode)} />}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Customer copy items</Label>
        <p className="text-[11px] text-muted-foreground -mt-1"><b className="text-foreground">This template is for the customer copy DO</b> — what the hospital sees and is billed for. Items shown in <span className="text-red-600 font-medium">red</span> have no valid MDA registration and won&apos;t print. A catalogue product prints with its MDA number and certificate; a line without a product (e.g. &ldquo;MILH procedure kit&rdquo;) prints as written. The items actually used are recorded on the DO after the case.</p>
        <div className="space-y-1.5">
          {draft.items.map((i) => (
            <div key={i.key} className={cn("flex flex-col gap-1.5 rounded-lg border p-2",
              i.mdaValid === false ? "border-red-400 bg-red-50 dark:border-red-800 dark:bg-red-950/30" : "border-border/60 bg-background/60")}>
              <div className="flex items-center gap-2">
                <ProductPick value={i} onPick={(p) => setItem(i.key, { productId: p.id || null, productCode: p.productCode, description: p.description ?? "", uom: p.uom ?? "", isMachine: !!p.isMachine, machineUse: p.isMachine ? i.machineUse : null, unitPrice: i.unitPrice || (p.sellingPrice ? String(Number(p.sellingPrice)) : ""),
                  mdaValid: p.id ? isMdaValid(p.mdaRegNo, p.mdaExpiredOn) : null })} />
                <Input type="number" min="0" step="1" value={i.qty} onChange={(e) => setItem(i.key, { qty: e.target.value })} className="h-8 w-20 text-sm text-right bg-background" />
                <span className="text-xs text-muted-foreground w-10">{i.uom}</span>
                {draft.priceMode === "itemized" && (i.machineUse === "ASSET"
                  ? <span className="w-32 text-[11px] text-right" title="A lent machine is charged its usage fee (set below) — that is its price on the customer copy">
                      {parseFloat(i.usageFee) > 0 ? <b className="tabular-nums">RM {Number(i.usageFee).toFixed(2)}</b> : <span className="text-amber-600">no fee set</span>}
                      <span className="block text-muted-foreground">{(i.loanPurpose ?? "rental").toLowerCase()} fee / case</span>
                    </span>
                  : <span className="flex items-center gap-1 text-xs text-muted-foreground">RM
                      <Input type="number" min="0" step="0.01" value={i.unitPrice} onChange={(e) => setItem(i.key, { unitPrice: e.target.value })} placeholder="price" title="Selling price per unit" className="h-8 w-24 text-sm text-right bg-background" />
                    </span>)}
                <button type="button" onClick={() => set({ items: draft.items.filter((x) => x.key !== i.key) })} className="text-muted-foreground hover:text-destructive p-1"><TrashIcon className="w-3.5 h-3.5" /></button>
              </div>
              {i.mdaValid === false && (
                <p className="text-[11px] font-medium text-red-700 dark:text-red-400">No valid MDA registration — this item will NOT print on the customer copy. Update the product&apos;s MDA details, or remove it.</p>
              )}
              {i.isMachine && <MachinePick item={i} onChange={(patch) => setItem(i.key, patch)} />}
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => set({ items: [...draft.items, blankItem()] })}>
            <PlusIcon className="w-3 h-3" /> Add item
          </Button>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5">{saving && <Loader2Icon className="w-3.5 h-3.5 animate-spin" />} Save template</Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </section>
  );
}

function ProductPick({ value, onPick }: { value: Draft["items"][number]; onPick: (p: { id: string; productCode: string; description: string | null; uom: string | null; isMachine?: boolean; sellingPrice?: string | null; mdaRegNo?: string | null; mdaExpiredOn?: string | null }) => void }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ q: string; rows: Awaited<ReturnType<typeof searchTemplateProducts>> } | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => { const rows = await searchTemplateProducts(q); if (!cancelled) setAnswer({ q, rows }); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  const rows = q.trim().length >= 2 && answer?.q === q ? answer.rows : [];
  return (
    <div className="relative flex-1 min-w-0">
      <Input value={q || (value.productCode ? `${value.productCode}${value.description ? ` — ${value.description}` : ""}` : value.description)}
        onChange={(e) => setQ(e.target.value)} onFocus={(e) => { if (!q && value.productCode) { setQ(value.productCode); e.target.select(); } }}
        placeholder="Search product…" className="h-8 text-sm bg-background" />
      {q.trim().length >= 2 && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          <button type="button" onClick={() => { onPick({ id: "", productCode: "", description: q.trim(), uom: null, isMachine: false }); setQ(""); }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-muted/40 border-b border-border/40 text-muted-foreground">
            Use &ldquo;{q.trim()}&rdquo; as a line without a product (e.g. a package name)
          </button>
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => { onPick(r); setQ(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 border-b border-border/40 last:border-0">
              <span className="font-mono text-xs font-medium">{r.productCode}</span> <span className="text-xs text-muted-foreground">{r.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Machines: which kind of unit to pick from the specialist's holding, and how a company asset goes out
function MachinePick({ item, onChange }: { item: DraftItem; onChange: (patch: Partial<DraftItem>) => void }) {
  const opt = (on: boolean) => cn("rounded-full border px-2 py-0.5", on ? "border-amber-600 bg-amber-600 text-white" : "border-border bg-background hover:bg-muted/40");
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-900/10 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">Machine to pick</span>
        {([[null, "Any (choose on the DO)"], ["ASSET", "Company asset (lent)"], ["SALE", "For sale (sold)"]] as const).map(([v, label]) => (
          <button key={label} type="button" className={opt(item.machineUse === v)}
            onClick={() => onChange({ machineUse: v, ...(v === "ASSET" ? { loanPurpose: item.loanPurpose ?? "RENTAL", loanReturnMode: item.loanReturnMode ?? "same_day" } : {}) })}>{label}</button>
        ))}
      </div>
      {item.machineUse === "ASSET" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Purpose</span>
          {(["RENTAL", "LOAN", "DEMO"] as const).map((p) => (
            <button key={p} type="button" className={opt(item.loanPurpose === p)} onClick={() => onChange({ loanPurpose: p })}>{LOAN_PURPOSE_LABELS[p]}</button>
          ))}
          <span className="text-muted-foreground ml-2">After the case</span>
          <button type="button" className={opt(item.loanReturnMode !== "stays")} onClick={() => onChange({ loanReturnMode: "same_day" })}>Returned same day</button>
          <button type="button" className={opt(item.loanReturnMode === "stays")} onClick={() => onChange({ loanReturnMode: "stays" })}>Stays at hospital</button>
          <span className="text-muted-foreground ml-2">Usage fee RM</span>
          <Input type="number" min="0" step="0.01" value={item.usageFee} onChange={(e) => onChange({ usageFee: e.target.value })} placeholder="none" className="h-7 w-24 text-xs text-right bg-background" />
        </div>
      )}
      {item.machineUse && (
        <p className="text-[11px] text-muted-foreground">
          {item.machineUse === "ASSET" ? "The Case DO picks this many of the specialist's company-asset units and fills in these choices." : "The Case DO picks this many of the specialist's for-sale units; they are sold to the hospital."}
        </p>
      )}
    </div>
  );
}

// Itemized: sum of qty × price; a lent machine is priced at its usage fee (per case)
function itemsTotal(items: { qty: string; unitPrice?: string | null; machineUse?: string | null; usageFee?: string | null }[]) {
  return items.reduce((sum, i) => sum + (i.machineUse === "ASSET"
    ? parseFloat(i.usageFee ?? "") || 0
    : (parseFloat(i.qty) || 0) * (parseFloat(i.unitPrice ?? "") || 0)), 0);
}

function priceSummary(t: CaseTemplateRow) {
  const fees = t.items.filter((i) => i.machineUse === "ASSET" && i.usageFee).reduce((s, i) => s + Number(i.usageFee), 0);
  const plusFees = fees > 0 ? ` + machine usage fee RM ${fees.toFixed(2)}` : "";
  if (t.priceMode === "total") return `Selling price: total RM ${Number(t.totalPrice ?? 0).toFixed(2)} for the case${plusFees}`;
  const priced = t.items.filter((i) => i.machineUse !== "ASSET");
  const missing = priced.filter((i) => i.unitPrice === null || i.unitPrice === "").length;
  return `Selling price: itemized, RM ${itemsTotal(t.items).toFixed(2)}${fees > 0 ? ` (incl. machine fee RM ${fees.toFixed(2)})` : ""}${missing ? ` · ${missing} item${missing > 1 ? "s" : ""} without a price` : ""}`;
}
