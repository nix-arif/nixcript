"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ClaimApplicationWithDetails, ClaimTypeRow,
  ClaimLineItemInput, ClaimEntertainmentDetailInput,
} from "@/server/claim";
import {
  cancelClaim, submitClaim, createClaimDocumentRecord,
  CLAIM_FORM, LINE_CATEGORY,
} from "@/server/claim";
import {
  PlusIcon, FileDownIcon, XIcon, ReceiptIcon,
  AlertTriangleIcon, UploadIcon, InfoIcon, ArrowRightIcon, MapPinIcon,
} from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────

const FORM_LABELS: Record<string, string> = {
  LOCAL: "Local Reimbursement",
  OVERSEAS: "Overseas Expenses",
  ENTERTAINMENT_FORM: "Entertainment",
};

const MISC_SUB_LABELS: Record<string, string> = {
  TOLL: "Toll / Touch N Go",
  PARKING: "Parking",
  MOBILE: "Mobile Phone",
};

const CURRENCIES = ["USD", "EUR", "GBP", "SGD", "AUD", "JPY", "CNY", "HKD", "THB", "IDR", "PHP", "BND"];

// ── Row types ──────────────────────────────────────────────────────────────

interface TravelRow   { id:string; lineDate:string; fromLocation:string; toLocation:string; distanceKm:string }
interface MiscRow     { id:string; subType:"TOLL"|"PARKING"|"MOBILE"; lineDate:string; description:string; amountMyr:string }
interface InEntRow    { id:string; lineDate:string; venue:string; description:string; amountMyr:string }
interface OtherLocalRow { id:string; lineDate:string; description:string; amountMyr:string }
interface OvMyrRow    { id:string; lineDate:string; destination:string; description:string; amountMyr:string }
interface OvFxRow     { id:string; lineDate:string; destination:string; currency:string; amountForeign:string; exchangeRate:string }
interface OvOtherRow  { id:string; lineDate:string; description:string; amountMyr:string }
interface QueuedFile  { file:File; id:string }

const newId = () => crypto.randomUUID();
const emptyTravel   = (): TravelRow     => ({ id:newId(), lineDate:"", fromLocation:"", toLocation:"", distanceKm:"" });
const emptyMisc     = (): MiscRow       => ({ id:newId(), subType:"TOLL", lineDate:"", description:"", amountMyr:"" });
const emptyInEnt    = (): InEntRow      => ({ id:newId(), lineDate:"", venue:"", description:"", amountMyr:"" });
const emptyOther    = (): OtherLocalRow => ({ id:newId(), lineDate:"", description:"", amountMyr:"" });
const emptyOvMyr    = (): OvMyrRow      => ({ id:newId(), lineDate:"", destination:"", description:"", amountMyr:"" });
const emptyOvFx     = (): OvFxRow       => ({ id:newId(), lineDate:"", destination:"", currency:"USD", amountForeign:"", exchangeRate:"" });
const emptyOvOther  = (): OvOtherRow    => ({ id:newId(), lineDate:"", description:"", amountMyr:"" });

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtAmount(v: string | number): string {
  return `RM ${parseFloat(String(v)).toFixed(2)}`;
}

function fmtClaimDate(claimDate: string, category: string): string {
  if ((category === CLAIM_FORM.LOCAL || category === CLAIM_FORM.OVERSEAS) && /^\d{4}-\d{2}-01$/.test(claimDate)) {
    const [year, month] = claimDate.split("-");
    return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" });
  }
  return claimDate;
}

function fxMyr(fc: string, rate: string): number {
  const f = parseFloat(fc); const r = parseFloat(rate);
  return (isNaN(f) || isNaN(r) || f <= 0 || r <= 0) ? 0 : parseFloat((f * r).toFixed(2));
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string,string> = {
    PENDING:   "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
    APPROVED:  "bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700",
    REJECTED:  "bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700",
    CANCELLED: "bg-muted text-muted-foreground border-border hover:bg-muted",
  };
  const labels: Record<string,string> = { PENDING:"Pending", APPROVED:"Approved", REJECTED:"Rejected", CANCELLED:"Cancelled" };
  return <Badge className={`border text-xs ${map[status] ?? "border-border"}`}>{labels[status] ?? status}</Badge>;
}

// ── Compact row field ──────────────────────────────────────────────────────

