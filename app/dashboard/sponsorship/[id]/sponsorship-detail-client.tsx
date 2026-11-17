"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addSponsorshipDocument, approveSponsorship, cancelSponsorship, checkSponsorship, closeSponsorship, getSponsorshipDocDownloadUrl, getSponsorshipDocUploadUrl,
  recordSponsorshipSpend, rejectSponsorship, removeSponsorshipDocument, type SponsorshipDetailData,
} from "@/server/sponsorship";
import { DOCUMENT_KINDS, fmtRM, ITEM_CATEGORIES, money, RECIPIENT_TYPES } from "@/lib/sponsorship/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeftIcon, DownloadIcon, PaperclipIcon, PencilIcon, TrashIcon } from "lucide-react";
import { SponsorshipStatusBadge } from "../status-badge";

const fmtDate = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "");
const MAX = 10 * 1024 * 1024;

export function SponsorshipDetailClient({ d }: { d: SponsorshipDetailData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState(d.totalRequested);
  const [dialog, setDialog] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [actuals, setActuals] = useState<Record<string, string>>(() => Object.fromEntries(d.items.map((i) => [i.id, i.actualAmount ?? ""])));
  const [paymentRef, setPaymentRef] = useState(d.paymentRef ?? "");
  const [paid, setPaid] = useState(!!d.paidAt);
  const [closeNote, setCloseNote] = useState("");
  const [kind, setKind] = useState("invitation");
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    try { const r = await fn(); if (!r.ok) { toast.error(r.error, { duration: 9000 }); return false; } toast.success(success); router.refresh(); return true; }
    catch (e: any) { toast.error(e.message); return false; } finally { setBusy(false); }
  }

  async function upload(file: File) {
    if (file.size > MAX) return toast.error("The file is larger than 10 MB.");
    setBusy(true);
    try {
      const up = await getSponsorshipDocUploadUrl(d.id, file.name, file.type, file.size);
      if (!up.ok) { toast.error(up.error); return; }
      const put = await fetch(up.value.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) { toast.error("The upload failed. Try again."); return; }
      const r = await addSponsorshipDocument(d.id, { kind, fileName: file.name, fileKey: up.value.key, fileSize: file.size, mimeType: file.type });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success("Document added"); router.refresh();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function download(docId: string) {
    const r = await getSponsorshipDocDownloadUrl(docId);
    if (!r.ok) return toast.error(r.error);
    window.open(r.value, "_blank");
  }

  const approved = d.approvedAmount ? money(d.approvedAmount) : null;
  const actualTotal = Object.values(actuals).some((v) => v !== "") ? Object.values(actuals).reduce((s, v) => s + money(v), 0) : null;
  const timeline: { label: string; who: string | null; at: Date | null; note?: string | null }[] = [
    { label: "Requested", who: d.requestedByName, at: d.createdAt },
    { label: "Checked", who: d.checkedByName, at: d.checkedAt, note: d.checkComment },
    { label: "Approved", who: d.approvedByName, at: d.approvedAt, note: d.approveComment },
    { label: "Rejected", who: d.rejectedByName, at: d.rejectedAt, note: d.rejectReason },
    { label: "Paid", who: d.paidByName, at: d.paidAt, note: d.paymentRef ? `Ref ${d.paymentRef}` : null },
    { label: "Closed", who: d.closedByName, at: d.closedAt, note: d.closeNote },
    { label: "Cancelled", who: d.cancelledByName, at: d.cancelledAt, note: d.cancelReason },
  ].filter((t) => t.at);

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-5">
      <PageHeader
        title={d.title || d.sponsorshipNo}
        description={`${d.sponsorshipNo} · requested by ${d.requestedByName ?? "—"}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href={d.isMine ? "/dashboard/sponsorship" : "/dashboard/sponsorship/approvals"}><ArrowLeftIcon className="h-3.5 w-3.5" />Back</Link></Button>
            {d.can.edit && <Button asChild size="sm" className="gap-1.5"><Link href={`/dashboard/sponsorship/${d.id}/edit`}><PencilIcon className="h-3.5 w-3.5" />Edit</Link></Button>}
            {d.can.cancel && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setReason(""); setDialog("cancel"); }}>Cancel request</Button>}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-4">
        <SponsorshipStatusBadge status={d.status} />
        <div className="text-sm"><span className="text-muted-foreground">Requested</span> <span className="font-semibold tabular-nums">{fmtRM(d.totalRequested)}</span></div>
        {approved != null && <div className="text-sm"><span className="text-muted-foreground">Approved</span> <span className="font-semibold tabular-nums">{fmtRM(approved)}</span></div>}
        {d.actualAmount != null && <div className="text-sm"><span className="text-muted-foreground">Spent</span> <span className={`font-semibold tabular-nums ${approved != null && money(d.actualAmount) > approved ? "text-red-700 dark:text-red-400" : ""}`}>{fmtRM(d.actualAmount)}</span></div>}
        {d.paidAt && <span className="rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300">Paid</span>}
      </div>
      {d.status === "REJECTED" && d.rejectReason && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200"><span className="font-semibold">Rejected:</span> {d.rejectReason}</div>}

      <section className="rounded-xl border border-border bg-background p-4 space-y-3">
        <h2 className="text-sm font-semibold">Details</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Recipient</dt><dd className="font-medium">{d.recipientName} <span className="font-normal text-muted-foreground">({RECIPIENT_TYPES.find((t) => t.value === d.recipientType)?.label ?? d.recipientType})</span></dd></div>
          <div><dt className="text-xs text-muted-foreground">Institution</dt><dd>{d.recipientOrganization || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Event date</dt><dd>{fmtDate(d.eventDateFrom)}{d.eventDateTo && d.eventDateTo !== d.eventDateFrom ? ` to ${fmtDate(d.eventDateTo)}` : ""}{d.venue ? ` · ${d.venue}` : ""}</dd></div>
          <div className="flex flex-wrap items-center gap-1.5"><dt className="sr-only">Flags</dt>
            {d.isHcp && <span className="rounded-md border border-border px-1.5 py-px text-[11px]">Healthcare professional</span>}
            {d.isGovernment && <span className={`rounded-md border px-1.5 py-px text-[11px] ${d.institutionApproved ? "border-green-200 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300" : "border-amber-300 bg-amber-50 text-amber-800"}`}>Government institution{d.institutionApproved ? ", permission obtained" : ""}</span>}
          </div>
        </dl>
        <div><div className="text-xs text-muted-foreground">Purpose and justification</div><p className="mt-0.5 whitespace-pre-wrap text-sm">{d.purpose}</p></div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Item</th><th className="px-4 py-2 text-right font-medium">Requested</th><th className="px-4 py-2 text-right font-medium">Actually spent</th></tr></thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.id} className="border-t border-border/60">
                <td className="px-4 py-2"><div>{i.description}</div><div className="text-[11px] text-muted-foreground">{ITEM_CATEGORIES.find((c) => c.value === i.category)?.label ?? i.category}</div></td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtRM(i.amount)}</td>
                <td className="px-4 py-2 text-right">
                  {d.can.record
                    ? <Input className="ml-auto h-8 w-32 text-right tabular-nums" type="number" min="0" step="0.01" value={actuals[i.id] ?? ""} onChange={(e) => setActuals((a) => ({ ...a, [i.id]: e.target.value }))} placeholder="RM" />
                    : <span className="tabular-nums">{i.actualAmount != null ? fmtRM(i.actualAmount) : "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-border bg-muted/20 font-semibold"><td className="px-4 py-2">Total</td><td className="px-4 py-2 text-right tabular-nums">{fmtRM(d.totalRequested)}</td><td className="px-4 py-2 text-right tabular-nums">{d.can.record ? (actualTotal != null ? fmtRM(actualTotal) : "—") : d.actualAmount != null ? fmtRM(d.actualAmount) : "—"}</td></tr></tfoot>
        </table>
      </section>

      {/* ── actions ── */}
      {(d.can.check || d.can.approve) && (
        <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800 dark:bg-blue-900/10">
          <h2 className="text-sm font-semibold">{d.can.approve ? "Decision" : "Check"}</h2>
          {d.can.approve && (
            <div className="space-y-1.5"><Label>Approved amount (you can approve less than requested)</Label>
              <Input className="w-44 tabular-nums" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          )}
          <div className="space-y-1.5"><Label>Comment (optional)</Label><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <div className="flex flex-wrap gap-2">
            {d.can.check && !d.can.approve && <Button disabled={busy} onClick={() => run(() => checkSponsorship(d.id, comment), "Checked and sent for approval")}>Check and send for approval</Button>}
            {d.can.approve && <Button disabled={busy} onClick={() => confirm(`Approve ${fmtRM(amount)}?`) && run(() => approveSponsorship(d.id, { amount, comment }), "Approved").then((x) => x && router.push("/dashboard/sponsorship/approvals"))}>Approve</Button>}
            {d.can.check && d.can.approve && d.status === "PENDING" && <Button variant="outline" disabled={busy} onClick={() => run(() => checkSponsorship(d.id, comment), "Checked and sent for approval")}>Check only</Button>}
            {d.can.reject && <Button variant="outline" disabled={busy} onClick={() => { setReason(""); setDialog("reject"); }}>Reject</Button>}
          </div>
        </section>
      )}

      {d.can.record && (
        <section className="space-y-3 rounded-xl border border-green-200 bg-green-50/40 p-4 dark:border-green-800 dark:bg-green-900/10">
          <h2 className="text-sm font-semibold">Spend and payment</h2>
          <p className="text-xs text-muted-foreground">Enter what was actually spent on each item above, the payment reference, and mark it paid. Close it when everything is settled.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5"><Label>Payment reference</Label><Input className="w-56" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="e.g. bank transfer ref" /></div>
            <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" />Paid</label>
            <Button disabled={busy} onClick={() => run(() => recordSponsorshipSpend(d.id, { items: d.items.map((i) => ({ id: i.id, actualAmount: actuals[i.id] === "" ? null : actuals[i.id] })), paymentRef, paid }), "Saved")}>Save spend</Button>
          </div>
          {approved != null && actualTotal != null && actualTotal > approved && <p className="text-xs text-red-700 dark:text-red-400">The spend is more than the approved {fmtRM(approved)}. A note is needed to close it.</p>}
          <div className="flex flex-wrap items-end gap-3 border-t border-border/60 pt-3">
            <div className="min-w-60 flex-1 space-y-1.5"><Label>Closing note {d.actualAmount != null && approved != null && money(d.actualAmount) > approved ? <span className="text-destructive">*</span> : "(optional)"}</Label><Input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} /></div>
            <Button variant="outline" disabled={busy || d.actualAmount == null} title={d.actualAmount == null ? "Save the spend first" : undefined} onClick={() => confirm("Close this sponsorship? It can't be changed afterwards.") && run(() => closeSponsorship(d.id, closeNote), "Closed")}>Close sponsorship</Button>
          </div>
        </section>
      )}

      {/* ── documents ── */}
      <section className="space-y-3 rounded-xl border border-border bg-background p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><PaperclipIcon className="h-4 w-4" />Documents</h2>
        {d.documents.length === 0 && <p className="text-xs text-muted-foreground">No documents yet.{d.isGovernment ? " A government institution's permission letter should be attached." : ""}</p>}
        <ul className="divide-y divide-border/60">
          {d.documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{doc.fileName}</div><div className="text-[11px] text-muted-foreground">{DOCUMENT_KINDS.find((k) => k.value === doc.kind)?.label ?? doc.kind} · {doc.uploadedByName} · {fmtDate(doc.uploadedAt)}</div></div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => download(doc.id)} aria-label="Download"><DownloadIcon className="h-4 w-4" /></Button>
              {d.can.addDocument && <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => confirm(`Remove ${doc.fileName}?`) && run(() => removeSponsorshipDocument(doc.id), "Removed")} aria-label="Remove"><TrashIcon className="h-4 w-4" /></Button>}
            </li>
          ))}
        </ul>
        {d.can.addDocument && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>{DOCUMENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} className="text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            <span className="text-[11px] text-muted-foreground">PDF or image, up to 10 MB</span>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-background p-4">
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <ol className="space-y-1.5 text-sm">
          {timeline.map((t) => <li key={t.label} className="flex flex-wrap gap-x-2"><span className="w-20 font-medium">{t.label}</span><span className="text-muted-foreground">{t.who ?? "—"} · {fmtDate(t.at)}{t.note ? ` · ${t.note}` : ""}</span></li>)}
        </ol>
      </section>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === "reject" ? "Reject this request" : "Cancel this request"}</DialogTitle>
            <DialogDescription>{dialog === "reject" ? "The requester is told why and can edit and submit it again." : "It will be closed and cannot be reopened."}</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dialog === "reject" ? "What needs to change?" : "Reason (optional)"} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Back</Button>
            <Button disabled={busy || (dialog === "reject" && !reason.trim())}
              onClick={() => run(() => (dialog === "reject" ? rejectSponsorship(d.id, reason) : cancelSponsorship(d.id, reason)), dialog === "reject" ? "Rejected" : "Cancelled").then((x) => x && setDialog(null))}>
              {dialog === "reject" ? "Reject" : "Cancel request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
