"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createCustomerIssue, findDeliveryOrders, findReceivedLinesFor, getDeliveryOrderForIssue, updateCustomerIssue,
  type CustomerIssueDetail, type DeliveryOrderHit, type DeliveryOrderLines, type IssueInput, type ReceivedLine,
} from "@/server/post-delivery";
import { CHANNELS, SEVERITIES, SITUATIONS, SITUATION_KEYS, todayKL, type Channel, type Severity, type Situation } from "@/lib/post-delivery/core";
import { uploadIssueFiles } from "@/components/post-delivery/evidence";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeftIcon, ImagePlusIcon, PlusIcon, SearchIcon, TrashIcon, XIcon } from "lucide-react";

type ItemRow = {
  key: string; id?: string; productId: string | null; productCode: string; description: string; qtyDelivered: string; qtyAffected: string; uom: string;
  lotNo: string; serialNo: string; supplierId: string; poNo: string; supplierDocRef: string; goodsReceiptId: string | null; grNo: string | null; packingListItemId: string | null;
  receivedAt: string; unitCost: string; currency: string;
};
const key = () => Math.random().toString(36).slice(2);
const blankItem = (): ItemRow => ({ key: key(), productId: null, productCode: "", description: "", qtyDelivered: "", qtyAffected: "1", uom: "", lotNo: "", serialNo: "", supplierId: "", poNo: "", supplierDocRef: "", goodsReceiptId: null, grNo: null, packingListItemId: null, receivedAt: "", unitCost: "", currency: "" });
const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "");
const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm";

