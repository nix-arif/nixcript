"use client";

import { BackButton } from "@/components/back-button";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  closeSupplierClaim, recalculateClaimDeadline, recordSupplierResponse, resubmitSupplierClaim, sendSupplierClaim, updateSupplierClaim, withdrawSupplierClaim,
  type SupplierClaimDetail,
} from "@/server/post-delivery";
import { BASES, CLAIM_OUTCOMES, SENT_VIA, addDays, claimMessage, clockOf, situationLabel, todayKL } from "@/lib/post-delivery/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClaimStatusBadge, DeadlineBadge } from "@/components/post-delivery/badges";
import { EvidenceGallery } from "@/components/post-delivery/evidence";
import { ArrowLeftIcon, ClipboardCopyIcon, DownloadIcon } from "lucide-react";

const fmt = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtDT = (d: string | Date) => new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm";
const REQUESTS = ["replacement", "credit_note", "repair", "refund"] as const;
const Card = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <section className="rounded-xl border border-border bg-background p-4 space-y-3"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{title}</h2>{action && <div className="ml-auto">{action}</div>}</div>{children}</section>
);
const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">—</span>}</div></div>;

type Dlg = null | "send" | "respond" | "resubmit" | "withdraw" | "close" | "deadline";

export function ClaimDetailClient({ claim }: { claim: SupplierClaimDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(null);
  const today = todayKL();
  const refresh = () => router.refresh();
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusy(true);
    try { const r = await fn(); if (!r.ok) { toast.error(r.error, { duration: 9000 }); return false; } if (success) toast.success(success); refresh(); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); return false; } finally { setBusy(false); }
  }
  const draft = claim.status === "draft", sent = claim.status === "sent", answered = claim.status === "accepted" || claim.status === "partial", rejected = claim.status === "rejected";
  const clock = draft ? clockOf(claim.deadlineDate, today) : clockOf(null, today);
  const term = claim.term;

  // ── edit the draft
  const [supplierRef, setSupplierRef] = useState(claim.supplierRef ?? "");
  const [requested, setRequested] = useState(claim.requestedOutcome ?? "replacement");
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(claim.items.map((i) => [i.issueItemId, i.qtyClaimed])));
  const qtyChanged = claim.items.some((i) => qty[i.issueItemId] !== i.qtyClaimed);
  const detailsChanged = supplierRef !== (claim.supplierRef ?? "") || requested !== (claim.requestedOutcome ?? "replacement");

  // ── dialogs
  const [sentAt, setSentAt] = useState(today);
  const [via, setVia] = useState("email");
  const [sendRef, setSendRef] = useState(claim.supplierRef ?? "");
  const [followUp, setFollowUp] = useState(addDays(today, 7));
  const [allowLate, setAllowLate] = useState(false);
  const lateNow = !!claim.deadlineDate && sentAt > claim.deadlineDate;
  const [result, setResult] = useState<"accepted" | "partial" | "rejected">("accepted");
  const [outcome, setOutcome] = useState("replacement");
  const [accepted, setAccepted] = useState<Record<string, string>>(Object.fromEntries(claim.items.map((i) => [i.issueItemId, i.qtyClaimed])));
  const [credit, setCredit] = useState("");
  const [currency, setCurrency] = useState("MYR");
  const [response, setResponse] = useState("");
  const [answeredAt, setAnsweredAt] = useState(today);
  const [text, setText] = useState("");
  const [dlDate, setDlDate] = useState(claim.deadlineDate ?? "");

  const message = claimMessage({
    claimNo: claim.claimNo, supplierName: claim.supplierName, companyName: claim.companyName, situation: claim.situation, summary: claim.issue.summary, description: claim.issue.description,
    deliveredAt: claim.issue.deliveredAt, reportedAt: claim.issue.reportedAt, deadline: claim.deadlineDate,
    items: claim.items.map((i) => ({ productCode: i.productCode, description: i.description, qty: `${i.qtyClaimed}${i.uom ? ` ${i.uom}` : ""}`, lotNo: i.lotNo, poNo: i.poNo, grNo: i.grNo, supplierDocRef: i.supplierDocRef })),
    request: (CLAIM_OUTCOMES[(claim.requestedOutcome ?? "replacement") as keyof typeof CLAIM_OUTCOMES] ?? "a replacement").toLowerCase(),
  });
  const copyMessage = async () => { try { await navigator.clipboard.writeText(message); toast.success("Message copied. Attach the PDF and the photos."); } catch { toast.error("Could not copy. Select the text in the PDF instead."); } };

  const first = claim.items.map((i) => i.receivedAt).filter((d): d is string => !!d).sort()[0] ?? null;
  const closeDlg = () => setDlg(null);
  return (
    <div className="p-4 sm:p-6 max-w-5xl space-y-4">
      <PageHeader
        title={claim.claimNo}
        description={`${claim.supplierName} · ${situationLabel(claim.situation)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <BackButton fallback="/dashboard/procurement/supplier-claims" variant="outline" size="sm" className="gap-1.5"><ArrowLeftIcon className="h-3.5 w-3.5" />Claims</BackButton>
            <Button asChild variant="outline" size="sm" className="gap-1.5"><a href={`/api/supplier-claims/${claim.id}/report`}><DownloadIcon className="h-3.5 w-3.5" />Claim PDF</a></Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void copyMessage()}><ClipboardCopyIcon className="h-3.5 w-3.5" />Copy message</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ClaimStatusBadge status={claim.status} />
        {draft && <DeadlineBadge clock={clock} deadline={claim.deadlineDate} />}
        {claim.sentLate && <span className="rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/20 dark:text-red-300">Sent after their deadline</span>}
        <Link href={`/dashboard/sales/customer-issues/${claim.issue.id}`} className="text-xs underline text-muted-foreground hover:text-foreground">Issue {claim.issue.issueNo}</Link>
        {claim.canManage && (
          <div className="ml-auto flex flex-wrap gap-2">
            {draft && <Button size="sm" disabled={busy} onClick={() => { setSentAt(today); setAllowLate(false); setFollowUp(addDays(today, 7)); setSendRef(claim.supplierRef ?? ""); setDlg("send"); }}>Mark as sent</Button>}
            {sent && <Button size="sm" disabled={busy} onClick={() => { setResult("accepted"); setAnsweredAt(today); setDlg("respond"); }}>Record the supplier&apos;s answer</Button>}
            {rejected && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setText(""); setDlg("resubmit"); }}>Send again</Button>}
            {(answered || rejected) && <Button size="sm" variant={answered ? "default" : "outline"} disabled={busy} onClick={() => { setText(""); setDlg("close"); }}>Close the claim</Button>}
            {(draft || sent) && <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => { setText(""); setDlg("withdraw"); }}>Withdraw</Button>}
          </div>
        )}
      </div>

      {claim.issue.safetyRelated && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-800 dark:bg-red-900/10 dark:text-red-200"><b>Safety related.</b> The supplier is told so in the claim PDF.</div>}

      <Card title="Dates and the supplier's terms" action={draft && claim.canManage ? (
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => run(() => recalculateClaimDeadline(claim.id), "Deadline worked out again")}>Recalculate</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => { setDlDate(claim.deadlineDate ?? ""); setText(""); setDlg("deadline"); }}>Set by hand</Button>
        </div>) : undefined}>
        <ol className="grid gap-3 sm:grid-cols-4">
          <Fact label="Received from them" value={first ? fmt(first) : null} />
          <Fact label="Delivered to the customer" value={claim.issue.deliveredAt ? fmt(claim.issue.deliveredAt) : null} />
          <Fact label="Customer reported" value={fmt(claim.issue.reportedAt)} />
          <Fact label="Claim sent" value={claim.sentAt ? `${fmt(claim.sentAt)}${claim.sentVia ? ` · ${SENT_VIA[claim.sentVia as keyof typeof SENT_VIA] ?? claim.sentVia}` : ""}` : "Not sent yet"} />
        </ol>
        <div className={`rounded-lg px-3 py-2 text-sm ${claim.deadlineDate ? (clock.state === "late" ? "bg-red-50 text-red-900 dark:bg-red-900/10 dark:text-red-200" : clock.state === "soon" ? "bg-orange-50 text-orange-900 dark:bg-orange-900/10 dark:text-orange-200" : "bg-muted/40") : "bg-amber-50 text-amber-900 dark:bg-amber-900/10 dark:text-amber-200"}`}>
          {claim.deadlineDate ? (
            <>
              <b>Claim by {fmt(claim.deadlineDate)}.</b>{" "}
              {claim.deadlineOverridden ? `Set by hand: ${claim.deadlineNote}.` : term ? `Their terms: ${term.windowDays} days from the ${BASES[term.basis].toLowerCase()}${claim.basisDate ? ` (${fmt(claim.basisDate)})` : ""}.` : ""}
              {term?.notes ? ` ${term.notes}` : ""}
              {draft && clock.daysLeft != null ? ` ${clock.daysLeft < 0 ? `${-clock.daysLeft} days past.` : `${clock.daysLeft} days left.`}` : ""}
            </>
          ) : term ? `Their terms count from the ${BASES[term.basis].toLowerCase()}, and that date is not filled in. Enter it on the units to get the deadline.` : <>This supplier has no claim terms recorded, so there is no deadline. {" "}<Link className="underline" href="/dashboard/procurement/supplier-claims/terms">Add their terms</Link>.</>}
        </div>
      </Card>

      <Card title="The claim">
        <div className="grid gap-3 sm:grid-cols-3">
          {draft && claim.canManage ? (
            <>
              <div className="space-y-1.5"><Label className="text-xs">We ask for</Label><select className={selectCls} value={requested} onChange={(e) => setRequested(e.target.value)}>{REQUESTS.map((k) => <option key={k} value={k}>{CLAIM_OUTCOMES[k]}</option>)}</select></div>
              <div className="space-y-1.5"><Label className="text-xs">Supplier&apos;s reference</Label><Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="RMA no." /></div>
              <div className="flex items-end"><Button size="sm" variant="outline" disabled={busy || !detailsChanged} onClick={() => run(() => updateSupplierClaim(claim.id, { requestedOutcome: requested, supplierRef }), "Saved")}>Save</Button></div>
            </>
          ) : (
            <>
              <Fact label="We ask for" value={CLAIM_OUTCOMES[(claim.requestedOutcome ?? "replacement") as keyof typeof CLAIM_OUTCOMES]} />
              <Fact label="Supplier's reference" value={claim.supplierRef} />
              <Fact label="Follow-up" value={sent && claim.followUpDate ? <span className={claim.followUpDate <= today ? "font-medium text-orange-700 dark:text-orange-400" : ""}>{fmt(claim.followUpDate)}{claim.followUpDate <= today ? " (due)" : ""}</span> : null} />
            </>
          )}
        </div>
        {sent && claim.canManage && (
          <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">Chase them on</span>
            <Input type="date" className="h-8 w-40 text-xs" min={today} defaultValue={claim.followUpDate ?? ""} onBlur={(e) => e.target.value !== (claim.followUpDate ?? "") && run(() => updateSupplierClaim(claim.id, { followUpDate: e.target.value || null }), "Follow-up date saved")} />
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-2.5 py-1.5">Product</th><th className="px-2.5 py-1.5">Claimed</th>{!draft && <th className="px-2.5 py-1.5">Accepted</th>}<th className="px-2.5 py-1.5">Lot / serial</th><th className="px-2.5 py-1.5">Origin</th></tr></thead>
            <tbody className="divide-y divide-border/60">
              {claim.items.map((i) => (
                <tr key={i.id} className="align-top">
                  <td className="px-2.5 py-2"><div className="font-mono font-semibold">{i.productCode}</div><div className="text-muted-foreground">{i.description}</div></td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{draft && claim.canManage ? <span className="inline-flex items-center gap-1"><Input className="h-7 w-16 text-xs" inputMode="decimal" value={qty[i.issueItemId]} onChange={(e) => setQty((q) => ({ ...q, [i.issueItemId]: e.target.value }))} aria-label="Quantity claimed" /> of {i.qtyAffected} {i.uom}</span> : `${i.qtyClaimed} ${i.uom ?? ""}`}</td>
                  {!draft && <td className="px-2.5 py-2">{i.qtyAccepted ?? "—"}</td>}
                  <td className="px-2.5 py-2">{i.lotNo && <div>Lot {i.lotNo}</div>}{i.serialNo && <div>S/N {i.serialNo}</div>}{!i.lotNo && !i.serialNo && "—"}</td>
                  <td className="px-2.5 py-2 text-muted-foreground">{[i.poNo, i.grNo, i.supplierDocRef && `their ref ${i.supplierDocRef}`, i.receivedAt && `received ${fmt(i.receivedAt)}`].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {draft && claim.canManage && qtyChanged && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => updateSupplierClaim(claim.id, { items: claim.items.map((i) => ({ issueItemId: i.issueItemId, qtyClaimed: qty[i.issueItemId] })) }), "Quantities saved")}>Save quantities</Button>}
        {(answered || rejected || claim.status === "closed") && (
          <div className="rounded-lg bg-muted/30 px-3 py-2 text-sm space-y-0.5">
            <div><b>Supplier&apos;s answer{claim.respondedAt ? ` (${fmt(claim.respondedAt)})` : ""}:</b> {claim.outcome ? CLAIM_OUTCOMES[claim.outcome as keyof typeof CLAIM_OUTCOMES] : "—"}{claim.creditAmount ? ` · ${claim.creditCurrency ?? ""} ${claim.creditAmount}` : ""}</div>
            {claim.supplierResponse && <div className="whitespace-pre-wrap text-muted-foreground">{claim.supplierResponse}</div>}
            {claim.outcomeNotes && <div className="text-muted-foreground">{claim.outcomeNotes}</div>}
          </div>
        )}
        {claim.status === "withdrawn" && claim.withdrawnReason && <p className="rounded-lg bg-muted/30 px-3 py-2 text-sm"><b>Withdrawn:</b> {claim.withdrawnReason}</p>}
      </Card>

      <Card title="Evidence">
        <EvidenceGallery media={claim.media} canEdit={false} onChanged={refresh} />
        <p className="text-[11px] text-muted-foreground">Photos and videos are added on the customer issue. The claim PDF includes the photos.</p>
      </Card>

      <Card title="Timeline">
        <ol className="space-y-2.5 border-l border-border pl-4">
          {claim.events.map((e) => <li key={e.id} className="relative text-xs"><span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-border" /><div className="whitespace-pre-wrap">{e.message}</div><div className="text-[11px] text-muted-foreground">{fmtDT(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ""}</div></li>)}
        </ol>
      </Card>

      {/* ── dialogs ── */}
      <Dialog open={dlg === "send"} onOpenChange={(o) => !o && closeDlg()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Mark as sent</DialogTitle><DialogDescription>Record when and how the claim went to {claim.supplierName}. Send the PDF and the photos first.</DialogDescription></DialogHeader>
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label className="text-xs">Sent on</Label><Input type="date" max={today} value={sentAt} onChange={(e) => setSentAt(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Sent by</Label><select className={selectCls} value={via} onChange={(e) => setVia(e.target.value)}>{Object.entries(SENT_VIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div className="space-y-1.5"><Label className="text-xs">Their reference</Label><Input value={sendRef} onChange={(e) => setSendRef(e.target.value)} placeholder="if they gave one" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Chase them on</Label><Input type="date" min={sentAt} value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></div>
            </div>
            {lateNow && (
              <label className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-800 dark:bg-red-900/10 dark:text-red-200">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} />
                <span>Their deadline was {fmt(claim.deadlineDate)}. Tick to send anyway: it is recorded as a late claim. If they agreed to extend the deadline, cancel and set the new deadline by hand instead.</span>
              </label>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={closeDlg}>Back</Button><Button disabled={busy || (lateNow && !allowLate)} onClick={() => run(() => sendSupplierClaim(claim.id, { sentAt, via, supplierRef: sendRef, followUpDate: followUp || null, allowLate }), "Marked as sent").then((ok) => ok && closeDlg())}>Mark as sent</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "respond"} onOpenChange={(o) => !o && closeDlg()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>The supplier&apos;s answer</DialogTitle><DialogDescription>What did {claim.supplierName} say?</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {([["accepted", "Accepted"], ["partial", "Partly accepted"], ["rejected", "Rejected"]] as const).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={result === k} onClick={() => setResult(k)} className={`rounded-lg border px-3 py-1.5 text-sm ${result === k ? "border-indigo-500 bg-indigo-50 font-semibold dark:bg-indigo-900/20" : "border-border hover:bg-muted/30"}`}>{label}</button>
              ))}
            </div>
            {result !== "rejected" && (
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-1"><Label className="text-xs">They give</Label><select className={selectCls} value={outcome} onChange={(e) => setOutcome(e.target.value)}>{(["replacement", "credit_note", "repair", "refund", "goodwill"] as const).map((k) => <option key={k} value={k}>{CLAIM_OUTCOMES[k]}</option>)}</select></div>
                {(outcome === "credit_note" || outcome === "refund") && (<><div className="space-y-1.5"><Label className="text-xs">Amount</Label><Input inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} /></div><div className="space-y-1.5"><Label className="text-xs">Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></div></>)}
              </div>
            )}
            {result === "partial" && (
              <div className="space-y-1.5"><Label className="text-xs">Quantity accepted per item</Label>
                {claim.items.map((i) => <div key={i.id} className="flex items-center gap-2 text-xs"><span className="flex-1"><span className="font-mono font-semibold">{i.productCode}</span> of {i.qtyClaimed}</span><Input className="h-7 w-20 text-xs" inputMode="decimal" value={accepted[i.issueItemId]} onChange={(e) => setAccepted((a) => ({ ...a, [i.issueItemId]: e.target.value }))} aria-label={`Accepted ${i.productCode}`} /></div>)}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-3"><div className="space-y-1.5 sm:col-span-1"><Label className="text-xs">Answered on</Label><Input type="date" max={today} value={answeredAt} onChange={(e) => setAnsweredAt(e.target.value)} /></div></div>
            <div className="space-y-1.5"><Label className="text-xs">What they said</Label><Textarea rows={3} value={response} onChange={(e) => setResponse(e.target.value)} placeholder={result === "rejected" ? "Their reason, for example: out of warranty, misuse" : "Their answer, or the replacement details"} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={closeDlg}>Back</Button><Button disabled={busy} onClick={() => run(() => recordSupplierResponse(claim.id, { result, outcome: result === "rejected" ? undefined : outcome, response, respondedAt: answeredAt, creditAmount: credit || null, creditCurrency: currency, items: result === "partial" ? claim.items.map((i) => ({ issueItemId: i.issueItemId, qtyAccepted: accepted[i.issueItemId] })) : undefined }), "Answer recorded").then((ok) => ok && closeDlg())}>Save the answer</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "resubmit"} onOpenChange={(o) => !o && closeDlg()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Send the claim again</DialogTitle><DialogDescription>For example with better evidence, or after speaking to them. Their rejection stays in the timeline.</DialogDescription></DialogHeader>
          <div className="space-y-2"><select className={selectCls} value={via} onChange={(e) => setVia(e.target.value)}>{Object.entries(SENT_VIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What is different this time (optional)" /></div>
          <DialogFooter><Button variant="outline" onClick={closeDlg}>Back</Button><Button disabled={busy} onClick={() => run(() => resubmitSupplierClaim(claim.id, { via, note: text }), "Sent again").then((ok) => ok && closeDlg())}>Send again</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "withdraw" || dlg === "close" || dlg === "deadline"} onOpenChange={(o) => !o && closeDlg()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dlg === "withdraw" ? "Withdraw the claim" : dlg === "close" ? "Close the claim" : "Set the deadline by hand"}</DialogTitle>
            <DialogDescription>{dlg === "withdraw" ? "The units can be claimed again in a new claim." : dlg === "close" ? "Nothing more to do on this claim." : "Use this when the supplier agreed to a different deadline. The reason is kept on the claim."}</DialogDescription>
          </DialogHeader>
          {dlg === "deadline" && <Input type="date" value={dlDate} onChange={(e) => setDlDate(e.target.value)} />}
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={dlg === "withdraw" ? "Why?" : dlg === "close" ? "Note (optional), e.g. credit note received" : "Why? e.g. supplier agreed to extend by phone"} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={closeDlg}>Back</Button>
            <Button disabled={busy || (dlg !== "close" && !text.trim())} onClick={() => run(() => dlg === "withdraw" ? withdrawSupplierClaim(claim.id, text) : dlg === "close" ? closeSupplierClaim(claim.id, text) : updateSupplierClaim(claim.id, { deadline: { date: dlDate || null, note: text } }), "Done").then((ok) => ok && closeDlg())}>{dlg === "withdraw" ? "Withdraw" : dlg === "close" ? "Close" : "Save the deadline"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