function Field({ children, className="" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-1 ${className}`}>{children}</div>;
}

// ── Section wrapper ────────────────────────────────────────────────────────

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {badge && <span className="text-xs text-muted-foreground">{badge}</span>}
      </div>
      <div className="p-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

const inputCls = "border border-input rounded-md px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full";

// ── Summary Cards ──────────────────────────────────────────────────────────

function SummaryCards({ applications, claimTypes }: { applications: ClaimApplicationWithDetails[]; claimTypes: ClaimTypeRow[] }) {
  const year = new Date().getFullYear();
  const thisYear = applications.filter(a => new Date(a.createdAt).getFullYear() === year);
  const byType: Record<string,{type:ClaimTypeRow;approved:number;pending:number}> = {};
  for (const ct of claimTypes) byType[ct.id] = { type:ct, approved:0, pending:0 };
  for (const app of thisYear) {
    if (!byType[app.claimTypeId]) continue;
    const amt = parseFloat(app.amount);
    if (app.status === "APPROVED") byType[app.claimTypeId].approved += amt;
    if (app.status === "PENDING")  byType[app.claimTypeId].pending  += amt;
  }
  const cards = Object.values(byType).filter(e => e.approved > 0 || e.pending > 0);
  if (cards.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {cards.map(({ type, approved, pending }) => (
        <div key={type.id} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="font-mono text-xs px-1.5 py-0 h-5">{type.code}</Badge>
            <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{FORM_LABELS[type.category] ?? type.category}</Badge>
          </div>
          <p className="text-sm font-semibold leading-snug">{type.name}</p>
          <div className="text-2xl font-bold text-green-700 dark:text-green-400">
            {fmtAmount(approved)}<span className="text-xs font-normal text-muted-foreground ml-1">approved</span>
          </div>
          {pending > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">+ {fmtAmount(pending)} pending</p>}
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

interface Props {
  applications: ClaimApplicationWithDetails[];
  claimTypes: ClaimTypeRow[];
  permissions: string[];
}

export function MyClaimClient({ applications, claimTypes, permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Cancel state ──────────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // ── Sheet state ───────────────────────────────────────────────────────────
  const [submitOpen, setSubmitOpen] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [claimPeriod, setClaimPeriod] = useState("");
  const [note, setNote] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // LOCAL
  const [travelRows, setTravelRows] = useState<TravelRow[]>([emptyTravel()]);
  const [miscRows,   setMiscRows]   = useState<MiscRow[]>([]);
  const [inEntRows,  setInEntRows]  = useState<InEntRow[]>([]);
  const [otherRows,  setOtherRows]  = useState<OtherLocalRow[]>([]);

  // OVERSEAS
  const [ovMyrRows,   setOvMyrRows]   = useState<OvMyrRow[]>([]);
  const [ovFxRows,    setOvFxRows]    = useState<OvFxRow[]>([]);
  const [ovOtherRows, setOvOtherRows] = useState<OvOtherRow[]>([]);

  // ENTERTAINMENT_FORM
  const [entDate,    setEntDate]    = useState("");
  const [entRest,    setEntRest]    = useState("");
  const [entCust,    setEntCust]    = useState("");
  const [entDeptOrg, setEntDeptOrg] = useState("");
  const [entPurpose, setEntPurpose] = useState("");
  const [entAmount,  setEntAmount]  = useState("");

  const canApply = permissions.includes("claim:apply") || permissions.includes("*");
  const selectedType = claimTypes.find(t => t.id === selectedTypeId) ?? null;
  const formType = selectedType?.category as typeof CLAIM_FORM[keyof typeof CLAIM_FORM] | undefined;
  const ratePerKm = selectedType?.ratePerUnit ? parseFloat(selectedType.ratePerUnit) : 0;

  // ── Totals ────────────────────────────────────────────────────────────────
  const travelTotal  = travelRows.reduce((s,r) => { const km=parseFloat(r.distanceKm); return s+(isNaN(km)||km<=0?0:km*ratePerKm); }, 0);
  const miscTotal    = miscRows.reduce((s,r)   => { const a=parseFloat(r.amountMyr); return s+(isNaN(a)?0:a); }, 0);
  const inEntTotal   = inEntRows.reduce((s,r)  => { const a=parseFloat(r.amountMyr); return s+(isNaN(a)?0:a); }, 0);
  const otherTotal   = otherRows.reduce((s,r)  => { const a=parseFloat(r.amountMyr); return s+(isNaN(a)?0:a); }, 0);
  const ovMyrTotal   = ovMyrRows.reduce((s,r)  => { const a=parseFloat(r.amountMyr); return s+(isNaN(a)?0:a); }, 0);
  const ovFxTotal    = ovFxRows.reduce((s,r)   => s+fxMyr(r.amountForeign,r.exchangeRate), 0);
  const ovOtherTotal = ovOtherRows.reduce((s,r)=> { const a=parseFloat(r.amountMyr); return s+(isNaN(a)?0:a); }, 0);
  const localTotal   = travelTotal+miscTotal+inEntTotal+otherTotal;
  const overseasTotal= ovMyrTotal+ovFxTotal+ovOtherTotal;

  // ── Reset ─────────────────────────────────────────────────────────────────
  function resetForm() {
    setSelectedTypeId(""); setClaimPeriod(""); setNote(""); setQueuedFiles([]);
    setTravelRows([emptyTravel()]); setMiscRows([]); setInEntRows([]); setOtherRows([]);
    setOvMyrRows([]); setOvFxRows([]); setOvOtherRows([]);
    setEntDate(""); setEntRest(""); setEntCust(""); setEntDeptOrg(""); setEntPurpose(""); setEntAmount("");
  }

  function handleTypeChange(id: string) {
    setSelectedTypeId(id);
    setClaimPeriod(""); setNote(""); setQueuedFiles([]);
    setTravelRows([emptyTravel()]); setMiscRows([]); setInEntRows([]); setOtherRows([]);
    setOvMyrRows([]); setOvFxRows([]); setOvOtherRows([]);
    setEntDate(""); setEntRest(""); setEntCust(""); setEntDeptOrg(""); setEntPurpose(""); setEntAmount("");
  }

  // generic updater factory
  function updater<T extends { id: string }>(set: React.Dispatch<React.SetStateAction<T[]>>) {
    return (id: string, field: keyof T, value: string) =>
      set(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }
  function remover<T extends { id: string }>(set: React.Dispatch<React.SetStateAction<T[]>>, minLength = 0) {
    return (id: string) => set(prev => prev.length > minLength ? prev.filter(r => r.id !== id) : prev);
  }

  const updateTravel   = updater(setTravelRows);
  const updateMisc     = updater(setMiscRows);
  const updateInEnt    = updater(setInEntRows);
  const updateOther    = updater(setOtherRows);
  const updateOvMyr    = updater(setOvMyrRows);
  const updateOvFx     = updater(setOvFxRows);
  const updateOvOther  = updater(setOvOtherRows);

  // ── File handling ─────────────────────────────────────────────────────────
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const allowed = ["image/jpeg","image/png","image/webp","application/pdf"];
    const MAX = 5*1024*1024;
    for (const f of Array.from(e.target.files ?? [])) {
      if (!allowed.includes(f.type)) { toast.error(`${f.name}: only JPG, PNG, WebP, PDF`); continue; }
      if (f.size > MAX) { toast.error(`${f.name}: max 5 MB`); continue; }
      setQueuedFiles(p => [...p, { file:f, id:newId() }]);
    }
    e.target.value = "";
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelClaim(cancelTarget.id);
      toast.success("Claim cancelled");
      setCancelTarget(null);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel");
    } finally { setCancelling(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedType || !formType) return;
    if (!claimPeriod) { toast.error("Select a claim period / date"); return; }
    setSubmitting(true);
    try {
      let lineItems: ClaimLineItemInput[] | undefined;
      let entertainmentDetail: ClaimEntertainmentDetailInput | undefined;

      if (formType === CLAIM_FORM.LOCAL) {
        lineItems = [
          ...travelRows
            .filter(r => r.lineDate && r.fromLocation.trim() && r.toLocation.trim() && parseFloat(r.distanceKm) > 0)
            .map(r => ({
              category: LINE_CATEGORY.TRAVEL,
              lineDate: r.lineDate,
              fromLocation: r.fromLocation,
              toLocation: r.toLocation,
              distanceKm: parseFloat(r.distanceKm),
              ratePerUnit: selectedType.ratePerUnit ?? undefined,
              amountMyr: (parseFloat(r.distanceKm) * ratePerKm).toFixed(2),
            } satisfies ClaimLineItemInput)),
          ...miscRows
            .filter(r => r.lineDate && r.amountMyr && parseFloat(r.amountMyr) > 0)
            .map(r => ({ category: r.subType as typeof LINE_CATEGORY[keyof typeof LINE_CATEGORY], lineDate: r.lineDate, description: r.description || MISC_SUB_LABELS[r.subType], amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...inEntRows
            .filter(r => r.lineDate && r.venue.trim() && parseFloat(r.amountMyr) > 0)
            .map(r => ({ category: LINE_CATEGORY.IN_BASE_ENT, lineDate: r.lineDate, venue: r.venue, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...otherRows
            .filter(r => r.lineDate && r.description.trim() && parseFloat(r.amountMyr) > 0)
            .map(r => ({ category: LINE_CATEGORY.OTHER_LOCAL, lineDate: r.lineDate, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
        ];
        if (lineItems.length === 0) { toast.error("Add at least one expense item"); setSubmitting(false); return; }
      } else if (formType === CLAIM_FORM.OVERSEAS) {
        lineItems = [
          ...ovMyrRows.filter(r => r.lineDate && r.destination.trim() && parseFloat(r.amountMyr) > 0)
            .map(r => ({ category: LINE_CATEGORY.OVERSEAS_MYR, lineDate: r.lineDate, destination: r.destination, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...ovFxRows.filter(r => r.lineDate && r.destination.trim() && parseFloat(r.amountForeign) > 0 && parseFloat(r.exchangeRate) > 0)
            .map(r => ({ category: LINE_CATEGORY.OVERSEAS_FX, lineDate: r.lineDate, destination: r.destination, currency: r.currency, amountForeign: r.amountForeign, exchangeRate: r.exchangeRate, amountMyr: fxMyr(r.amountForeign, r.exchangeRate).toFixed(2) } satisfies ClaimLineItemInput)),
          ...ovOtherRows.filter(r => r.lineDate && r.description.trim() && parseFloat(r.amountMyr) > 0)
            .map(r => ({ category: LINE_CATEGORY.OVERSEAS_OTHER, lineDate: r.lineDate, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
        ];
        if (lineItems.length === 0) { toast.error("Add at least one expense item"); setSubmitting(false); return; }
      } else {
        if (!entDate || !entRest.trim() || !entCust.trim() || !entDeptOrg.trim() || !entPurpose.trim() || !entAmount) {
          toast.error("All entertainment fields are required"); setSubmitting(false); return;
        }
        entertainmentDetail = { eventDate: entDate, restaurantName: entRest, customerName: entCust, departmentOrganization: entDeptOrg, purpose: entPurpose, amount: entAmount };
      }

      const autoDesc = formType === CLAIM_FORM.LOCAL
        ? (note.trim() || `Local Claim — ${new Date(claimPeriod+"-02").toLocaleDateString("en-MY",{month:"long",year:"numeric"})}`)
        : formType === CLAIM_FORM.OVERSEAS
        ? (note.trim() || `Overseas Claim — ${new Date(claimPeriod+"-02").toLocaleDateString("en-MY",{month:"long",year:"numeric"})}`)
        : (entPurpose.trim() || "Entertainment");

      const appId = await submitClaim({ claimTypeId: selectedType.id, claimPeriod, description: autoDesc, lineItems, entertainmentDetail });

      for (const qf of queuedFiles) {
        const res = await fetch("/api/claim/upload-url", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ appId, fileName:qf.file.name, mimeType:qf.file.type, fileSize:qf.file.size }) });
        if (!res.ok) { toast.error(`Upload URL failed for ${qf.file.name}`); continue; }
        const { uploadUrl, key } = await res.json();
        const upload = await fetch(uploadUrl, { method:"PUT", headers:{"Content-Type":qf.file.type}, body:qf.file });
        if (!upload.ok) { toast.error(`Upload failed for ${qf.file.name}`); continue; }
        await createClaimDocumentRecord({ applicationId:appId, fileName:qf.file.name, fileKey:key, fileSize:qf.file.size, mimeType:qf.file.type });
      }

      toast.success("Claim submitted");
      setSubmitOpen(false); resetForm();
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    } finally { setSubmitting(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5 text-muted-foreground" />My Claims
          </h1>
          <p className="text-sm text-muted-foreground">View your claim history and submission status.</p>
        </div>
        {canApply && (
          <Button size="sm" onClick={() => setSubmitOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-1" />New Claim
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Claims Summary — {new Date().getFullYear()}</h2>
        <SummaryCards applications={applications} claimTypes={claimTypes} />
        {applications.filter(a => new Date(a.createdAt).getFullYear()===new Date().getFullYear() && (a.status==="APPROVED"||a.status==="PENDING")).length === 0 && (
          <div className="rounded-lg border border-border py-8 text-center text-sm text-muted-foreground">No claims submitted this year yet.</div>
        )}
      </div>

      {/* History */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Claim History</h2>
        {applications.length === 0 ? (
          <div className="rounded-lg border border-border py-10 text-center text-sm text-muted-foreground">
            No claims submitted yet.{" "}
            {canApply && <button className="text-primary hover:underline" onClick={() => setSubmitOpen(true)}>Submit a claim</button>}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-32">Ref No.</TableHead>
                  <TableHead>Claim Type</TableHead>
                  <TableHead className="w-32">Period / Date</TableHead>
                  <TableHead className="max-w-xs">Description</TableHead>
                  <TableHead className="w-28 text-right">Amount</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map(app => {
                  const ct = claimTypes.find(t => t.id === app.claimTypeId);
                  return (
                    <TableRow key={app.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{app.applicationNo}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium">{app.claimTypeName}</span>
                          {ct && <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{FORM_LABELS[ct.category] ?? ct.category}</Badge>}
                          {app.lineItems.length > 0 && <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{app.lineItems.length} items</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtClaimDate(app.claimDate, ct?.category ?? "")}</TableCell>
                      <TableCell className="max-w-xs"><p className="text-sm text-muted-foreground truncate" title={app.description}>{app.description}</p></TableCell>
                      <TableCell className="text-right text-sm font-semibold">{fmtAmount(app.amount)}</TableCell>
                      <TableCell><StatusBadge status={app.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {app.documents.length > 0 && (
                            <a href={`/api/claim/download/${app.documents[0].fileKey}`} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Download receipt"><FileDownIcon className="h-3.5 w-3.5"/></Button>
                            </a>
                          )}
                          {app.status === "PENDING" && (
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setCancelTarget(app)} title="Cancel">
                              <XIcon className="h-3.5 w-3.5"/>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Cancel Sheet */}
      <Sheet open={!!cancelTarget} onOpenChange={open => !open && setCancelTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5"><SheetTitle>Cancel Claim</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-3">
              <AlertTriangleIcon className="h-4 w-4 text-destructive mt-0.5 shrink-0"/>
              <p className="text-sm text-destructive leading-relaxed">
                Cancel <strong>{cancelTarget?.claimTypeName} ({cancelTarget?.applicationNo})</strong> for <strong>{fmtAmount(cancelTarget?.amount ?? "0")}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="destructive" onClick={handleCancel} disabled={cancelling} className="flex-1">{cancelling ? "Cancelling…" : "Yes, Cancel"}</Button>
              <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>Keep</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Submit Claim Sheet */}
      <Sheet open={submitOpen} onOpenChange={open => { if (submitting) return; if (!open) resetForm(); setSubmitOpen(open); }}>
        <SheetContent className="w-full sm:max-w-2xl max-w-full! overflow-y-auto px-6">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2"><ReceiptIcon className="h-5 w-5 text-muted-foreground"/>Submit Claim</SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5 pb-6">
            {/* Claim Type */}
            <Section title="Claim Type">
              <div className="flex flex-col gap-1.5">
                <Label>Type <span className="text-destructive">*</span></Label>
                <Select value={selectedTypeId} onValueChange={handleTypeChange}>
                  <SelectTrigger><SelectValue placeholder="Select claim type…"/></SelectTrigger>
                  <SelectContent>
                    {claimTypes.map(ct => <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {selectedType && (
                <div className="rounded-md bg-muted/40 border border-border p-3 text-sm space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="font-mono text-xs px-1.5 py-0 h-5">{selectedType.code}</Badge>
                    <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{FORM_LABELS[selectedType.category] ?? selectedType.category}</Badge>
                    {selectedType.requiresReceipt && <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-blue-700 border-blue-200 bg-blue-50">Receipt required</Badge>}
                  </div>
                  {formType === CLAIM_FORM.LOCAL && selectedType.ratePerUnit && <p className="text-muted-foreground text-xs">Travel rate: <strong className="text-foreground">RM {parseFloat(selectedType.ratePerUnit).toFixed(2)}/km</strong></p>}
                  {selectedType.maxAmountPerClaim && <p className="text-muted-foreground text-xs">Max per claim: <strong className="text-foreground">RM {parseFloat(selectedType.maxAmountPerClaim).toFixed(2)}</strong></p>}
                  {selectedType.description && <p className="text-muted-foreground text-xs italic">{selectedType.description}</p>}
                </div>
              )}
            </Section>

            {/* ── LOCAL FORM ─────────────────────────────────────────────── */}
            {formType === CLAIM_FORM.LOCAL && (<>
              <Section title="Claim Period">
                <div className="flex flex-col gap-1.5 w-48">
                  <Label>Month / Year <span className="text-destructive">*</span></Label>
                  <input type="month" value={claimPeriod} onChange={e => setClaimPeriod(e.target.value)} className={inputCls+" w-48"} required/>
                </div>
              </Section>

              {/* 1.1 Travel */}
              <Section title="1.1  Travel Expenses" badge={travelTotal > 0 ? fmtAmount(travelTotal) : undefined}>
                <div className="flex flex-col gap-2">
                  {travelRows.map((row, idx) => (
                    <div key={row.id} className="rounded-md border border-border bg-muted/20 p-3 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-4 shrink-0">{idx+1}.</span>
                        <input type="date" value={row.lineDate} onChange={e => updateTravel(row.id,"lineDate",e.target.value)} className={inputCls+" w-36"}/>
                        <div className="flex items-center gap-1 ml-auto">
                          <input type="number" min="0.1" step="0.1" placeholder="km" value={row.distanceKm} onChange={e => updateTravel(row.id,"distanceKm",e.target.value)} className={inputCls+" w-16 text-right"}/>
                          <span className="text-xs text-muted-foreground shrink-0">km</span>
                          <span className="text-xs font-semibold text-green-700 dark:text-green-400 w-20 text-right shrink-0">
                            {parseFloat(row.distanceKm)>0 ? fmtAmount(parseFloat(row.distanceKm)*ratePerKm) : "—"}
                          </span>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => remover(setTravelRows,1)(row.id)} disabled={travelRows.length===1}><XIcon className="h-3.5 w-3.5"/></Button>
                      </div>
                      <div className="flex items-center gap-1.5 pl-5">
                        <MapPinIcon className="h-3 w-3 text-muted-foreground shrink-0"/>
                        <input type="text" placeholder="From city / location" value={row.fromLocation} onChange={e => updateTravel(row.id,"fromLocation",e.target.value)} className={inputCls}/>
                        <ArrowRightIcon className="h-3 w-3 text-muted-foreground shrink-0"/>
                        <input type="text" placeholder="To city / location" value={row.toLocation} onChange={e => updateTravel(row.id,"toLocation",e.target.value)} className={inputCls}/>
                      </div>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setTravelRows(p => [...p,emptyTravel()])}><PlusIcon className="h-3.5 w-3.5"/>Add Trip</Button>
              </Section>

              {/* 1.2 Miscellaneous */}
              <Section title="1.2  Miscellaneous Expenses" badge={miscTotal > 0 ? fmtAmount(miscTotal) : undefined}>
                <div className="flex flex-col gap-2">
                  {miscRows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-2 items-center rounded-md border border-border bg-muted/20 px-3 py-2">
                      <Select value={row.subType} onValueChange={v => updateMisc(row.id,"subType",v)}>
                        <SelectTrigger className="h-7 text-xs w-36"><SelectValue/></SelectTrigger>
                        <SelectContent>
                          {Object.entries(MISC_SUB_LABELS).map(([k,v]) => <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <input type="date" value={row.lineDate} onChange={e => updateMisc(row.id,"lineDate",e.target.value)} className={inputCls}/>
                      <input type="text" placeholder="Description (optional)" value={row.description} onChange={e => updateMisc(row.id,"description",e.target.value)} className={inputCls}/>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground shrink-0">RM</span>
                        <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.amountMyr} onChange={e => updateMisc(row.id,"amountMyr",e.target.value)} className={inputCls+" w-24"}/>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setMiscRows(p => p.filter(r => r.id!==row.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setMiscRows(p => [...p,emptyMisc()])}><PlusIcon className="h-3.5 w-3.5"/>Add Item</Button>
              </Section>

              {/* 1.3 In-Base Entertainment */}
              <Section title="1.3  In-Base Entertainment" badge={inEntTotal > 0 ? fmtAmount(inEntTotal) : undefined}>
                <div className="flex flex-col gap-2">
                  {inEntRows.map((row) => (
                    <div key={row.id} className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
                      <div className="flex items-center gap-2">
                        <input type="date" value={row.lineDate} onChange={e => updateInEnt(row.id,"lineDate",e.target.value)} className={inputCls+" w-36"}/>
                        <input type="text" placeholder="Venue / Restaurant" value={row.venue} onChange={e => updateInEnt(row.id,"venue",e.target.value)} className={inputCls}/>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-xs text-muted-foreground">RM</span>
                          <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.amountMyr} onChange={e => updateInEnt(row.id,"amountMyr",e.target.value)} className={inputCls+" w-24"}/>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setInEntRows(p => p.filter(r => r.id!==row.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                      </div>
                      <input type="text" placeholder="Purpose / description" value={row.description} onChange={e => updateInEnt(row.id,"description",e.target.value)} className={inputCls}/>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setInEntRows(p => [...p,emptyInEnt()])}><PlusIcon className="h-3.5 w-3.5"/>Add Item</Button>
              </Section>

              {/* 1.4 Other Expenses */}
              <Section title="1.4  Other Expenses" badge={otherTotal > 0 ? fmtAmount(otherTotal) : undefined}>
                <div className="flex flex-col gap-2">
                  {otherRows.map((row) => (
                    <div key={row.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                      <input type="date" value={row.lineDate} onChange={e => updateOther(row.id,"lineDate",e.target.value)} className={inputCls+" w-36"}/>
                      <input type="text" placeholder="Description (CME, Gift, Medical fee, etc.)" value={row.description} onChange={e => updateOther(row.id,"description",e.target.value)} className={inputCls}/>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-muted-foreground">RM</span>
                        <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.amountMyr} onChange={e => updateOther(row.id,"amountMyr",e.target.value)} className={inputCls+" w-24"}/>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setOtherRows(p => p.filter(r => r.id!==row.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setOtherRows(p => [...p,emptyOther()])}><PlusIcon className="h-3.5 w-3.5"/>Add Item</Button>
              </Section>

              {localTotal > 0 && (
                <div className="flex justify-between items-center py-2 border-t border-border">
                  <span className="text-sm text-muted-foreground">Grand Total</span>
                  <span className="text-lg font-bold text-green-700 dark:text-green-400">{fmtAmount(localTotal)}</span>
                </div>
              )}
            </>)}

            {/* ── OVERSEAS FORM ──────────────────────────────────────────── */}
            {formType === CLAIM_FORM.OVERSEAS && (<>
              <Section title="Claim Period">
                <div className="flex flex-col gap-1.5 w-48">
                  <Label>Month / Year <span className="text-destructive">*</span></Label>
                  <input type="month" value={claimPeriod} onChange={e => setClaimPeriod(e.target.value)} className={inputCls+" w-48"} required/>
                </div>
              </Section>

              {/* 2.1 Travel MYR */}
              <Section title="2.1  Travel Expenses (RM)" badge={ovMyrTotal > 0 ? fmtAmount(ovMyrTotal) : undefined}>
                <div className="flex flex-col gap-2">
                  {ovMyrRows.map(row => (
                    <div key={row.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                      <input type="date" value={row.lineDate} onChange={e => updateOvMyr(row.id,"lineDate",e.target.value)} className={inputCls+" w-36"}/>
                      <input type="text" placeholder="Destination" value={row.destination} onChange={e => updateOvMyr(row.id,"destination",e.target.value)} className={inputCls}/>
                      <input type="text" placeholder="Description" value={row.description} onChange={e => updateOvMyr(row.id,"description",e.target.value)} className={inputCls}/>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-muted-foreground">RM</span>
                        <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.amountMyr} onChange={e => updateOvMyr(row.id,"amountMyr",e.target.value)} className={inputCls+" w-24"}/>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setOvMyrRows(p => p.filter(r => r.id!==row.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setOvMyrRows(p => [...p,emptyOvMyr()])}><PlusIcon className="h-3.5 w-3.5"/>Add</Button>
              </Section>

              {/* 2.2 Travel Foreign Currency */}
              <Section title="2.2  Travel Expenses (Foreign Currency)" badge={ovFxTotal > 0 ? fmtAmount(ovFxTotal) : undefined}>
                <div className="flex flex-col gap-2">
                  {ovFxRows.map(row => {
                    const myr = fxMyr(row.amountForeign, row.exchangeRate);
                    return (
                      <div key={row.id} className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
                        <div className="flex items-center gap-2">
                          <input type="date" value={row.lineDate} onChange={e => updateOvFx(row.id,"lineDate",e.target.value)} className={inputCls+" w-36"}/>
                          <input type="text" placeholder="Destination" value={row.destination} onChange={e => updateOvFx(row.id,"destination",e.target.value)} className={inputCls}/>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive ml-auto" onClick={() => setOvFxRows(p => p.filter(r => r.id!==row.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select value={row.currency} onValueChange={v => updateOvFx(row.id,"currency",v)}>
                            <SelectTrigger className="h-7 text-xs w-24"><SelectValue/></SelectTrigger>
                            <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
                          </Select>
                          <input type="number" min="0.01" step="0.01" placeholder={`Amount (${row.currency})`} value={row.amountForeign} onChange={e => updateOvFx(row.id,"amountForeign",e.target.value)} className={inputCls}/>
                          <span className="text-xs text-muted-foreground shrink-0">× rate</span>
                          <input type="number" min="0.001" step="0.001" placeholder="e.g. 4.50" value={row.exchangeRate} onChange={e => updateOvFx(row.id,"exchangeRate",e.target.value)} className={inputCls+" w-24"}/>
                          <span className="text-xs font-semibold text-green-700 dark:text-green-400 w-24 text-right shrink-0">{myr > 0 ? fmtAmount(myr) : "—"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setOvFxRows(p => [...p,emptyOvFx()])}><PlusIcon className="h-3.5 w-3.5"/>Add</Button>
              </Section>

              {/* 2.3 Other */}
              <Section title="2.3  Other Expenses" badge={ovOtherTotal > 0 ? fmtAmount(ovOtherTotal) : undefined}>
                <div className="flex flex-col gap-2">
                  {ovOtherRows.map(row => (
                    <div key={row.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                      <input type="date" value={row.lineDate} onChange={e => updateOvOther(row.id,"lineDate",e.target.value)} className={inputCls+" w-36"}/>
                      <input type="text" placeholder="Description" value={row.description} onChange={e => updateOvOther(row.id,"description",e.target.value)} className={inputCls}/>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-muted-foreground">RM</span>
                        <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.amountMyr} onChange={e => updateOvOther(row.id,"amountMyr",e.target.value)} className={inputCls+" w-24"}/>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setOvOtherRows(p => p.filter(r => r.id!==row.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setOvOtherRows(p => [...p,emptyOvOther()])}><PlusIcon className="h-3.5 w-3.5"/>Add</Button>
              </Section>

              {overseasTotal > 0 && (
                <div className="flex justify-between items-center py-2 border-t border-border">
                  <span className="text-sm text-muted-foreground">Grand Total (MYR)</span>
                  <span className="text-lg font-bold text-green-700 dark:text-green-400">{fmtAmount(overseasTotal)}</span>
                </div>
              )}
            </>)}

            {/* ── ENTERTAINMENT FORM ─────────────────────────────────────── */}
            {formType === CLAIM_FORM.ENTERTAINMENT_FORM && (
              <Section title="Entertainment Details">
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <Label htmlFor="entDate">Date <span className="text-destructive">*</span></Label>
                    <Input id="entDate" type="date" value={entDate} onChange={e => setEntDate(e.target.value)} max={new Date().toISOString().split("T")[0]} required/>
                  </Field>
                  <Field>
                    <Label htmlFor="entAmount">Amount (RM) <span className="text-destructive">*</span></Label>
                    <Input id="entAmount" type="number" min="0.01" step="0.01" placeholder="0.00" value={entAmount} onChange={e => setEntAmount(e.target.value)} required/>
                  </Field>
                </div>
                <Field>
                  <Label htmlFor="entRest">Restaurant / Venue Name <span className="text-destructive">*</span></Label>
                  <Input id="entRest" value={entRest} onChange={e => setEntRest(e.target.value)} placeholder="e.g. Restoran Nelayan, Kuala Lumpur" required/>
                </Field>
                <Field>
                  <Label htmlFor="entCust">Customer Name <span className="text-destructive">*</span></Label>
                  <Input id="entCust" value={entCust} onChange={e => setEntCust(e.target.value)} placeholder="Customer or guest name" required/>
                </Field>
                <Field>
                  <Label htmlFor="entDeptOrg">Department &amp; Organization <span className="text-destructive">*</span></Label>
                  <Input id="entDeptOrg" value={entDeptOrg} onChange={e => setEntDeptOrg(e.target.value)} placeholder="e.g. Procurement Dept, ABC Sdn Bhd" required/>
                </Field>
                <Field>
                  <Label htmlFor="entPurpose">Purpose <span className="text-destructive">*</span></Label>
                  <Textarea id="entPurpose" value={entPurpose} onChange={e => setEntPurpose(e.target.value)} placeholder="e.g. Business discussion on Q3 supply contract renewal" rows={2} required/>
                </Field>
              </Section>
            )}

            {/* Note / Receipt (shared) */}
            {selectedType && formType !== CLAIM_FORM.ENTERTAINMENT_FORM && (
              <Section title="Note" badge="optional">
                <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Any additional notes for this claim…" rows={2}/>
              </Section>
            )}

            {selectedType && (
              <Section title="Receipt / Supporting Documents" badge={selectedType.requiresReceipt ? "required" : "optional"}>
                <div className="flex items-center justify-between">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
                    <UploadIcon className="h-3.5 w-3.5"/>Add File
                  </Button>
                </div>
                <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" multiple className="hidden" onChange={handleFileSelect}/>
                {queuedFiles.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <InfoIcon className="h-4 w-4 shrink-0"/>
                    <span>{selectedType.requiresReceipt ? "Receipt required — JPG, PNG, WebP or PDF (max 5 MB)." : "No receipt required, but you may attach one."}</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {queuedFiles.map(qf => (
                      <div key={qf.id} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <p className="text-sm font-medium truncate">{qf.file.name}</p>
                          <p className="text-xs text-muted-foreground">{(qf.file.size/1024).toFixed(0)} KB</p>
                        </div>
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => setQueuedFiles(p => p.filter(f => f.id!==qf.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* Actions */}
            {selectedType && (
              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={submitting || !selectedTypeId || !claimPeriod} className="flex-1 sm:flex-none sm:min-w-44">
                  {submitting ? "Submitting…" : `Submit ${FORM_LABELS[formType ?? ""] ?? "Claim"}`}
                </Button>
                <Button type="button" variant="outline" disabled={submitting} onClick={() => { resetForm(); setSubmitOpen(false); }}>Cancel</Button>
              </div>
            )}
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