export function IssueFormClient({ suppliers, issue }: { suppliers: { id: string; name: string }[]; issue?: CustomerIssueDetail }) {
  const router = useRouter();
  const editing = !!issue;
  const today = todayKL();

  // ── what the customer reported
  const [customerName, setCustomerName] = useState(issue?.customerName ?? "");
  const [contactPerson, setContactPerson] = useState(issue?.contactPerson ?? "");
  const [contactNo, setContactNo] = useState(issue?.contactNo ?? "");
  const [customerId, setCustomerId] = useState<string | null>(issue?.customerId ?? null);
  const [reportedAt, setReportedAt] = useState(issue?.reportedAt ?? today);
  const [channel, setChannel] = useState<string>(issue?.reportedChannel ?? "");
  const [situation, setSituation] = useState<string>(issue?.situation ?? "");
  const [severity, setSeverity] = useState<string>(issue?.severity ?? "normal");
  const [safety, setSafety] = useState(issue?.safetyRelated ?? false);
  const [summary, setSummary] = useState(issue?.summary ?? "");
  const [description, setDescription] = useState(issue?.description ?? "");
  const [deliveredAt, setDeliveredAt] = useState(issue?.deliveredAt ?? "");

  // ── the delivery
  const [doId, setDoId] = useState<string | null>(issue?.deliveryOrderId ?? null);
  const [doNo, setDoNo] = useState<string | null>(issue?.deliveryOrderNo ?? null);
  const [doLines, setDoLines] = useState<DeliveryOrderLines | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DeliveryOrderHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await findDeliveryOrders(query).catch(() => []);
      if (seq === searchSeq.current) { setHits(r); setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function chooseDelivery(h: DeliveryOrderHit) {
    const full = await getDeliveryOrderForIssue(h.id);
    if (!full) { toast.error("That delivery order could not be opened."); return; }
    setDoId(full.id); setDoNo(full.doNo); setDoLines(full); setHits([]); setQuery("");
    setCustomerName(full.customerName); setCustomerId(full.customerId); if (full.contactPerson && !contactPerson) setContactPerson(full.contactPerson);
    if (full.deliveredAt) setDeliveredAt(full.deliveredAt);
  }
  const clearDelivery = () => { setDoId(null); setDoNo(null); setDoLines(null); };

  // ── the items
  const [items, setItems] = useState<ItemRow[]>(
    issue
      ? issue.items.map((i) => ({
          key: i.id, id: i.id, productId: i.productId, productCode: i.productCode ?? "", description: i.description ?? "", qtyDelivered: i.qtyDelivered ?? "", qtyAffected: i.qtyAffected, uom: i.uom ?? "",
          lotNo: i.lotNo ?? "", serialNo: i.serialNo ?? "", supplierId: i.supplierId ?? "", poNo: i.poNo ?? "", supplierDocRef: i.supplierDocRef ?? "", goodsReceiptId: i.goodsReceiptId, grNo: i.grNo,
          packingListItemId: i.packingListItemId, receivedAt: i.receivedAt ?? "", unitCost: i.unitCost ?? "", currency: i.currency ?? "",
        }))
      : [],
  );
  const patch = (k: string, p: Partial<ItemRow>) => setItems((rs) => rs.map((r) => (r.key === k ? { ...r, ...p } : r)));
  function addFromDelivery(l: DeliveryOrderLines["lines"][number]) {
    setItems((rs) => [...rs, { ...blankItem(), productId: l.productId, productCode: l.productCode ?? "", description: l.description ?? "", qtyDelivered: l.qty, qtyAffected: "1", uom: l.uom ?? "" }]);
  }

  // where did this item come from: lines we received from suppliers for the product code
  const [sourceFor, setSourceFor] = useState<string | null>(null);
  const [sources, setSources] = useState<ReceivedLine[] | null>(null);
  async function lookupSource(r: ItemRow) {
    if (!r.productCode.trim()) { toast.error("Enter the product code first."); return; }
    setSourceFor(r.key); setSources(null);
    setSources(await findReceivedLinesFor(r.productCode).catch(() => []));
  }
  function applySource(r: ItemRow, s: ReceivedLine) {
    patch(r.key, {
      supplierId: s.supplierId ?? r.supplierId, poNo: s.poNo ?? r.poNo, goodsReceiptId: s.goodsReceiptId, grNo: s.grNo, packingListItemId: s.packingListItemId,
      lotNo: r.lotNo || s.lotNo || "", receivedAt: s.receivedAt ?? r.receivedAt, supplierDocRef: s.supplierDocRef ?? r.supplierDocRef,
      unitCost: s.unitCost ?? r.unitCost, currency: s.currency ?? r.currency, description: r.description || s.description || "",
    });
    setSourceFor(null);
  }

  // ── evidence (kept until the issue exists; after that it is managed on the issue page)
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  async function save() {
    const input: IssueInput = {
      customerId, customerName, contactPerson, contactNo, deliveryOrderId: doId, deliveredAt: deliveredAt || null, reportedAt, reportedChannel: channel || null,
      situation, severity, safetyRelated: safety, summary, description,
      items: items.map((r) => ({
        id: r.id, productId: r.productId, productCode: r.productCode, description: r.description, qtyDelivered: r.qtyDelivered || null, qtyAffected: r.qtyAffected, uom: r.uom,
        lotNo: r.lotNo, serialNo: r.serialNo, supplierId: r.supplierId || null, poNo: r.poNo, supplierDocRef: r.supplierDocRef, goodsReceiptId: r.goodsReceiptId,
        packingListItemId: r.packingListItemId, receivedAt: r.receivedAt || null, unitCost: r.unitCost || null, currency: r.currency,
      })),
    };
    setSaving(true);
    try {
      if (editing) {
        const r = await updateCustomerIssue(issue!.id, input);
        if (!r.ok) { toast.error(r.error, { duration: 8000 }); return; }
        toast.success("Issue updated");
        router.push(`/dashboard/sales/customer-issues/${issue!.id}`);
      } else {
        const r = await createCustomerIssue(input);
        if (!r.ok) { toast.error(r.error, { duration: 8000 }); return; }
        if (files.length > 0) {
          const up = await uploadIssueFiles(r.value.id, files);
          for (const f of up.failed) toast.error(f, { duration: 8000 });
        }
        toast.success(`${r.value.issueNo} reported`);
        router.push(`/dashboard/sales/customer-issues/${r.value.id}`);
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setSaving(false); }
  }

  const back = editing ? `/dashboard/sales/customer-issues/${issue!.id}` : "/dashboard/sales/customer-issues";
  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-5">
      <PageHeader
        title={editing ? `Edit ${issue!.issueNo}` : "Report a customer issue"}
        description="Record what the customer reported, which delivered units are affected, and where they came from"
        action={<Button asChild variant="outline" size="sm" className="gap-1.5"><Link href={back}><ArrowLeftIcon className="h-3.5 w-3.5" />Back</Link></Button>}
      />

      {/* 1. the delivery */}
      <section className="rounded-xl border border-border bg-background p-4 space-y-3">
        <h2 className="text-sm font-semibold">1. Which delivery?</h2>
        {doId ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50/60 px-3 py-2 text-sm dark:border-green-800 dark:bg-green-900/10">
            <span className="font-mono font-semibold">{doNo}</span>
            {deliveredAt && <span className="text-xs text-muted-foreground">delivered {fmt(deliveredAt)}</span>}
            <button type="button" className="ml-auto text-xs underline text-muted-foreground hover:text-foreground" onClick={clearDelivery}>Change</button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search the delivery order by number, customer or customer PO" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {searching && query.trim().length >= 2 && <p className="text-xs text-muted-foreground">Searching…</p>}
            {query.trim().length >= 2 && hits.length > 0 && (
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                {hits.map((h) => (
                  <li key={h.id}><button type="button" onClick={() => void chooseDelivery(h)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40">
                    <span className="font-mono text-xs font-semibold">{h.doNo}</span><span className="flex-1 truncate">{h.customerName}</span><span className="text-xs text-muted-foreground">{fmt(h.deliveredAt)}</span>
                  </button></li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">No delivery order (a loan, a sample, or an old delivery)? Skip this and type the customer below.</p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Customer <span className="text-destructive">*</span></Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Hospital or customer name" /></div>
          <div className="space-y-1.5"><Label>Delivered to the customer on</Label><Input type="date" max={today} value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Contact person</Label><Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Who reported it" /></div>
          <div className="space-y-1.5"><Label>Contact number</Label><Input value={contactNo} onChange={(e) => setContactNo(e.target.value)} /></div>
        </div>
      </section>

      {/* 2. the problem */}
      <section className="rounded-xl border border-border bg-background p-4 space-y-3">
        <h2 className="text-sm font-semibold">2. What is the problem?</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Kind of problem <span className="text-destructive">*</span></Label>
            <select className={selectCls} value={situation} onChange={(e) => setSituation(e.target.value)}>
              <option value="">Choose…</option>
              {SITUATION_KEYS.map((k) => <option key={k} value={k}>{SITUATIONS[k].label}</option>)}
            </select>
            {situation && <p className="text-[11px] text-muted-foreground">{SITUATIONS[situation as Situation]?.hint}. The supplier&apos;s claim terms can be different for each kind of problem.</p>}
          </div>
          <div className="space-y-1.5"><Label>Reported on <span className="text-destructive">*</span></Label><Input type="date" max={today} value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Reported by</Label>
            <select className={selectCls} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">Not recorded</option>{(Object.keys(CHANNELS) as Channel[]).map((k) => <option key={k} value={k}>{CHANNELS[k]}</option>)}</select>
          </div>
          <div className="space-y-1.5"><Label>Severity</Label>
            <select className={selectCls} value={severity} onChange={(e) => setSeverity(e.target.value)}>{(Object.keys(SEVERITIES) as Severity[]).map((k) => <option key={k} value={k}>{SEVERITIES[k]}</option>)}</select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 self-end rounded-md border border-input px-3 py-2 text-sm">
            <input type="checkbox" checked={safety} onChange={(e) => setSafety(e.target.checked)} className="h-4 w-4" />
            <span>Safety related <span className="block text-[11px] text-muted-foreground">harm or risk to a patient or user</span></span>
          </label>
        </div>
        <div className="space-y-1.5"><Label>Summary <span className="text-destructive">*</span></Label><Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Jaws misaligned after three uses" /></div>
        <div className="space-y-1.5"><Label>What happened</Label><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When it was found, how it was used, what exactly is wrong" /></div>
      </section>

      {/* 3. the items */}
      <section className="rounded-xl border border-border bg-background p-4 space-y-3">
        <h2 className="text-sm font-semibold">3. Which units, and where did they come from?</h2>
        {doLines && doLines.lines.length > 0 && (
          <div className="space-y-1.5 rounded-lg bg-muted/30 p-2.5">
            <p className="text-xs font-medium">On {doLines.doNo}: click to add</p>
            <div className="flex flex-wrap gap-1.5">
              {doLines.lines.map((l, i) => (
                <button key={i} type="button" onClick={() => addFromDelivery(l)} className="rounded-md border border-border bg-background px-2 py-1 text-left text-xs hover:bg-muted/40">
                  <span className="font-mono font-semibold">{l.productCode ?? "—"}</span> <span className="text-muted-foreground">x {l.qty}{l.uom ? ` ${l.uom}` : ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {items.length === 0 && <p className="text-xs text-muted-foreground">Add the units that have the problem.</p>}
        {items.map((r, n) => (
          <div key={r.key} className="rounded-lg border border-border p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Item {n + 1}</span>
              <button type="button" aria-label="Remove item" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setItems((rs) => rs.filter((x) => x.key !== r.key))}><TrashIcon className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-2 sm:grid-cols-6">
              <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Product code</Label><Input className="h-8 font-mono text-xs" value={r.productCode} onChange={(e) => patch(r.key, { productCode: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-4"><Label className="text-xs">Description</Label><Input className="h-8 text-xs" value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Qty with the problem *</Label><Input className="h-8 text-xs" inputMode="decimal" value={r.qtyAffected} onChange={(e) => patch(r.key, { qtyAffected: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Qty delivered</Label><Input className="h-8 text-xs" inputMode="decimal" value={r.qtyDelivered} onChange={(e) => patch(r.key, { qtyDelivered: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Unit</Label><Input className="h-8 text-xs" value={r.uom} onChange={(e) => patch(r.key, { uom: e.target.value })} placeholder="pcs" /></div>
              <div className="space-y-1 sm:col-span-3"><Label className="text-xs">Supplier</Label>
                <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={r.supplierId} onChange={(e) => patch(r.key, { supplierId: e.target.value })}>
                  <option value="">Not known yet</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-5">
              <div className="space-y-1"><Label className="text-xs">Lot no.</Label><Input className="h-8 text-xs" value={r.lotNo} onChange={(e) => patch(r.key, { lotNo: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Serial no.</Label><Input className="h-8 text-xs" value={r.serialNo} onChange={(e) => patch(r.key, { serialNo: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Our PO no.</Label><Input className="h-8 text-xs" value={r.poNo} onChange={(e) => patch(r.key, { poNo: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Supplier&apos;s DO / invoice</Label><Input className="h-8 text-xs" value={r.supplierDocRef} onChange={(e) => patch(r.key, { supplierDocRef: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Received from supplier on</Label><Input type="date" max={today} className="h-8 text-xs" value={r.receivedAt} onChange={(e) => patch(r.key, { receivedAt: e.target.value })} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => void lookupSource(r)}><SearchIcon className="h-3 w-3" />Find where it came from</Button>
              {r.grNo && <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-green-800 dark:bg-green-900/20 dark:text-green-300">Linked to {r.grNo}</span>}
              {!r.receivedAt && r.supplierId && <span className="text-amber-700 dark:text-amber-400">Add the date received: the supplier&apos;s claim deadline may depend on it.</span>}
            </div>
            {sourceFor === r.key && (
              <div className="rounded-lg border border-border bg-muted/20 p-2.5">
                <div className="mb-1.5 flex items-center"><span className="text-xs font-medium">Received from suppliers: {r.productCode}</span><button type="button" aria-label="Close" className="ml-auto text-muted-foreground" onClick={() => setSourceFor(null)}><XIcon className="h-3.5 w-3.5" /></button></div>
                {sources === null ? <p className="text-xs text-muted-foreground">Looking…</p>
                  : sources.length === 0 ? <p className="text-xs text-muted-foreground">Nothing received under this product code in the system. Choose the supplier and enter the details by hand.</p>
                  : (
                    <ul className="divide-y divide-border/60">
                      {sources.map((s) => (
                        <li key={s.packingListItemId}><button type="button" onClick={() => applySource(r, s)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-1 py-1.5 text-left text-xs hover:bg-muted/40">
                          <span className="font-medium">{s.supplierName ?? "Supplier"}</span><span>{s.poNo}</span><span>{s.grNo}</span><span className="text-muted-foreground">{fmt(s.receivedAt)}</span>{s.lotNo && <span className="font-mono">{s.lotNo}</span>}<span className="text-muted-foreground">{s.qtyReceived} received</span>
                        </button></li>
                      ))}
                    </ul>
                  )}
              </div>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setItems((rs) => [...rs, blankItem()])}><PlusIcon className="h-3.5 w-3.5" />Add an item by hand</Button>
      </section>

      {/* 4. evidence */}
      {!editing && (
        <section className="rounded-xl border border-border bg-background p-4 space-y-2">
          <h2 className="text-sm font-semibold">4. Photos and videos from the customer</h2>
          <p className="text-xs text-muted-foreground">They are attached to the claim sent to the supplier. More can be added later.</p>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { setFiles((f) => [...f, ...(e.target.files ? [...e.target.files] : [])]); if (fileRef.current) fileRef.current.value = ""; }} />
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}><ImagePlusIcon className="h-3.5 w-3.5" />Choose files</Button>
          {files.length > 0 && (
            <ul className="space-y-1 text-xs">
              {files.map((f, i) => <li key={i} className="flex items-center gap-2"><span className="flex-1 truncate">{f.name}</span><span className="text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><XIcon className="h-3.5 w-3.5" /></button></li>)}
            </ul>
          )}
        </section>
      )}

      <div className="sticky bottom-3 flex items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-md backdrop-blur">
        <span className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}{files.length ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" asChild><Link href={back}>Cancel</Link></Button>
          <Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Report the issue"}</Button>
        </div>
      </div>
    </div>
  );
}
