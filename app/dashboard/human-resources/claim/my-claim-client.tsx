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
} from "@/server/claim";
import { CLAIM_FORM, LINE_CATEGORY, TRAVEL_MODE, TRAVEL_MODE_LABELS } from "@/lib/claim/constants";
import {
  PlusIcon, FileDownIcon, XIcon, ReceiptIcon,
  AlertTriangleIcon, UploadIcon, InfoIcon, ArrowRightIcon, MapPinIcon, LoaderIcon, RouteIcon,
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

interface TravelRow {
  id:string; lineDate:string; fromLocation:string; toLocation:string; distanceKm:string;
  mode:string;          // TRAVEL_MODE value or ""
  purpose:string;
  flightFile?: File;    // required when mode = FLIGHT
  resolvedFrom?: string; resolvedTo?: string; // display names from geocoding
  // Daily allowance (meal)
  dailyId:string; breakfastDays:string; lunchDays:string; dinnerDays:string;
  // Accommodation
  accomId:string; accomAmount:string; accomFile?:File;
  // Travel entertainment
  tEntId:string; tEntAmount:string; tEntFile?:File;
}
interface MiscRow     { id:string; subType:"TOLL"|"PARKING"|"MOBILE"; lineDate:string; description:string; amountMyr:string; file?:File }
interface InEntRow    { id:string; lineDate:string; venue:string; description:string; amountMyr:string; file?:File }
interface OtherLocalRow { id:string; lineDate:string; description:string; amountMyr:string; file?:File }

interface OvMyrRow    { id:string; lineDate:string; destination:string; description:string; amountMyr:string }
interface OvFxRow     { id:string; lineDate:string; destination:string; currency:string; amountForeign:string; exchangeRate:string }
interface OvOtherRow  { id:string; lineDate:string; description:string; amountMyr:string }
interface QueuedFile  { file:File; id:string }

const newId = () => crypto.randomUUID();
const emptyTravel = (): TravelRow => ({
  id:newId(), lineDate:"", fromLocation:"", toLocation:"", distanceKm:"", mode:"", purpose:"",
  dailyId:newId(), breakfastDays:"", lunchDays:"", dinnerDays:"",
  accomId:newId(), accomAmount:"", accomFile:undefined,
  tEntId:newId(), tEntAmount:"", tEntFile:undefined,
});
const emptyMisc     = (): MiscRow       => ({ id:newId(), subType:"TOLL", lineDate:"", description:"", amountMyr:"" });
const emptyInEnt    = (): InEntRow      => ({ id:newId(), lineDate:"", venue:"", description:"", amountMyr:"" });
const emptyOther    = (): OtherLocalRow => ({ id:newId(), lineDate:"", description:"", amountMyr:"" });

const ALLOWED_RECEIPT_TYPES = ["image/jpeg","image/png","image/webp","application/pdf"];
const MAX_RECEIPT_SIZE = 5 * 1024 * 1024;

function pickReceiptFile(e: React.ChangeEvent<HTMLInputElement>): File | null {
  const f = e.target.files?.[0] ?? null;
  e.target.value = "";
  if (!f) return null;
  if (!ALLOWED_RECEIPT_TYPES.includes(f.type)) { toast.error(`${f.name}: only JPG, PNG, WebP, PDF`); return null; }
  if (f.size > MAX_RECEIPT_SIZE) { toast.error(`${f.name}: max 5 MB`); return null; }
  return f;
}

function TravelSubFilePicker({ file, onPick, onRemove }: { file?: File; onPick:(f:File)=>void; onRemove:()=>void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1 shrink-0">
      <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden"
        onChange={e => { const f = pickReceiptFile(e); if (f) onPick(f); }}/>
      {file ? (
        <div className="flex items-center gap-1 rounded border border-green-500/40 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 max-w-30">
          <span className="text-xs text-green-700 dark:text-green-400 truncate" title={file.name}>{file.name}</span>
          <button type="button" onClick={onRemove} className="text-green-600 hover:text-destructive shrink-0"><XIcon className="h-3 w-3"/></button>
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()}
          className="flex items-center gap-1 rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary shrink-0">
          <UploadIcon className="h-3 w-3 shrink-0"/>Receipt
        </button>
      )}
    </div>
  );
}

