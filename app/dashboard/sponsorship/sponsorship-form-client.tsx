"use client";

import { BackButton } from "@/components/back-button";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DraftSavedNote } from "@/components/draft-saved-note";
import { toast } from "sonner";
import { saveSponsorship, type SponsorshipInput } from "@/server/sponsorship";
import { DECLARATION, fmtRM, ITEM_CATEGORIES, RECIPIENT_TYPES, sumAmounts } from "@/lib/sponsorship/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeftIcon, PlusIcon, TrashIcon } from "lucide-react";

type ItemRow = { key: string; category: string; description: string; amount: string };
const row = (r: Partial<ItemRow> = {}): ItemRow => ({ key: Math.random().toString(36).slice(2), category: "registration", description: "", amount: "", ...r });
const selectCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export type FormInitial = Partial<SponsorshipInput> & { id?: string; rejectReason?: string | null; sponsorshipNo?: string };

export function SponsorshipFormClient({ initial }: { initial?: FormInitial }) {
  const router = useRouter();
  const [recipientType, setRecipientType] = useState(initial?.recipientType ?? "doctor");
  const [recipientName, setRecipientName] = useState(initial?.recipientName ?? "");
  const [recipientOrganization, setRecipientOrganization] = useState(initial?.recipientOrganization ?? "");
  const [isHcp, setIsHcp] = useState(initial?.isHcp ?? true);
  const [isGovernment, setIsGovernment] = useState(initial?.isGovernment ?? false);
  const [institutionApproved, setInstitutionApproved] = useState(initial?.institutionApproved ?? false);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [eventDateFrom, setFrom] = useState(initial?.eventDateFrom ?? "");
  const [eventDateTo, setTo] = useState(initial?.eventDateTo ?? "");
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const [declarationAccepted, setDeclaration] = useState(initial?.declarationAccepted ?? false);
  const [items, setItems] = useState<ItemRow[]>(initial?.items?.length ? initial.items.map((i) => row({ category: i.category, description: i.description, amount: String(i.amount) })) : [row()]);
  const [busy, setBusy] = useState(false);
  // Saving a draft keeps the user on the form (no redirect) and says it's saved.
  const searchParams = useSearchParams();
  const [savedAt, setSavedAt] = useState<Date | "just-now" | null>(searchParams.get("saved") === "1" ? "just-now" : null);
  useEffect(() => {
    // arrived from the new-request form's first draft save: drop the marker so a reload doesn't repeat the note
    if (searchParams.get("saved") === "1") window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [searchParams]);
  const total = sumAmounts(items);
  const patch = (key: string, p: Partial<ItemRow>) => setItems((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function save(submit: boolean) {
    if (submit && !confirm("Submit this request for checking? You can't edit it afterwards unless it is rejected.")) return;
    setBusy(true);
    try {
      const r = await saveSponsorship({
        id: initial?.id, recipientType, recipientName, recipientOrganization, isHcp, isGovernment, institutionApproved, title, purpose, eventDateFrom, eventDateTo, venue, declarationAccepted,
        items: items.map((i) => ({ category: i.category, description: i.description, amount: i.amount })),
      }, submit);
      if (!r.ok) { toast.error(r.error, { duration: 9000 }); return; }
      if (submit) {
        toast.success("Request submitted");
        router.push(`/dashboard/sponsorship/${r.value.id}`);
        router.refresh();
      } else if (!initial?.id) {
        // first save of a new request: continue in its edit form (replacing the
        // "new" step, so saving again updates it and Back skips the empty form)
        toast.success("Draft saved");
        router.replace(`/dashboard/sponsorship/${r.value.id}/edit?saved=1`);
      } else {
        toast.success(`Draft saved${initial.sponsorshipNo ? ` — ${initial.sponsorshipNo}` : ""}`);
        setSavedAt(new Date());
        router.refresh();
      }
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-5">
      <PageHeader
        title={initial?.id ? `Edit ${initial.sponsorshipNo ?? "request"}` : "New sponsorship request"}
        description="Ask the company to sponsor a doctor, hospital, association or event"
        action={<BackButton fallback="/dashboard/sponsorship" variant="outline" size="sm" className="gap-1.5"><ArrowLeftIcon className="h-3.5 w-3.5" />Back</BackButton>}
      />
      <DraftSavedNote docNo={initial?.sponsorshipNo} savedAt={savedAt} />
      {initial?.rejectReason && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200"><span className="font-semibold">Rejected:</span> {initial.rejectReason}. Change what is needed and submit it again.</div>}

      <section className="rounded-xl border border-border bg-background p-4 space-y-4">
        <h2 className="text-sm font-semibold">Who is being sponsored</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Type</Label>
            <select className={selectCls} value={recipientType} onChange={(e) => { setRecipientType(e.target.value); setIsHcp(e.target.value === "doctor"); }}>{RECIPIENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          <div className="space-y-1.5"><Label>Name <span className="text-destructive">*</span></Label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="e.g. Dr Aminah Rahman" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Hospital / institution</Label><Input value={recipientOrganization} onChange={(e) => setRecipientOrganization(e.target.value)} placeholder="e.g. Hospital Kuala Lumpur" /></div>
        </div>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={isHcp} onChange={(e) => setIsHcp(e.target.checked)} className="h-4 w-4" />The recipient is a healthcare professional</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={isGovernment} onChange={(e) => setIsGovernment(e.target.checked)} className="h-4 w-4" />Works at a government hospital or institution</label>
          {isGovernment && <label className="ml-6 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"><input type="checkbox" checked={institutionApproved} onChange={(e) => setInstitutionApproved(e.target.checked)} className="mt-0.5 h-4 w-4" />We have the institution&apos;s permission for the recipient to accept this sponsorship (attach the letter below once it is saved).</label>}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-background p-4 space-y-4">
        <h2 className="text-sm font-semibold">The event and the reason</h2>
        <div className="space-y-1.5"><Label>Event or purpose <span className="text-destructive">*</span></Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Malaysian Society of Orthopaedics Congress 2026" /></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>From <span className="text-destructive">*</span></Label><Input type="date" value={eventDateFrom} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input type="date" value={eventDateTo} min={eventDateFrom || undefined} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Venue</Label><Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="City / venue" /></div>
        </div>
        <div className="space-y-1.5"><Label>Purpose and justification <span className="text-destructive">*</span></Label><Textarea rows={4} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What is the event, and why is the company sponsoring it? (education, training, product knowledge …)" /></div>
      </section>

      <section className="rounded-xl border border-border bg-background p-4 space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">What the company will pay for</h2><span className="text-sm font-semibold tabular-nums">{fmtRM(total)}</span></div>
        {items.map((r, i) => (
          <div key={r.key} className="flex flex-wrap items-start gap-2">
            <select className="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm" value={r.category} onChange={(e) => patch(r.key, { category: e.target.value })}>{ITEM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
            <Input className="h-9 min-w-40 flex-1" value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} placeholder={`Item ${i + 1}: what exactly`} />
            <Input className="h-9 w-32 text-right tabular-nums" type="number" min="0" step="0.01" value={r.amount} onChange={(e) => patch(r.key, { amount: e.target.value })} placeholder="RM" />
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" disabled={items.length === 1} onClick={() => setItems((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove item"><TrashIcon className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setItems((rs) => [...rs, row({ category: "travel" })])}><PlusIcon className="h-3.5 w-3.5" />Add item</Button>
      </section>

      <section className="rounded-xl border border-border bg-background p-4 space-y-2">
        <h2 className="text-sm font-semibold">Declaration</h2>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={declarationAccepted} onChange={(e) => setDeclaration(e.target.checked)} className="mt-0.5 h-4 w-4" /><span>{DECLARATION}</span></label>
      </section>

      <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-md backdrop-blur">
        <span className="text-xs text-muted-foreground">Invitation letters and quotations can be attached after you save.</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => save(false)}>Save draft</Button>
          <Button disabled={busy} onClick={() => save(true)}>Submit for checking</Button>
        </div>
      </div>
    </div>
  );
}
