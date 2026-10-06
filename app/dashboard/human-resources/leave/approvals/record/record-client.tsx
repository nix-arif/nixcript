"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, ClipboardPenIcon, PaperclipIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { calculateLeaveDays, createLeaveDocumentRecord, getRecordLeaveOptions, recordLeaveForMember } from "@/server/leave";

type Member = { id: string; name: string };
type LType = { id: string; name: string; allowHalfDay: boolean; requiresDocument: boolean };

// Leave a member took but never applied for in the system (e.g. an MC sent by
// email): recorded by an approver, approved on saving, shown as "Recorded by HR".
export function RecordLeaveClient({ members, types }: { members: Member[]; types: LType[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [half, setHalf] = useState(false);
  const [period, setPeriod] = useState<"AM" | "PM">("AM");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [balances, setBalances] = useState<{ leaveTypeId: string; remaining: number }[]>([]);
  const [days, setDays] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const type = types.find((t) => t.id === typeId);
  const endDate = half ? start : end;
  const left = balances.find((b) => b.leaveTypeId === typeId)?.remaining;

  useEffect(() => {
    if (!userId) return;
    let off = false;
    getRecordLeaveOptions(userId).then((o) => { if (!off) setBalances(o.balances); }).catch(() => {});
    return () => { off = true; };
  }, [userId]);
  useEffect(() => {
    if (!start || !endDate || endDate < start) return;
    let off = false;
    calculateLeaveDays(start, endDate, half).then((d) => { if (!off) setDays(d); }).catch(() => {});
    return () => { off = true; };
  }, [start, endDate, half]);

  const needDoc = !!type?.requiresDocument;
  const valid = userId && typeId && start && endDate && endDate >= start && reason.trim().length >= 5 && (!needDoc || files.length > 0);

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const appId = await recordLeaveForMember({
        userId, leaveTypeId: typeId, startDate: start, endDate, isHalfDay: half,
        halfDayPeriod: half ? period : undefined, reason: reason.trim(),
      });
      for (const f of files) {
        const res = await fetch("/api/leave/upload-url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appId, fileName: f.name, mimeType: f.type || "application/octet-stream", fileSize: f.size }),
        });
        if (!res.ok) { toast.error(`Couldn't upload ${f.name}`); continue; }
        const { uploadUrl, key } = await res.json();
        const up = await fetch(uploadUrl, { method: "PUT", body: f, headers: { "Content-Type": f.type || "application/octet-stream" } });
        if (!up.ok) { toast.error(`Couldn't upload ${f.name}`); continue; }
        await createLeaveDocumentRecord({ applicationId: appId, fileName: f.name, fileKey: key, fileSize: f.size, mimeType: f.type || "application/octet-stream" });
      }
      toast.success(`Leave recorded for ${members.find((m) => m.id === userId)?.name ?? "the member"} — they've been notified`);
      router.push("/dashboard/human-resources/leave/approvals");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't record the leave", { duration: 10000 });
    } finally {
      setSaving(false);
    }
  }

  const sel = "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm";
  return (
    <div className="p-6 max-w-2xl flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><ClipboardPenIcon className="h-5 w-5 text-muted-foreground" />Record leave for a member</h1>
          <p className="text-sm text-muted-foreground mt-1">For leave a member took but didn&apos;t apply for in the system — e.g. an MC sent by email. It is approved on saving, marked <b>Recorded by HR</b>, deducted from their balance, and the member is notified. Unauthorised absence: record it as Unpaid Leave.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.back()} className="gap-1.5 shrink-0"><ArrowLeftIcon className="w-3.5 h-3.5" />Back</Button>
      </div>

      <section className="border rounded-xl p-4 grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Member *</Label>
          <select value={userId} onChange={(e) => { setUserId(e.target.value); setBalances([]); }} className={sel}>
            <option value="">Choose a member…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Leave type *</Label>
          <select value={typeId} onChange={(e) => { setTypeId(e.target.value); if (!types.find((t) => t.id === e.target.value)?.allowHalfDay) setHalf(false); }} className={sel}>
            <option value="">Choose a type…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {userId && typeId && left !== undefined && <p className="text-[11px] text-muted-foreground">{left} day{left !== 1 ? "s" : ""} left for this member</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">From *</Label>
          <Input type="date" value={start} onChange={(e) => { setStart(e.target.value); setDays(null); }} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To *</Label>
          <Input type="date" value={endDate} min={start} disabled={half} onChange={(e) => { setEnd(e.target.value); setDays(null); }} />
        </div>
        {type?.allowHalfDay && (
          <div className="sm:col-span-2 flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={half} onChange={(e) => { setHalf(e.target.checked); setDays(null); }} />Half day</label>
            {half && (["AM", "PM"] as const).map((p) => (
              <label key={p} className="flex items-center gap-1.5"><input type="radio" checked={period === p} onChange={() => setPeriod(p)} />{p}</label>
            ))}
          </div>
        )}
        {days !== null && start && endDate && <p className="sm:col-span-2 text-xs text-muted-foreground">{days} working day{days !== 1 ? "s" : ""} will be deducted{left !== undefined && days > left ? <span className="text-destructive"> — more than the {left} left; record the rest as Unpaid Leave</span> : null}</p>}
        <div className="sm:col-span-2 space-y-1.5">
          <Label className="text-xs">Reason for recording it *</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. MC 3–4 Oct sent by email; member did not apply in the system" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label className="text-xs">Supporting document{needDoc ? " *" : " (optional)"}</Label>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files ?? [])]); if (fileRef.current) fileRef.current.value = ""; }} />
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
                <PaperclipIcon className="h-3 w-3" />{f.name}
                <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><XIcon className="h-3 w-3" /></button>
              </span>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Attach file</Button>
          </div>
          {needDoc && files.length === 0 && <p className="text-[11px] text-amber-700 dark:text-amber-400">{type?.name} needs a supporting document (e.g. the MC).</p>}
        </div>
      </section>

      <div className="flex gap-2">
        <Button onClick={save} disabled={!valid || saving}>{saving ? "Recording…" : "Record leave"}</Button>
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}