function ReceiptPicker<T extends { id: string; file?: File }>({
  row, setter,
}: {
  row: T;
  setter: React.Dispatch<React.SetStateAction<T[]>>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1 shrink-0">
      <input
        ref={ref}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.pdf"
        className="hidden"
        onChange={e => {
          const f = pickReceiptFile(e);
          if (f) setter(prev => prev.map(r => r.id === row.id ? { ...r, file: f } : r));
        }}
      />
      {row.file ? (
        <div className="flex items-center gap-1 rounded border border-green-500/40 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 max-w-30">
          <span className="text-xs text-green-700 dark:text-green-400 truncate" title={row.file.name}>{row.file.name}</span>
          <button type="button" onClick={() => setter(prev => prev.map(r => r.id === row.id ? { ...r, file: undefined } : r))} className="text-green-600 hover:text-destructive shrink-0">
            <XIcon className="h-3 w-3"/>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="flex items-center gap-1 rounded border border-dashed border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 shrink-0"
          title="Attach receipt"
        >
          <UploadIcon className="h-3 w-3 shrink-0"/>Receipt*
        </button>
      )}
    </div>
  );
}

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
  const [calculatingRows, setCalculatingRows] = useState<Set<string>>(new Set());

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
  const ratePerKm        = selectedType?.ratePerUnit ? parseFloat(selectedType.ratePerUnit) : 0;
  const mealBreakfastRate = selectedType?.mealBreakfastRate ? parseFloat(selectedType.mealBreakfastRate) : 0;
  const mealLunchRate     = selectedType?.mealLunchRate     ? parseFloat(selectedType.mealLunchRate)     : 0;
  const mealDinnerRate    = selectedType?.mealDinnerRate    ? parseFloat(selectedType.mealDinnerRate)    : 0;
  const hasMealRates      = mealBreakfastRate > 0 || mealLunchRate > 0 || mealDinnerRate > 0;

  // ── Totals ────────────────────────────────────────────────────────────────
  const travelTotal  = travelRows.reduce((s,r) => {
    const km     = parseFloat(r.distanceKm);
    const mileage = (isNaN(km)||km<=0) ? 0 : km*ratePerKm;
    const daily   = (parseFloat(r.breakfastDays)||0)*mealBreakfastRate + (parseFloat(r.lunchDays)||0)*mealLunchRate + (parseFloat(r.dinnerDays)||0)*mealDinnerRate;
    const accom   = parseFloat(r.accomAmount)||0;
    const ent     = parseFloat(r.tEntAmount)||0;
    return s + mileage + daily + accom + ent;
  }, 0);
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
  function setTravelFile(rowId: string, field: "accomFile" | "tEntFile" | "flightFile", file: File | undefined) {
    setTravelRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: file } : r));
  }
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

  // ── Distance calculator ───────────────────────────────────────────────────
  async function calculateDistance(rowId: string, from: string, to: string) {
    if (!from.trim() || !to.trim()) {
      toast.error("Enter both From and To locations first");
      return;
    }
    setCalculatingRows(prev => new Set(prev).add(rowId));
    try {
      const res = await fetch("/api/claim/distance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Could not calculate distance"); return; }
      setTravelRows(prev => prev.map(r => r.id === rowId ? {
        ...r,
        distanceKm: String(data.distanceKm),
        resolvedFrom: data.resolvedFrom,
        resolvedTo: data.resolvedTo,
      } : r));
      toast.success(`${data.distanceKm} km (road distance)`);
    } catch {
      toast.error("Distance lookup failed");
    } finally {
      setCalculatingRows(prev => { const s = new Set(prev); s.delete(rowId); return s; });
    }
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
        // Validate receipt presence for misc / in-base-ent / other rows
        const miscValid  = miscRows.filter(r => r.lineDate && parseFloat(r.amountMyr) > 0);
        const inEntValid = inEntRows.filter(r => r.lineDate && r.venue.trim() && parseFloat(r.amountMyr) > 0);
        const otherValid = otherRows.filter(r => r.lineDate && r.description.trim() && parseFloat(r.amountMyr) > 0);
        const flightMissingReceipt = travelRows.find(r => r.mode === TRAVEL_MODE.FLIGHT && !r.flightFile);
        if (flightMissingReceipt) { toast.error("Flight receipt is required for flight travel"); setSubmitting(false); return; }
        const accomMissingReceipt = travelRows.find(r => parseFloat(r.accomAmount) > 0 && !r.accomFile);
        if (accomMissingReceipt) { toast.error("Accommodation receipt is required"); setSubmitting(false); return; }
        const tEntMissingReceipt = travelRows.find(r => parseFloat(r.tEntAmount) > 0 && !r.tEntFile);
        if (tEntMissingReceipt) { toast.error("Travel entertainment receipt is required"); setSubmitting(false); return; }
        const missingReceipt = [...miscValid, ...inEntValid, ...otherValid].find(r => !r.file);
        if (missingReceipt) { toast.error("Each expense item requires an attached receipt"); setSubmitting(false); return; }

        lineItems = [
          ...travelRows.flatMap(r => {
            if (!r.lineDate) return [];
            const items: ClaimLineItemInput[] = [];
            const km = parseFloat(r.distanceKm);
            const usesMileage = r.mode !== TRAVEL_MODE.FLIGHT && r.mode !== TRAVEL_MODE.COMPANY_CAR;
            const mileageAmt = usesMileage && km > 0 ? km * ratePerKm : 0;
            // Always create a TRAVEL line item so documents (e.g. flight receipt) have an anchor
            if (r.lineDate && (r.fromLocation.trim() || r.toLocation.trim() || r.purpose.trim() || r.mode)) {
              items.push({ id: r.id, category: LINE_CATEGORY.TRAVEL, lineDate: r.lineDate, fromLocation: r.fromLocation || undefined, toLocation: r.toLocation || undefined, distanceKm: usesMileage && km > 0 ? km : undefined, ratePerUnit: usesMileage ? (selectedType.ratePerUnit ?? undefined) : undefined, description: r.purpose.trim() || (r.mode ? TRAVEL_MODE_LABELS[r.mode] : undefined), amountMyr: mileageAmt.toFixed(2) });
            }
            const bf = parseFloat(r.breakfastDays)||0;
            const ln = parseFloat(r.lunchDays)||0;
            const dn = parseFloat(r.dinnerDays)||0;
            const dailyTotal = bf*mealBreakfastRate + ln*mealLunchRate + dn*mealDinnerRate;
            if (dailyTotal > 0) {
              const parts = [];
              if (bf > 0) parts.push(`Breakfast ×${bf}d`);
              if (ln > 0) parts.push(`Lunch ×${ln}d`);
              if (dn > 0) parts.push(`Dinner ×${dn}d`);
              items.push({ id: r.dailyId, category: LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE, lineDate: r.lineDate, description: parts.join(", "), amountMyr: dailyTotal.toFixed(2) });
            }
            if (parseFloat(r.accomAmount) > 0) {
              items.push({ id: r.accomId, category: LINE_CATEGORY.TRAVEL_ACCOMMODATION, lineDate: r.lineDate, amountMyr: r.accomAmount });
            }
            if (parseFloat(r.tEntAmount) > 0) {
              items.push({ id: r.tEntId, category: LINE_CATEGORY.TRAVEL_ENTERTAINMENT, lineDate: r.lineDate, amountMyr: r.tEntAmount });
            }
            return items;
          }),
          ...miscValid.map(r => ({ id: r.id, category: r.subType as typeof LINE_CATEGORY[keyof typeof LINE_CATEGORY], lineDate: r.lineDate, description: r.description || MISC_SUB_LABELS[r.subType], amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...inEntValid.map(r => ({ id: r.id, category: LINE_CATEGORY.IN_BASE_ENT, lineDate: r.lineDate, venue: r.venue, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...otherValid.map(r => ({ id: r.id, category: LINE_CATEGORY.OTHER_LOCAL, lineDate: r.lineDate, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
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

      // Build upload queue: line-item receipts + any global files
      type UploadJob = { file: File; lineItemId?: string };
      const uploadJobs: UploadJob[] = [
        ...travelRows.filter(r => r.flightFile).map(r => ({ file: r.flightFile!, lineItemId: r.id })),
        ...travelRows.filter(r => r.accomFile && parseFloat(r.accomAmount) > 0).map(r => ({ file: r.accomFile!, lineItemId: r.accomId })),
        ...travelRows.filter(r => r.tEntFile && parseFloat(r.tEntAmount) > 0).map(r => ({ file: r.tEntFile!, lineItemId: r.tEntId })),
        ...miscRows.filter(r => r.file).map(r => ({ file: r.file!, lineItemId: r.id })),
        ...inEntRows.filter(r => r.file).map(r => ({ file: r.file!, lineItemId: r.id })),
        ...otherRows.filter(r => r.file).map(r => ({ file: r.file!, lineItemId: r.id })),

        ...queuedFiles.map(qf => ({ file: qf.file })),
      ];

      for (const job of uploadJobs) {
        const res = await fetch("/api/claim/upload-url", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ appId, fileName:job.file.name, mimeType:job.file.type, fileSize:job.file.size }) });
        if (!res.ok) { toast.error(`Upload URL failed for ${job.file.name}`); continue; }
        const { uploadUrl, key } = await res.json();
        const upload = await fetch(uploadUrl, { method:"PUT", headers:{"Content-Type":job.file.type}, body:job.file });
        if (!upload.ok) { toast.error(`Upload failed for ${job.file.name}`); continue; }
        await createClaimDocumentRecord({ applicationId:appId, lineItemId:job.lineItemId, fileName:job.file.name, fileKey:key, fileSize:job.file.size, mimeType:job.file.type });
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
                <div className="flex flex-col gap-4">
                  {travelRows.map((row, idx) => {
                    const km         = parseFloat(row.distanceKm);
                    const mileageAmt = (isNaN(km)||km<=0) ? 0 : km*ratePerKm;
                    const bfDays = parseFloat(row.breakfastDays)||0;
                    const lnDays = parseFloat(row.lunchDays)||0;
                    const dnDays = parseFloat(row.dinnerDays)||0;
                    const dailyAmt   = bfDays*mealBreakfastRate + lnDays*mealLunchRate + dnDays*mealDinnerRate;
                    const accomAmt   = parseFloat(row.accomAmount)||0;
                    const tEntAmt    = parseFloat(row.tEntAmount)||0;
                    const tripTotal  = mileageAmt+dailyAmt+accomAmt+tEntAmt;
                    const showMileage = row.mode !== TRAVEL_MODE.FLIGHT && row.mode !== TRAVEL_MODE.COMPANY_CAR;
                    const labelCls = "text-xs text-muted-foreground w-32 shrink-0 pt-1.5";
                    return (
                      <div key={row.id} className="rounded-lg border border-border bg-card overflow-hidden">
                        {/* ── Card header ─────────────────────────────────── */}
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                          <span className="text-xs font-semibold text-foreground">Trip {idx+1}</span>
                          <div className="flex items-center gap-2">
                            {tripTotal > 0 && <span className="text-xs font-bold text-green-700 dark:text-green-400">{fmtAmount(tripTotal)}</span>}
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => remover(setTravelRows,1)(row.id)} disabled={travelRows.length===1}><XIcon className="h-3.5 w-3.5"/></Button>
                          </div>
                        </div>

                        {/* ── Trip details ─────────────────────────────────── */}
                        <div className="p-4 flex flex-col gap-3">
                          {/* Date + Mode */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Date</span>
                              <input type="date" value={row.lineDate} onChange={e => updateTravel(row.id,"lineDate",e.target.value)} className={inputCls}/>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Mode of transport</span>
                              <Select value={row.mode} onValueChange={v => updateTravel(row.id,"mode",v)}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select mode…"/></SelectTrigger>
                                <SelectContent>
                                  {Object.entries(TRAVEL_MODE_LABELS).map(([k,v]) => <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          {/* Purpose */}
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Purpose of travel</span>
                            <input type="text" placeholder="e.g. Client visit, site inspection, training…" value={row.purpose} onChange={e => updateTravel(row.id,"purpose",e.target.value)} className={inputCls}/>
                          </div>

                          {/* Route + mileage */}
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPinIcon className="h-3 w-3"/>Route</span>
                            <div className="flex items-center gap-2">
                              <input type="text" placeholder="From city / location" value={row.fromLocation} onChange={e => updateTravel(row.id,"fromLocation",e.target.value)} onBlur={e => { if (e.target.value.trim() && row.toLocation.trim() && showMileage) calculateDistance(row.id, e.target.value, row.toLocation); }} className={inputCls}/>
                              <ArrowRightIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0"/>
                              <input type="text" placeholder="To city / location" value={row.toLocation} onChange={e => updateTravel(row.id,"toLocation",e.target.value)} onBlur={e => { if (e.target.value.trim() && row.fromLocation.trim() && showMileage) calculateDistance(row.id, row.fromLocation, e.target.value); }} className={inputCls}/>
                            </div>
                            {showMileage && (
                              <div className="flex flex-col gap-1 mt-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground w-16 shrink-0">Distance</span>
                                  <input type="number" placeholder="auto-calculated" value={row.distanceKm} readOnly className={inputCls+" w-36 bg-muted cursor-not-allowed text-muted-foreground"}/>
                                  <span className="text-xs text-muted-foreground">km</span>
                                  {mileageAmt > 0 && (
                                    <span className="text-xs text-muted-foreground">× RM{ratePerKm.toFixed(2)}/km =
                                      <strong className="text-green-700 dark:text-green-400 ml-1">{fmtAmount(mileageAmt)}</strong>
                                    </span>
                                  )}
                                  {calculatingRows.has(row.id) && <LoaderIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0"/>}
                                </div>
                                {row.resolvedFrom && row.resolvedTo && row.distanceKm && (
                                  <p className="text-xs text-muted-foreground flex items-center gap-1 pl-0">
                                    <InfoIcon className="h-3 w-3 shrink-0"/>
                                    Road distance: <strong className="text-foreground mx-0.5">{row.resolvedFrom}</strong> → <strong className="text-foreground mx-0.5">{row.resolvedTo}</strong> = {row.distanceKm} km via OpenStreetMap routing
                                  </p>
                                )}
                                {!row.distanceKm && !calculatingRows.has(row.id) && row.fromLocation.trim() && row.toLocation.trim() && (
                                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                    <InfoIcon className="h-3 w-3 shrink-0"/>
                                    Distance is auto-calculated — tab out of the city fields above to trigger
                                  </p>
                                )}
                              </div>
                            )}
                            {row.mode === TRAVEL_MODE.FLIGHT && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-muted-foreground">Flight receipt <span className="text-destructive">*</span></span>
                                <TravelSubFilePicker
                                  file={row.flightFile}
                                  onPick={f => setTravelFile(row.id,"flightFile",f)}
                                  onRemove={() => setTravelFile(row.id,"flightFile",undefined)}
                                />
                                {!row.flightFile && <span className="text-xs text-amber-600 dark:text-amber-400">Required for flight travel</span>}
                              </div>
                            )}
                          </div>

                          {/* ── Sub-expenses ──────────────────────────────── */}
                          <div className="flex flex-col gap-0 border-t border-border/60 pt-3">
                            <p className="text-xs font-medium text-muted-foreground mb-2">Associated Expenses</p>

                            {/* Daily allowance */}
                            <div className="flex gap-3 py-2 border-b border-border/40">
                              <span className={labelCls}>Daily allowance</span>
                              {hasMealRates ? (
                                <div className="flex flex-col gap-1.5 flex-1">
                                  {mealBreakfastRate > 0 && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground w-14 shrink-0">Breakfast</span>
                                      <input type="number" min="0" step="1" placeholder="0" value={row.breakfastDays} onChange={e => updateTravel(row.id,"breakfastDays",e.target.value)} className={inputCls+" w-14 text-right"}/>
                                      <span className="text-xs text-muted-foreground shrink-0">day(s) × RM{mealBreakfastRate.toFixed(2)}</span>
                                      {bfDays > 0 && <span className="text-xs font-medium text-green-700 dark:text-green-400 ml-auto">{fmtAmount(bfDays*mealBreakfastRate)}</span>}
                                    </div>
                                  )}
                                  {mealLunchRate > 0 && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground w-14 shrink-0">Lunch</span>
                                      <input type="number" min="0" step="1" placeholder="0" value={row.lunchDays} onChange={e => updateTravel(row.id,"lunchDays",e.target.value)} className={inputCls+" w-14 text-right"}/>
                                      <span className="text-xs text-muted-foreground shrink-0">day(s) × RM{mealLunchRate.toFixed(2)}</span>
                                      {lnDays > 0 && <span className="text-xs font-medium text-green-700 dark:text-green-400 ml-auto">{fmtAmount(lnDays*mealLunchRate)}</span>}
                                    </div>
                                  )}
                                  {mealDinnerRate > 0 && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground w-14 shrink-0">Dinner</span>
                                      <input type="number" min="0" step="1" placeholder="0" value={row.dinnerDays} onChange={e => updateTravel(row.id,"dinnerDays",e.target.value)} className={inputCls+" w-14 text-right"}/>
                                      <span className="text-xs text-muted-foreground shrink-0">day(s) × RM{mealDinnerRate.toFixed(2)}</span>
                                      {dnDays > 0 && <span className="text-xs font-medium text-green-700 dark:text-green-400 ml-auto">{fmtAmount(dnDays*mealDinnerRate)}</span>}
                                    </div>
                                  )}
                                  {dailyAmt > 0 && <div className="flex justify-end"><span className="text-xs font-semibold text-green-700 dark:text-green-400">Subtotal {fmtAmount(dailyAmt)}</span></div>}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground italic pt-1.5">No meal rates configured — set in Claim Types</span>
                              )}
                            </div>

                            {/* Accommodation */}
                            <div className="flex items-center gap-3 py-2 border-b border-border/40">
                              <span className={labelCls}>Accommodation</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">RM</span>
                                <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.accomAmount} onChange={e => updateTravel(row.id,"accomAmount",e.target.value)} className={inputCls+" w-28"}/>
                              </div>
                              <TravelSubFilePicker file={row.accomFile} onPick={f => setTravelFile(row.id,"accomFile",f)} onRemove={() => setTravelFile(row.id,"accomFile",undefined)}/>
                              {accomAmt > 0 && !row.accomFile && <span className="text-xs text-destructive ml-auto">Receipt required <span aria-hidden>*</span></span>}
                              {accomAmt > 0 && row.accomFile && <span className="text-xs font-medium text-green-700 dark:text-green-400 ml-auto">{fmtAmount(accomAmt)}</span>}
                            </div>

                            {/* Travel entertainment */}
                            <div className="flex items-center gap-3 py-2">
                              <span className={labelCls}>Entertainment</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">RM</span>
                                <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.tEntAmount} onChange={e => updateTravel(row.id,"tEntAmount",e.target.value)} className={inputCls+" w-28"}/>
                              </div>
                              <TravelSubFilePicker file={row.tEntFile} onPick={f => setTravelFile(row.id,"tEntFile",f)} onRemove={() => setTravelFile(row.id,"tEntFile",undefined)}/>
                              {tEntAmt > 0 && !row.tEntFile && <span className="text-xs text-destructive ml-auto">Receipt required <span aria-hidden>*</span></span>}
                              {tEntAmt > 0 && row.tEntFile && <span className="text-xs font-medium text-green-700 dark:text-green-400 ml-auto">{fmtAmount(tEntAmt)}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setTravelRows(p => [...p,emptyTravel()])}><PlusIcon className="h-3.5 w-3.5"/>Add Trip</Button>
              </Section>

              {/* 1.2 Miscellaneous */}
              <Section title="1.2  Miscellaneous Expenses" badge={miscTotal > 0 ? fmtAmount(miscTotal) : undefined}>
                <div className="flex flex-col gap-4">
                  {miscRows.map((row, idx) => {
                    const amt = parseFloat(row.amountMyr)||0;
                    return (
                      <div key={row.id} className="rounded-lg border border-border bg-card overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                          <span className="text-xs font-semibold">Item {idx+1}</span>
                          <div className="flex items-center gap-2">
                            {amt > 0 && <span className="text-xs font-bold text-green-700 dark:text-green-400">{fmtAmount(amt)}</span>}
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setMiscRows(p => p.filter(r => r.id!==row.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                          </div>
                        </div>
                        <div className="p-4 flex flex-col gap-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Type</span>
                              <Select value={row.subType} onValueChange={v => updateMisc(row.id,"subType",v)}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                                <SelectContent>
                                  {Object.entries(MISC_SUB_LABELS).map(([k,v]) => <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Date</span>
                              <input type="date" value={row.lineDate} onChange={e => updateMisc(row.id,"lineDate",e.target.value)} className={inputCls}/>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Description <span className="font-normal opacity-60">(optional)</span></span>
                            <input type="text" placeholder="e.g. Penang bridge toll" value={row.description} onChange={e => updateMisc(row.id,"description",e.target.value)} className={inputCls}/>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Amount</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">RM</span>
                                <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.amountMyr} onChange={e => updateMisc(row.id,"amountMyr",e.target.value)} className={inputCls+" w-28"}/>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Receipt <span className="text-destructive">*</span></span>
                              <ReceiptPicker row={row} setter={setMiscRows}/>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setMiscRows(p => [...p,emptyMisc()])}><PlusIcon className="h-3.5 w-3.5"/>Add Item</Button>
              </Section>

              {/* 1.3 In-Base Entertainment */}
              <Section title="1.3  In-Base Entertainment" badge={inEntTotal > 0 ? fmtAmount(inEntTotal) : undefined}>
                <div className="flex flex-col gap-4">
                  {inEntRows.map((row, idx) => {
                    const amt = parseFloat(row.amountMyr)||0;
                    return (
                      <div key={row.id} className="rounded-lg border border-border bg-card overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                          <span className="text-xs font-semibold">Item {idx+1}</span>
                          <div className="flex items-center gap-2">
                            {amt > 0 && <span className="text-xs font-bold text-green-700 dark:text-green-400">{fmtAmount(amt)}</span>}
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setInEntRows(p => p.filter(r => r.id!==row.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                          </div>
                        </div>
                        <div className="p-4 flex flex-col gap-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Date</span>
                              <input type="date" value={row.lineDate} onChange={e => updateInEnt(row.id,"lineDate",e.target.value)} className={inputCls}/>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Venue / Restaurant</span>
                              <input type="text" placeholder="e.g. Restoran Nasi Kandar" value={row.venue} onChange={e => updateInEnt(row.id,"venue",e.target.value)} className={inputCls}/>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Purpose / Description</span>
                            <input type="text" placeholder="e.g. Team lunch, client discussion" value={row.description} onChange={e => updateInEnt(row.id,"description",e.target.value)} className={inputCls}/>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Amount</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">RM</span>
                                <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.amountMyr} onChange={e => updateInEnt(row.id,"amountMyr",e.target.value)} className={inputCls+" w-28"}/>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Receipt <span className="text-destructive">*</span></span>
                              <ReceiptPicker row={row} setter={setInEntRows}/>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setInEntRows(p => [...p,emptyInEnt()])}><PlusIcon className="h-3.5 w-3.5"/>Add Item</Button>
              </Section>

              {/* 1.4 Other Expenses */}
              <Section title="1.4  Other Expenses" badge={otherTotal > 0 ? fmtAmount(otherTotal) : undefined}>
                <div className="flex flex-col gap-4">
                  {otherRows.map((row, idx) => {
                    const amt = parseFloat(row.amountMyr)||0;
                    return (
                      <div key={row.id} className="rounded-lg border border-border bg-card overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                          <span className="text-xs font-semibold">Item {idx+1}</span>
                          <div className="flex items-center gap-2">
                            {amt > 0 && <span className="text-xs font-bold text-green-700 dark:text-green-400">{fmtAmount(amt)}</span>}
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setOtherRows(p => p.filter(r => r.id!==row.id))}><XIcon className="h-3.5 w-3.5"/></Button>
                          </div>
                        </div>
                        <div className="p-4 flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Date</span>
                            <input type="date" value={row.lineDate} onChange={e => updateOther(row.id,"lineDate",e.target.value)} className={inputCls+" w-40"}/>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Description</span>
                            <input type="text" placeholder="e.g. CME conference fee, medical, gift, spare parts…" value={row.description} onChange={e => updateOther(row.id,"description",e.target.value)} className={inputCls}/>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Amount</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">RM</span>
                                <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.amountMyr} onChange={e => updateOther(row.id,"amountMyr",e.target.value)} className={inputCls+" w-28"}/>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">Receipt <span className="text-destructive">*</span></span>
                              <ReceiptPicker row={row} setter={setOtherRows}/>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setOtherRows(p => [...p,emptyOther()])}><PlusIcon className="h-3.5 w-3.5"/>Add Item</Button>
              </Section>

              {/* 1.5 Outstation Hotel */}

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
