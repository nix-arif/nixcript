"use client";

import { BackButton } from "@/components/back-button";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addCustomerIssueNote, createSupplierClaim, previewSupplierClaim, resolveCustomerIssue, setCustomerIssueStatus, setIssueCustomerResolution, setIssueItemUnitStatus,
  type ClaimPreview, type CustomerIssueDetail,
} from "@/server/post-delivery";
import { BASES, CHANNELS, CLAIM_OUTCOMES, CUSTOMER_RESOLUTIONS, ISSUE_MOVES, UNIT_STATUS, situationLabel } from "@/lib/post-delivery/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClaimStatusBadge, DeadlineBadge, IssueStatusBadge, SeverityFlags } from "@/components/post-delivery/badges";
import { EvidenceGallery, EvidenceUploader } from "@/components/post-delivery/evidence";
import { AlertTriangleIcon, ArrowLeftIcon, PencilIcon } from "lucide-react";

const fmt = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtDT = (d: string | Date) => new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm";
const Card = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <section className="rounded-xl border border-border bg-background p-4 space-y-3">
    <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{title}</h2>{action && <div className="ml-auto">{action}</div>}</div>
    {children}
  </section>
);
const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">—</span>}</div></div>;

export function IssueDetailClient({ issue }: { issue: CustomerIssueDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const live = issue.status === "open" || issue.status === "investigating" || issue.status === "claim_raised";
  const refresh = () => router.refresh();
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusy(true);
    try { const r = await fn(); if (!r.ok) { toast.error(r.error, { duration: 8000 }); return false; } if (success) toast.success(success); refresh(); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); return false; } finally { setBusy(false); }
  }
  const itemName = (id: string | null | undefined) => { const i = issue.items.find((x) => x.id === id); return i ? (i.productCode || i.description) : null; };

  // ── status dialogs
  const [dlg, setDlg] = useState<null | "close" | "cancel" | "resolve">(null);
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState<string>(issue.customerResolution ?? "");
  const [resolutionNotes, setResolutionNotes] = useState(issue.customerResolutionNotes ?? "");
  const [note, setNote] = useState("");

  // ── claims: items grouped by supplier
  const groups = useMemo(() => {
    const map = new Map<string, { supplierId: string | null; name: string; items: typeof issue.items }>();
    for (const it of issue.items) {
      const k = it.supplierId ?? "none";
      if (!map.has(k)) map.set(k, { supplierId: it.supplierId, name: it.supplierName ?? "No supplier set", items: [] });
      map.get(k)!.items.push(it);
    }
    return [...map.values()];
  }, [issue]);

  // the deadline each supplier's terms give, shown before anyone raises a claim
  const [previews, setPreviews] = useState<Record<string, ClaimPreview | null>>({});
  useEffect(() => {
    if (!issue.canReadClaims) return;
    let dead = false;
    (async () => {
      for (const g of groups) {
        if (!g.supplierId) continue;
        const r = await previewSupplierClaim(issue.id, g.supplierId).catch(() => null);
        if (!dead && r && r.ok) setPreviews((p) => ({ ...p, [g.supplierId!]: r.value }));
      }
    })();
    return () => { dead = true; };
  }, [groups, issue.id, issue.canReadClaims, issue.situation, issue.deliveredAt]);

  const [claimFor, setClaimFor] = useState<{ supplierId: string; name: string } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [requested, setRequested] = useState("replacement");
  const [supplierRef, setSupplierRef] = useState("");
  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  function openClaim(g: (typeof groups)[number]) {
    const free = g.items.filter((i) => i.claimIds.length === 0);
    setPick(Object.fromEntries(free.map((i) => [i.id, i.qtyAffected])));
    setRequested("replacement"); setSupplierRef(""); setPreview(null);
    setClaimFor({ supplierId: g.supplierId!, name: g.name });
  }
  const pickedIds = Object.keys(pick);
  useEffect(() => {
    if (!claimFor || pickedIds.length === 0) return;
    let dead = false;
    previewSupplierClaim(issue.id, claimFor.supplierId, pickedIds).then((r) => { if (!dead && r.ok) setPreview(r.value); });
    return () => { dead = true; };
  }, [claimFor, pickedIds.join(","), issue.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createClaim() {
    if (!claimFor) return;
    setBusy(true);
    try {
      const r = await createSupplierClaim({ issueId: issue.id, supplierId: claimFor.supplierId, requestedOutcome: requested, supplierRef, items: pickedIds.map((id) => ({ issueItemId: id, qtyClaimed: pick[id] })) });
      if (!r.ok) { toast.error(r.error, { duration: 8000 }); return; }
      toast.success(`${r.value.claimNo} created as a draft`);
      router.push(`/dashboard/procurement/supplier-claims/${r.value.id}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not create the claim"); } finally { setBusy(false); }
  }

  const moves = ISSUE_MOVES[issue.status];
  const noSupplier = issue.items.filter((i) => !i.supplierId).length;
  return (
    <div className="p-4 sm:p-6 max-w-5xl space-y-4">
      <PageHeader
        title={issue.issueNo}
        description={issue.summary}
        action={
          <div className="flex flex-wrap gap-2">
            <BackButton fallback="/dashboard/sales/customer-issues" variant="outline" size="sm" className="gap-1.5"><ArrowLeftIcon className="h-3.5 w-3.5" />Issues</BackButton>
            {issue.canUpdate && live && <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href={`/dashboard/sales/customer-issues/${issue.id}/edit`}><PencilIcon className="h-3.5 w-3.5" />Edit</Link></Button>}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <IssueStatusBadge status={issue.status} />
        <SeverityFlags severity={issue.severity} safety={issue.safetyRelated} />
        {issue.canUpdate && (
          <div className="ml-auto flex flex-wrap gap-2">
            {moves.includes("investigating") && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setCustomerIssueStatus(issue.id, "investigating"), "Marked as investigating")}>{issue.status === "open" ? "Start investigating" : "Reopen"}</Button>}
            {moves.includes("resolved") && <Button size="sm" disabled={busy} onClick={() => setDlg("resolve")}>Resolve for the customer</Button>}
            {moves.includes("closed_no_claim") && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setReason(""); setDlg("close"); }}>Close without a claim</Button>}
            {moves.includes("cancelled") && <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => { setReason(""); setDlg("cancel"); }}>Cancel</Button>}
            {issue.status === "cancelled" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setCustomerIssueStatus(issue.id, "open"), "Reopened")}>Reopen</Button>}
          </div>
        )}
      </div>

      {issue.safetyRelated && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-800 dark:bg-red-900/10 dark:text-red-200">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span><b>Safety related.</b> Follow your company procedure for a complaint that involves possible harm, including any report to the authority that your procedure requires. Keep the affected units and the packaging.</span>
        </div>
      )}
      {(issue.status === "closed_no_claim" || issue.status === "cancelled") && issue.closedReason && <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs"><b>{issue.status === "cancelled" ? "Cancelled" : "Closed without a claim"}:</b> {issue.closedReason}</div>}

      <Card title="What was reported">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <Fact label="Customer" value={<>{issue.customerName}{issue.contactPerson && <span className="block text-xs text-muted-foreground">{issue.contactPerson}{issue.contactNo ? ` · ${issue.contactNo}` : ""}</span>}</>} />
          <Fact label="Delivery order" value={issue.deliveryOrderNo} />
          <Fact label="Delivered to the customer" value={issue.deliveredAt ? fmt(issue.deliveredAt) : null} />
          <Fact label="Kind of problem" value={situationLabel(issue.situation)} />
          <Fact label="Reported" value={`${fmt(issue.reportedAt)}${issue.reportedChannel ? ` · ${CHANNELS[issue.reportedChannel as keyof typeof CHANNELS] ?? issue.reportedChannel}` : ""}`} />
          <Fact label="Logged by" value={issue.createdByName} />
        </div>
        {issue.description && <p className="whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2 text-sm">{issue.description}</p>}
      </Card>

      <Card title={`Units affected (${issue.items.length})`}>
        {noSupplier > 0 && live && <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-900/10 dark:text-amber-200">{noSupplier} unit{noSupplier === 1 ? " has" : "s have"} no supplier set, so no claim can be raised for {noSupplier === 1 ? "it" : "them"} yet. {issue.canUpdate && <Link className="underline" href={`/dashboard/sales/customer-issues/${issue.id}/edit`}>Set the supplier</Link>}</p>}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-2.5 py-1.5">Product</th><th className="px-2.5 py-1.5">Qty</th><th className="px-2.5 py-1.5">Lot / serial</th><th className="px-2.5 py-1.5">Supplier and origin</th><th className="px-2.5 py-1.5">Where the unit is</th></tr></thead>
            <tbody className="divide-y divide-border/60">
              {issue.items.map((i) => (
                <tr key={i.id} className="align-top">
                  <td className="px-2.5 py-2"><div className="font-mono font-semibold">{i.productCode}</div><div className="text-muted-foreground">{i.description}</div></td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{i.qtyAffected}{i.qtyDelivered ? ` of ${i.qtyDelivered}` : ""} {i.uom}</td>
                  <td className="px-2.5 py-2">{i.lotNo && <div>Lot {i.lotNo}</div>}{i.serialNo && <div>S/N {i.serialNo}</div>}{!i.lotNo && !i.serialNo && "—"}</td>
                  <td className="px-2.5 py-2"><div className="font-medium">{i.supplierName ?? <span className="text-amber-700">Not set</span>}</div><div className="text-muted-foreground">{[i.poNo, i.grNo, i.supplierDocRef && `their ref ${i.supplierDocRef}`].filter(Boolean).join(" · ")}</div><div className="text-muted-foreground">{i.receivedAt ? `Received ${fmt(i.receivedAt)}` : ""}</div></td>
                  <td className="px-2.5 py-2">
                    {issue.canUpdate && live
                      ? <select className="h-8 rounded-md border border-input bg-background px-1.5 text-xs" value={i.unitStatus} disabled={busy} onChange={(e) => run(() => setIssueItemUnitStatus(i.id, e.target.value), "Updated")}>{Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      : UNIT_STATUS[i.unitStatus]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Evidence" action={issue.canUpdate && live ? <EvidenceUploader issueId={issue.id} onDone={refresh} /> : undefined}>
        <EvidenceGallery media={issue.media} canEdit={issue.canUpdate && live} onChanged={refresh} itemName={itemName} />
      </Card>

      <Card title="What the customer gets">
        {issue.canUpdate ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1.5"><Label className="text-xs">Resolution</Label>
              <select className={selectCls} value={resolution} onChange={(e) => setResolution(e.target.value)} disabled={!live && issue.status !== "resolved"}>
                <option value="">Not decided yet</option>{Object.entries(CUSTOMER_RESOLUTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Notes</Label><Input value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} placeholder="e.g. replacement from stock, delivered under DO…" /></div>
            <div className="sm:col-span-3"><Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setIssueCustomerResolution(issue.id, { resolution: resolution || null, notes: resolutionNotes }), "Saved")}>Save</Button></div>
          </div>
        ) : <p className="text-sm">{issue.customerResolution ? CUSTOMER_RESOLUTIONS[issue.customerResolution as keyof typeof CUSTOMER_RESOLUTIONS] : "Not decided yet"}{issue.customerResolutionNotes ? ` · ${issue.customerResolutionNotes}` : ""}</p>}
        <p className="text-[11px] text-muted-foreground">The customer is looked after separately from the claim to the supplier: you can replace the unit from stock now and claim from the supplier later.</p>
      </Card>

      {issue.canReadClaims && (
        <Card title="Claims against suppliers">
          {groups.every((g) => !g.supplierId) && <p className="text-xs text-muted-foreground">Set the supplier on the units to raise a claim.</p>}
          {groups.filter((g) => g.supplierId).map((g) => {
            const claims = issue.claims.filter((c) => c.supplierId === g.supplierId && c.status !== "withdrawn");
            const free = g.items.filter((i) => i.claimIds.length === 0);
            const pv = previews[g.supplierId!];
            return (
              <div key={g.supplierId} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{g.name}</span><span className="text-xs text-muted-foreground">{g.items.length} unit{g.items.length === 1 ? "" : "s"}</span></div>
                {claims.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Link href={`/dashboard/procurement/supplier-claims/${c.id}`} className="font-mono font-semibold hover:underline">{c.claimNo}</Link><ClaimStatusBadge status={c.status} />
                    {c.status === "draft" && <DeadlineBadge clock={c.clock} deadline={c.deadlineDate} />}
                  </div>
                ))}
                {live && free.length > 0 && (
                  <div className="space-y-1.5">
                    {pv && (
                      <p className={`rounded-md px-2.5 py-1.5 text-xs ${pv.deadline ? (pv.state === "late" ? "bg-red-50 text-red-900 dark:bg-red-900/10 dark:text-red-200" : pv.state === "soon" ? "bg-orange-50 text-orange-900 dark:bg-orange-900/10 dark:text-orange-200" : "bg-muted/40") : "bg-amber-50 text-amber-900 dark:bg-amber-900/10 dark:text-amber-200"}`}>
                        {pv.deadline
                          ? <>Their terms: {pv.windowDays} days from the {pv.basis ? BASES[pv.basis].toLowerCase() : ""} ({fmt(pv.basisDate)}). <b>Claim by {fmt(pv.deadline)}</b>{pv.daysLeft != null ? ` (${pv.daysLeft < 0 ? `${-pv.daysLeft} days past` : `${pv.daysLeft} days left`})` : ""}.</>
                          : pv.problem}
                        {pv.notes ? ` ${pv.notes}` : ""}
                      </p>
                    )}
                    {issue.canManageClaims
                      ? <Button size="sm" disabled={busy} onClick={() => openClaim(g)}>Raise a claim to {g.name}</Button>
                      : <p className="text-[11px] text-muted-foreground">Someone with permission to manage supplier claims raises the claim.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      <Card title="Timeline">
        {issue.canUpdate && (
          <div className="flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (a call with the customer, what was checked…)" onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) run(() => addCustomerIssueNote(issue.id, note), "Note added").then((ok) => ok && setNote("")); }} />
            <Button variant="outline" disabled={busy || !note.trim()} onClick={() => run(() => addCustomerIssueNote(issue.id, note), "Note added").then((ok) => ok && setNote(""))}>Add</Button>
          </div>
        )}
        <ol className="space-y-2.5 border-l border-border pl-4">
          {issue.events.map((e) => (
            <li key={e.id} className="relative text-xs">
              <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-border" />
              <div className="whitespace-pre-wrap">{e.message}</div>
              <div className="text-[11px] text-muted-foreground">{fmtDT(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ""}</div>
            </li>
          ))}
        </ol>
      </Card>

      {/* ── dialogs ── */}
      <Dialog open={dlg === "close" || dlg === "cancel"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{dlg === "cancel" ? "Cancel this issue" : "Close without a claim"}</DialogTitle><DialogDescription>{dlg === "cancel" ? "For an issue that was logged by mistake." : "No claim is made against any supplier, for example because the damage was caused by misuse or is not the supplier's fault."}</DialogDescription></DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" autoFocus />
          <DialogFooter><Button variant="outline" onClick={() => setDlg(null)}>Back</Button><Button disabled={busy || !reason.trim()} onClick={() => run(() => setCustomerIssueStatus(issue.id, dlg === "cancel" ? "cancelled" : "closed_no_claim", { reason }), "Done").then((ok) => ok && setDlg(null))}>{dlg === "cancel" ? "Cancel the issue" : "Close the issue"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "resolve"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Resolve for the customer</DialogTitle><DialogDescription>Record what the customer was given. Claims against suppliers carry on separately.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            <select className={selectCls} value={resolution} onChange={(e) => setResolution(e.target.value)}><option value="">Choose…</option>{Object.entries(CUSTOMER_RESOLUTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <Input value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} placeholder="Notes (optional)" />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDlg(null)}>Back</Button><Button disabled={busy || !resolution} onClick={() => run(() => resolveCustomerIssue(issue.id, { resolution, notes: resolutionNotes }), "Resolved").then((ok) => ok && setDlg(null))}>Resolve</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!claimFor} onOpenChange={(o) => !o && setClaimFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Claim to {claimFor?.name}</DialogTitle><DialogDescription>It starts as a draft. Nothing is sent to the supplier until you mark it as sent.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Units to claim</Label>
              {groups.find((g) => g.supplierId === claimFor?.supplierId)?.items.filter((i) => i.claimIds.length === 0).map((i) => (
                <label key={i.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
                  <input type="checkbox" checked={i.id in pick} onChange={(e) => setPick((p) => { const n = { ...p }; if (e.target.checked) n[i.id] = i.qtyAffected; else delete n[i.id]; return n; })} className="h-4 w-4" />
                  <span className="flex-1"><span className="font-mono font-semibold">{i.productCode}</span> <span className="text-muted-foreground">{i.description}</span></span>
                  {i.id in pick && <Input className="h-7 w-16 text-xs" inputMode="decimal" value={pick[i.id]} onChange={(e) => setPick((p) => ({ ...p, [i.id]: e.target.value }))} aria-label="Quantity to claim" />}
                </label>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5"><Label className="text-xs">We ask for</Label>
                <select className={selectCls} value={requested} onChange={(e) => setRequested(e.target.value)}>{["replacement", "credit_note", "repair", "refund"].map((k) => <option key={k} value={k}>{CLAIM_OUTCOMES[k as keyof typeof CLAIM_OUTCOMES]}</option>)}</select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Supplier&apos;s reference (if they gave one)</Label><Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="RMA no." /></div>
            </div>
            {preview && (
              <p className={`rounded-md px-2.5 py-1.5 text-xs ${preview.deadline ? (preview.state === "late" ? "bg-red-50 text-red-900 dark:bg-red-900/10 dark:text-red-200" : "bg-muted/40") : "bg-amber-50 text-amber-900 dark:bg-amber-900/10 dark:text-amber-200"}`}>
                {preview.deadline ? <>Deadline from their terms: <b>{fmt(preview.deadline)}</b>{preview.daysLeft != null ? ` (${preview.daysLeft < 0 ? `${-preview.daysLeft} days past` : `${preview.daysLeft} days left`})` : ""}.</> : preview.problem}
              </p>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setClaimFor(null)}>Back</Button><Button disabled={busy || pickedIds.length === 0} onClick={() => void createClaim()}>Create the draft claim</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
