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
  ClaimApplicationWithDetails, ClaimTypeRow, ClaimLineItemWithMeta, ClaimDocumentRow,
  ClaimLineItemInput, ClaimEntertainmentDetailInput, ClaimCustomerOption,
} from "@/server/claim";
import {
  deleteClaim, submitClaim, saveDraftClaim, updateDraftClaim,
  finalizeDraftClaim, resubmitRejectedClaim, createClaimDocumentRecord, deleteClaimDocument,
} from "@/server/claim";
import type { TravelFormWithDetails } from "@/server/travel-form";
import { getMyApprovedUnclaimedTravelForms } from "@/server/travel-form";
import { formatTravelItinerary, travelLegLabel, travelPurposesSummary } from "@/lib/travel/itinerary";
import { CLAIM_FORM, LINE_CATEGORY, TRAVEL_MODE, TRAVEL_MODE_LABELS } from "@/lib/claim/constants";
import { uid } from "@/lib/uid";
import {
  PlusIcon, FileDownIcon, XIcon, ReceiptIcon,
  AlertTriangleIcon, UploadIcon, InfoIcon, ArrowRightIcon, MapPinIcon, LoaderIcon, RouteIcon,
  EyeIcon, TrashIcon, PrinterIcon,
} from "lucide-react";
import { EditBadge, SlashBadge } from "@/components/claim/line-item-annotations";

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
  existingFlightFileName?: string; // receipt already attached from a prior submission
  resolvedFrom?: string; resolvedTo?: string; // display names from geocoding
  travelFormId?: string;  // pre-filled from an approved travel form
  travelFormNo?: string;  // that form's application no., for the "Linked: TF-…" badge
  // Daily allowance (meal)
  dailyId:string; breakfastDays:string; lunchDays:string; dinnerDays:string;
  // Accommodation
  accomId:string; accomAmount:string; accomFile?:File; existingAccomFileName?: string;
  // Travel entertainment
  tEntId:string; tEntAmount:string; tEntFile?:File; existingTEntFileName?: string;
}
interface MiscRow     { id:string; subType:"TOLL"|"PARKING"|"MOBILE"; lineDate:string; description:string; amountMyr:string; file?:File; existingFileName?:string }
interface InEntRow    { id:string; lineDate:string; venue:string; description:string; amountMyr:string; file?:File; existingFileName?:string }
interface OtherLocalRow { id:string; lineDate:string; description:string; amountMyr:string; file?:File; existingFileName?:string }

interface OvMyrRow    { id:string; lineDate:string; destination:string; description:string; amountMyr:string }
interface OvFxRow     { id:string; lineDate:string; destination:string; currency:string; amountForeign:string; exchangeRate:string }
interface OvOtherRow  { id:string; lineDate:string; description:string; amountMyr:string }
interface QueuedFile  { file:File; id:string }

const newId = () => uid();
const emptyTravel = (lineDate = ""): TravelRow => ({
  id:newId(), lineDate, fromLocation:"", toLocation:"", distanceKm:"", mode:"", purpose:"",
  dailyId:newId(), breakfastDays:"", lunchDays:"", dinnerDays:"",
  accomId:newId(), accomAmount:"", accomFile:undefined,
  tEntId:newId(), tEntAmount:"", tEntFile:undefined,
});
const emptyMisc     = (lineDate = ""): MiscRow       => ({ id:newId(), subType:"TOLL", lineDate, description:"", amountMyr:"" });
const emptyInEnt    = (lineDate = ""): InEntRow      => ({ id:newId(), lineDate, venue:"", description:"", amountMyr:"" });
const emptyOther    = (lineDate = ""): OtherLocalRow => ({ id:newId(), lineDate, description:"", amountMyr:"" });

// ── Form reconstruction from existing claim ───────────────────────────────────

// Restores a best-effort `mode` for a reloaded travel row: `mode` isn't a
// stored column, only ever inferred from the description text at submit
// time (see the `TRAVEL_MODE_LABELS[r.mode]` fallback in handleSubmit), so
// this exactly reverses that encoding when possible.
function inferTravelMode(description: string | null, distanceKm: string | null): { mode: string; purpose: string } {
  const desc = (description ?? "").trim();
  const labelMatch = Object.entries(TRAVEL_MODE_LABELS).find(([, label]) => label === desc);
  if (labelMatch) return { mode: labelMatch[0], purpose: "" };
  if (distanceKm && parseFloat(distanceKm) > 0) return { mode: TRAVEL_MODE.OWN_VEHICLE, purpose: desc };
  return { mode: "", purpose: desc };
}

function lineItemsToTravelRows(items: ClaimLineItemWithMeta[], docsByLineItemId?: Map<string, ClaimDocumentRow>): TravelRow[] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const rows: TravelRow[] = [];
  let current: TravelRow | null = null;
  for (const item of sorted) {
    if (item.category === LINE_CATEGORY.TRAVEL) {
      if (current) rows.push(current);
      const { mode, purpose } = inferTravelMode(item.description, item.distanceKm);
      current = {
        id: item.id, lineDate: item.lineDate,
        fromLocation: item.fromLocation ?? "", toLocation: item.toLocation ?? "",
        distanceKm: item.distanceKm ?? "", mode, purpose,
        existingFlightFileName: docsByLineItemId?.get(item.id)?.fileName,
        travelFormId: item.travelFormId ?? undefined,
        travelFormNo: item.travelFormNo ?? undefined,
        dailyId: newId(), breakfastDays: "", lunchDays: "", dinnerDays: "",
        accomId: newId(), accomAmount: "",
        tEntId: newId(), tEntAmount: "",
      };
    } else if (current && item.category === LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE) {
      current.dailyId = item.id;
      const bf = item.description?.match(/Breakfast ×(\d+(?:\.\d+)?)d/);
      const ln = item.description?.match(/Lunch ×(\d+(?:\.\d+)?)d/);
      const dn = item.description?.match(/Dinner ×(\d+(?:\.\d+)?)d/);
      if (bf) current.breakfastDays = bf[1];
      if (ln) current.lunchDays = ln[1];
      if (dn) current.dinnerDays = dn[1];
    } else if (current && item.category === LINE_CATEGORY.TRAVEL_ACCOMMODATION) {
      current.accomId = item.id;
      current.accomAmount = item.amountMyr;
      current.existingAccomFileName = docsByLineItemId?.get(item.id)?.fileName;
    } else if (current && item.category === LINE_CATEGORY.TRAVEL_ENTERTAINMENT) {
      current.tEntId = item.id;
      current.tEntAmount = item.amountMyr;
      current.existingTEntFileName = docsByLineItemId?.get(item.id)?.fileName;
    }
  }
  if (current) rows.push(current);
  return rows.length > 0 ? rows : [emptyTravel()];
}

function buildFormRows(items: ClaimLineItemWithMeta[], docsByLineItemId?: Map<string, ClaimDocumentRow>) {
  const travelCats = new Set<string>([
    LINE_CATEGORY.TRAVEL, LINE_CATEGORY.TRAVEL_ACCOMMODATION,
    LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE, LINE_CATEGORY.TRAVEL_ENTERTAINMENT,
  ]);
  const travelItems = items.filter(i => travelCats.has(i.category as string));
  const travelRows  = lineItemsToTravelRows(travelItems, docsByLineItemId);
  const miscRows: MiscRow[] = items
    .filter(i => i.category === LINE_CATEGORY.TOLL || i.category === LINE_CATEGORY.PARKING || i.category === LINE_CATEGORY.MOBILE)
    .map(i => ({ id: i.id, subType: i.category as "TOLL"|"PARKING"|"MOBILE", lineDate: i.lineDate, description: i.description ?? "", amountMyr: i.amountMyr, existingFileName: docsByLineItemId?.get(i.id)?.fileName }));
  const inEntRows: InEntRow[] = items
    .filter(i => i.category === LINE_CATEGORY.IN_BASE_ENT)
    .map(i => ({ id: i.id, lineDate: i.lineDate, venue: i.venue ?? "", description: i.description ?? "", amountMyr: i.amountMyr, existingFileName: docsByLineItemId?.get(i.id)?.fileName }));
  const otherRows: OtherLocalRow[] = items
    .filter(i => i.category === LINE_CATEGORY.OTHER_LOCAL)
    .map(i => ({ id: i.id, lineDate: i.lineDate, description: i.description ?? "", amountMyr: i.amountMyr, existingFileName: docsByLineItemId?.get(i.id)?.fileName }));
  const ovMyrRows: OvMyrRow[] = items
    .filter(i => i.category === LINE_CATEGORY.OVERSEAS_MYR)
    .map(i => ({ id: i.id, lineDate: i.lineDate, destination: i.destination ?? "", description: i.description ?? "", amountMyr: i.amountMyr }));
  const ovFxRows: OvFxRow[] = items
    .filter(i => i.category === LINE_CATEGORY.OVERSEAS_FX)
    .map(i => ({ id: i.id, lineDate: i.lineDate, destination: i.destination ?? "", currency: i.currency ?? "USD", amountForeign: i.amountForeign ?? "", exchangeRate: i.exchangeRate ?? "" }));
  const ovOtherRows: OvOtherRow[] = items
    .filter(i => i.category === LINE_CATEGORY.OVERSEAS_OTHER)
    .map(i => ({ id: i.id, lineDate: i.lineDate, description: i.description ?? "", amountMyr: i.amountMyr }));
  return { travelRows, miscRows, inEntRows, otherRows, ovMyrRows, ovFxRows, ovOtherRows };
}

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

function TravelSubFilePicker({ file, existingFileName, onPick, onRemove, uploading }: { file?: File; existingFileName?: string; onPick:(f:File)=>void; onRemove:()=>void; uploading?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1 shrink-0">
      <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden"
        onChange={e => { const f = pickReceiptFile(e); if (f) onPick(f); }}/>
      {uploading ? (
        <div className="flex items-center gap-1 rounded border border-blue-300 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5">
          <LoaderIcon className="h-3 w-3 animate-spin text-blue-500 shrink-0"/>
          <span className="text-xs text-blue-600 dark:text-blue-400">Uploading…</span>
        </div>
      ) : file ? (
        <div className="flex items-center gap-1 rounded border border-green-500/40 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 max-w-30">
          <span className="text-xs text-green-700 dark:text-green-400 truncate" title={file.name}>{file.name}</span>
          <button type="button" onClick={onRemove} className="text-green-600 hover:text-destructive shrink-0"><XIcon className="h-3 w-3"/></button>
        </div>
      ) : existingFileName ? (
        <div className="flex items-center gap-1 rounded border border-blue-400/40 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 max-w-30" title="Already attached from before">
          <span className="text-xs text-blue-700 dark:text-blue-400 truncate" title={existingFileName}>{existingFileName}</span>
          <button type="button" onClick={onRemove} className="text-blue-600 hover:text-destructive shrink-0"><XIcon className="h-3 w-3"/></button>
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

function ReceiptPicker<T extends { id: string; file?: File; existingFileName?: string }>({
  row, setter, afterPick, afterRemove, uploading,
}: {
  row: T;
  setter: React.Dispatch<React.SetStateAction<T[]>>;
  afterPick?: (f: File) => void;
  afterRemove?: () => void;
  uploading?: boolean;
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
          if (f) { setter(prev => prev.map(r => r.id === row.id ? { ...r, file: f } : r)); afterPick?.(f); }
        }}
      />
      {uploading ? (
        <div className="flex items-center gap-1 rounded border border-blue-300 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5">
          <LoaderIcon className="h-3 w-3 animate-spin text-blue-500 shrink-0"/>
          <span className="text-xs text-blue-600 dark:text-blue-400">Uploading…</span>
        </div>
      ) : row.file ? (
        <div className="flex items-center gap-1 rounded border border-green-500/40 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 max-w-30">
          <span className="text-xs text-green-700 dark:text-green-400 truncate" title={row.file.name}>{row.file.name}</span>
          <button type="button" onClick={() => { afterRemove?.(); setter(prev => prev.map(r => r.id === row.id ? { ...r, file: undefined } : r)); }} className="text-green-600 hover:text-destructive shrink-0">
            <XIcon className="h-3 w-3"/>
          </button>
        </div>
      ) : row.existingFileName ? (
        <div className="flex items-center gap-1 rounded border border-blue-400/40 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 max-w-30" title="Already attached from before">
          <span className="text-xs text-blue-700 dark:text-blue-400 truncate" title={row.existingFileName}>{row.existingFileName}</span>
          <button type="button" onClick={() => { afterRemove?.(); setter(prev => prev.map(r => r.id === row.id ? { ...r, existingFileName: undefined } : r)); }} className="text-blue-600 hover:text-destructive shrink-0">
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

const emptyOvMyr    = (lineDate = ""): OvMyrRow      => ({ id:newId(), lineDate, destination:"", description:"", amountMyr:"" });
const emptyOvFx     = (lineDate = ""): OvFxRow       => ({ id:newId(), lineDate, destination:"", currency:"USD", amountForeign:"", exchangeRate:"" });
const emptyOvOther  = (lineDate = ""): OvOtherRow    => ({ id:newId(), lineDate, description:"", amountMyr:"" });

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

// Sensible default for a new line item's date: the last day of the selected
// claim period, so a freshly-added row isn't blocked on submit for a date
// the user simply hasn't noticed yet.
function lastDayOfPeriod(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return "";
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

function fxMyr(fc: string, rate: string): number {
  const f = parseFloat(fc); const r = parseFloat(rate);
  return (isNaN(f) || isNaN(r) || f <= 0 || r <= 0) ? 0 : parseFloat((f * r).toFixed(2));
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string,string> = {
    DRAFT:     "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-600",
    PENDING:   "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
    CHECKED:   "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700",
    APPROVED:  "bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700",
    REJECTED:  "bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700",
    CANCELLED: "bg-muted text-muted-foreground border-border hover:bg-muted",
  };
  const labels: Record<string,string> = { DRAFT:"Draft", PENDING:"Pending", CHECKED:"Checked", APPROVED:"Approved", REJECTED:"Rejected", CANCELLED:"Cancelled" };
  return <Badge className={`border text-xs ${map[status] ?? "border-border"}`}>{labels[status] ?? status}</Badge>;
}

// ── Checker review changes (read-only) ──────────────────────────────────────

const READ_ONLY_SECTION_LABELS: Record<string, string> = {
  [LINE_CATEGORY.TRAVEL]:                "1.1 Travel Expenses",
  [LINE_CATEGORY.TRAVEL_ACCOMMODATION]:  "1.1.1 Accommodation",
  [LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE]:"1.1.2 Daily Allowance",
  [LINE_CATEGORY.TRAVEL_ENTERTAINMENT]:  "1.1.3 Travel Entertainment",
  [LINE_CATEGORY.TOLL]:                  "1.2.1 Toll / Touch N Go",
  [LINE_CATEGORY.PARKING]:               "1.2.2 Parking",
  [LINE_CATEGORY.MOBILE]:                "1.2.3 Mobile Phone",
  [LINE_CATEGORY.IN_BASE_ENT]:           "1.3 In-Base Entertainment",
  [LINE_CATEGORY.OTHER_LOCAL]:           "1.4 Other Expenses",
  [LINE_CATEGORY.OVERSEAS_MYR]:          "2.1 Travel (MYR)",
  [LINE_CATEGORY.OVERSEAS_FX]:           "2.2 Travel (Foreign Currency)",
  [LINE_CATEGORY.OVERSEAS_OTHER]:        "2.3 Other Expenses",
};

function hasReviewChanges(app: ClaimApplicationWithDetails): boolean {
  return app.lineItems.some(li => li.editedBy || li.slashed) || app.entertainmentDetails.some(ed => ed.editedBy || ed.slashed);
}

// Read-only view of a claim's line items / entertainment rows, including any
// checker edits/slashes — visible regardless of the claim's current status.
function ClaimReadOnlyDetail({ app }: { app: ClaimApplicationWithDetails }) {
  const lineGroups: Record<string, typeof app.lineItems> = {};
  for (const item of app.lineItems) {
    if (!lineGroups[item.category]) lineGroups[item.category] = [];
    lineGroups[item.category].push(item);
  }
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Ref No.</span>
          <span className="font-mono text-xs font-medium">{app.applicationNo}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Claim type</span>
          <span className="font-medium">{app.claimTypeName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Amount</span>
          <span className="font-bold text-green-700 dark:text-green-400">{fmtAmount(app.amount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Status</span>
          <StatusBadge status={app.status}/>
        </div>
        {app.description && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Note</span>
            <span className="text-right text-xs">{app.description}</span>
          </div>
        )}
      </div>

      {app.status === "REJECTED" && (app.reviewComment || app.checkerComment) && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <span className="font-semibold">Rejection reason: </span>
          {app.checkerComment || app.reviewComment}
        </div>
      )}
      {app.status === "APPROVED" && app.reviewComment && (
        <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-700 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          <span className="font-semibold">Approver comment: </span>
          {app.reviewComment}
        </div>
      )}

      {app.lineItems.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          {Object.entries(lineGroups).map(([cat, rows]) => {
            const subtotal = rows.reduce((s, r) => s + (r.slashed ? 0 : parseFloat(r.amountMyr)), 0);
            return (
              <div key={cat}>
                <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">{READ_ONLY_SECTION_LABELS[cat] ?? cat}</span>
                  <span className="text-xs font-semibold">{fmtAmount(subtotal)}</span>
                </div>
                <div className="divide-y divide-border">
                  {rows.map((item, i) => {
                    const arCls = item.slashed ? "line-through opacity-50" : "";
                    return (
                      <div key={item.id} className="px-3 py-2.5 flex flex-col gap-1 text-xs">
                        <div className="flex items-start gap-2">
                          <span className="text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                          <div className={`flex-1 flex flex-col gap-0.5 min-w-0 ${arCls}`}>
                            {item.category === LINE_CATEGORY.TRAVEL ? (
                              <div className="flex items-center gap-1 text-foreground font-medium">
                                <MapPinIcon className="h-3 w-3 text-muted-foreground shrink-0"/>
                                <span className="truncate">{item.fromLocation}</span>
                                <ArrowRightIcon className="h-3 w-3 text-muted-foreground shrink-0"/>
                                <span className="truncate">{item.toLocation}</span>
                              </div>
                            ) : item.category === LINE_CATEGORY.OVERSEAS_FX ? (
                              <div className="text-foreground font-medium">
                                {item.destination && <span className="mr-1">{item.destination}</span>}
                                <span className="text-muted-foreground">{item.amountForeign} {item.currency} × {item.exchangeRate}</span>
                              </div>
                            ) : (
                              <span className="text-foreground font-medium truncate">
                                {item.venue
                                  ? `${item.venue}${item.description ? ` — ${item.description}` : ""}`
                                  : item.destination
                                    ? `${item.destination}${item.description ? ` — ${item.description}` : ""}`
                                    : item.description}
                              </span>
                            )}
                            <span className="text-muted-foreground">{item.lineDate}</span>
                          </div>
                          <span className={`text-green-700 dark:text-green-400 font-medium shrink-0 ${arCls}`}>{fmtAmount(item.amountMyr)}</span>
                        </div>
                        {item.slashed && (
                          <div className="pl-6">
                            <SlashBadge slashedByName={item.slashedByName} slashedAt={item.slashedAt} slashReason={item.slashReason}/>
                          </div>
                        )}
                        {item.editedBy && (
                          <div className="pl-6">
                            <EditBadge
                              editedByName={item.editedByName}
                              editedAt={item.editedAt}
                              editReason={item.editReason}
                              amountChange={item.originalAmountMyr ? { from: item.originalAmountMyr, to: item.amountMyr } : null}
                              descriptionChange={item.originalDescription !== null ? { from: item.originalDescription, to: item.description } : null}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="px-3 py-2 border-t-2 border-border bg-muted/20 flex items-center justify-between">
            <span className="text-xs font-semibold">
              Items Total
              {app.lineItems.some((r) => r.slashed) && <span className="text-muted-foreground font-normal"> (excludes slashed)</span>}
            </span>
            <span className="text-sm font-bold text-green-700 dark:text-green-400">
              {fmtAmount(app.lineItems.reduce((s, r) => s + (r.slashed ? 0 : parseFloat(r.amountMyr)), 0))}
            </span>
          </div>
        </div>
      )}

      {app.entertainmentDetails.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden text-sm">
          <div className="px-3 py-2 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground">
            Entertainment Details ({app.entertainmentDetails.length})
          </div>
          {app.entertainmentDetails.map((ed, idx) => {
            const arCls = ed.slashed ? "line-through opacity-50" : "";
            return (
              <div key={ed.id} className="divide-y divide-border border-t border-border first:border-t-0">
                {app.entertainmentDetails.length > 1 && (
                  <div className="px-3 py-1.5 bg-muted/20 text-[10px] font-semibold text-muted-foreground uppercase">Entry {idx + 1}</div>
                )}
                {[
                  ["Date", ed.eventDate],
                  ["Restaurant / Venue", ed.restaurantName],
                  ["Customer", ed.customerName],
                  ["Dept & Org", ed.departmentOrganization],
                  ["Purpose", ed.purpose],
                  ["Amount", fmtAmount(ed.amount)],
                ].map(([label, value]) => (
                  <div key={label} className={`px-3 py-2 flex justify-between gap-4 ${arCls}`}>
                    <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
                    <span className="text-right text-xs font-medium">{value}</span>
                  </div>
                ))}
                {ed.slashed && (
                  <div className="px-3 py-2">
                    <SlashBadge slashedByName={ed.slashedByName} slashedAt={ed.slashedAt} slashReason={ed.slashReason}/>
                  </div>
                )}
                {ed.editedBy && (
                  <div className="px-3 py-2">
                    <EditBadge
                      editedByName={ed.editedByName}
                      editedAt={ed.editedAt}
                      editReason={ed.editReason}
                      amountChange={ed.originalAmount ? { from: ed.originalAmount, to: ed.amount } : null}
                      descriptionChange={ed.originalPurpose !== null ? { from: ed.originalPurpose, to: ed.purpose } : null}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {app.entertainmentDetails.length > 1 && (
            <div className="px-3 py-2 border-t-2 border-border bg-muted/20 flex items-center justify-between">
              <span className="text-xs font-semibold">
                Entries Total
                {app.entertainmentDetails.some((ed) => ed.slashed) && <span className="text-muted-foreground font-normal"> (excludes slashed)</span>}
              </span>
              <span className="text-sm font-bold text-green-700 dark:text-green-400">
                {fmtAmount(app.entertainmentDetails.reduce((s, ed) => s + (ed.slashed ? 0 : parseFloat(ed.amount)), 0))}
              </span>
            </div>
          )}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Receipts & Documents ({app.documents.length})
        </p>
        {app.documents.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No documents attached.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {app.documents.map(doc => (
              <a
                key={doc.id}
                href={`/api/claim/download/${doc.fileKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted/50 transition-colors group"
              >
                <FileDownIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary"/>
                <span className="flex-1 truncate text-foreground font-medium">{doc.fileName}</span>
                <span className="text-blue-600 dark:text-blue-400 shrink-0 font-medium">Download</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
  customers: ClaimCustomerOption[];
}

type EntRow = {
  id: string;
  eventDate: string;
  restaurantName: string;
  customerName: string;
  departmentOrganization: string;
  purpose: string;
  amount: string;
  custSearch: string;
};

function emptyEntRow(eventDate = ""): EntRow {
  return { id: Math.random().toString(36).slice(2), eventDate, restaurantName: "", customerName: "", departmentOrganization: "", purpose: "", amount: "", custSearch: "" };
}

export function MyClaimClient({ applications, claimTypes, permissions, customers }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Action states ────────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [viewDocsApp, setViewDocsApp] = useState<ClaimApplicationWithDetails | null>(null);
  const [viewClaimTarget, setViewClaimTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [editingApp, setEditingApp] = useState<ClaimApplicationWithDetails | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  // Tracks files already uploaded to R2 (key → {docId, fileKey}) so we skip re-upload on submit
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, { docId: string; fileKey: string }>>({});
  // Tracks which field keys are currently uploading
  const [uploadingFields, setUploadingFields] = useState<Set<string>>(new Set());

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

  // Approved, not-yet-claimed travel forms available to pre-fill a trip row
  const [travelFormPickerOpen, setTravelFormPickerOpen] = useState(false);
  const [availableTravelForms, setAvailableTravelForms] = useState<TravelFormWithDetails[]>([]);
  const [loadingTravelForms, setLoadingTravelForms] = useState(false);

  // OVERSEAS
  const [ovMyrRows,   setOvMyrRows]   = useState<OvMyrRow[]>([]);
  const [ovFxRows,    setOvFxRows]    = useState<OvFxRow[]>([]);
  const [ovOtherRows, setOvOtherRows] = useState<OvOtherRow[]>([]);

  // ENTERTAINMENT_FORM — multiple rows
  const [entRows, setEntRows] = useState<EntRow[]>([emptyEntRow()]);

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
  function tripTotalOf(row: TravelRow) {
    const km = parseFloat(row.distanceKm);
    const mileageAmt = (isNaN(km)||km<=0) ? 0 : km*ratePerKm;
    const dailyAmt = (parseFloat(row.breakfastDays)||0)*mealBreakfastRate + (parseFloat(row.lunchDays)||0)*mealLunchRate + (parseFloat(row.dinnerDays)||0)*mealDinnerRate;
    const accomAmt = parseFloat(row.accomAmount)||0;
    const tEntAmt = parseFloat(row.tEntAmount)||0;
    return mileageAmt+dailyAmt+accomAmt+tEntAmt;
  }

  // Shared body for one trip/leg's editable fields — used by both standalone
  // Trip cards and legs nested inside a grouped Itinerary card.
  function travelDetailFields(row: TravelRow) {
    const km         = parseFloat(row.distanceKm);
    const mileageAmt = (isNaN(km)||km<=0) ? 0 : km*ratePerKm;
    const bfDays = parseFloat(row.breakfastDays)||0;
    const lnDays = parseFloat(row.lunchDays)||0;
    const dnDays = parseFloat(row.dinnerDays)||0;
    const dailyAmt   = bfDays*mealBreakfastRate + lnDays*mealLunchRate + dnDays*mealDinnerRate;
    const accomAmt   = parseFloat(row.accomAmount)||0;
    const tEntAmt    = parseFloat(row.tEntAmount)||0;
    const showMileage = row.mode !== TRAVEL_MODE.FLIGHT && row.mode !== TRAVEL_MODE.COMPANY_CAR;
    const labelCls = "text-xs text-muted-foreground w-32 shrink-0 pt-1.5";
    return (
      <>
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
                existingFileName={row.existingFlightFileName}
                onPick={f => { void setTravelFile(row.id,"flightFile",f); }}
                onRemove={() => { void setTravelFile(row.id,"flightFile",undefined); }}
                uploading={uploadingFields.has(`flightFile:${row.id}`)}
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
                <div className="flex items-center gap-1.5 flex-wrap">
                  {mealBreakfastRate > 0 && (
                    <Button
                      type="button"
                      size="xs"
                      variant={bfDays > 0 ? "default" : "outline"}
                      onClick={() => updateTravel(row.id,"breakfastDays", bfDays > 0 ? "" : "1")}
                    >
                      Breakfast <span className="opacity-70">RM{mealBreakfastRate.toFixed(2)}</span>
                    </Button>
                  )}
                  {mealLunchRate > 0 && (
                    <Button
                      type="button"
                      size="xs"
                      variant={lnDays > 0 ? "default" : "outline"}
                      onClick={() => updateTravel(row.id,"lunchDays", lnDays > 0 ? "" : "1")}
                    >
                      Lunch <span className="opacity-70">RM{mealLunchRate.toFixed(2)}</span>
                    </Button>
                  )}
                  {mealDinnerRate > 0 && (
                    <Button
                      type="button"
                      size="xs"
                      variant={dnDays > 0 ? "default" : "outline"}
                      onClick={() => updateTravel(row.id,"dinnerDays", dnDays > 0 ? "" : "1")}
                    >
                      Dinner <span className="opacity-70">RM{mealDinnerRate.toFixed(2)}</span>
                    </Button>
                  )}
                </div>
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
            <TravelSubFilePicker file={row.accomFile} existingFileName={row.existingAccomFileName} onPick={f => { void setTravelFile(row.id,"accomFile",f); }} onRemove={() => { void setTravelFile(row.id,"accomFile",undefined); }} uploading={uploadingFields.has(`accomFile:${row.id}`)}/>
            {accomAmt > 0 && !row.accomFile && !row.existingAccomFileName && <span className="text-xs text-destructive ml-auto">Receipt required <span aria-hidden>*</span></span>}
            {accomAmt > 0 && (row.accomFile || row.existingAccomFileName) && <span className="text-xs font-medium text-green-700 dark:text-green-400 ml-auto">{fmtAmount(accomAmt)}</span>}
          </div>

          {/* Travel entertainment */}
          <div className="flex items-center gap-3 py-2">
            <span className={labelCls}>Entertainment</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">RM</span>
              <input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.tEntAmount} onChange={e => updateTravel(row.id,"tEntAmount",e.target.value)} className={inputCls+" w-28"}/>
            </div>
            <TravelSubFilePicker file={row.tEntFile} existingFileName={row.existingTEntFileName} onPick={f => { void setTravelFile(row.id,"tEntFile",f); }} onRemove={() => { void setTravelFile(row.id,"tEntFile",undefined); }} uploading={uploadingFields.has(`tEntFile:${row.id}`)}/>
            {tEntAmt > 0 && !row.tEntFile && !row.existingTEntFileName && <span className="text-xs text-destructive ml-auto">Receipt required <span aria-hidden>*</span></span>}
            {tEntAmt > 0 && (row.tEntFile || row.existingTEntFileName) && <span className="text-xs font-medium text-green-700 dark:text-green-400 ml-auto">{fmtAmount(tEntAmt)}</span>}
          </div>
        </div>
      </>
    );
  }

  // Trip rows pulled from the same travel form are grouped into one
  // Itinerary card; manually-added or unlinked rows each stay standalone.
  interface TravelGroup { key: string; travelFormId?: string; travelFormNo?: string; rows: TravelRow[] }
  const travelGroups: TravelGroup[] = (() => {
    const groups: TravelGroup[] = [];
    const byFormId = new Map<string, TravelGroup>();
    for (const row of travelRows) {
      if (row.travelFormId) {
        let g = byFormId.get(row.travelFormId);
        if (!g) {
          g = { key: `form-${row.travelFormId}`, travelFormId: row.travelFormId, travelFormNo: row.travelFormNo, rows: [] };
          byFormId.set(row.travelFormId, g);
          groups.push(g);
        }
        g.rows.push(row);
      } else {
        groups.push({ key: row.id, rows: [row] });
      }
    }
    // Itineraries imported from a travel form show above manually-added/empty trips.
    return groups.sort((a, b) => (a.travelFormId ? 0 : 1) - (b.travelFormId ? 0 : 1));
  })();

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
    setEditingApp(null);
    setSelectedTypeId(""); setClaimPeriod(""); setNote(""); setQueuedFiles([]);
    setTravelRows([emptyTravel()]); setMiscRows([]); setInEntRows([]); setOtherRows([]);
    setOvMyrRows([]); setOvFxRows([]); setOvOtherRows([]);
    setEntRows([emptyEntRow()]);
    setUploadedFiles({});
    setUploadingFields(new Set());
  }

  // Upload one file to R2 immediately and record it in DB + local state
  async function uploadOneFile(file: File, appId: string, fieldKey: string, lineItemId?: string) {
    setUploadingFields(prev => new Set(prev).add(fieldKey));
    try {
      const res = await fetch("/api/claim/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId, fileName: file.name, mimeType: file.type, fileSize: file.size }) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ? `${file.name}: ${body.error}` : `Could not prepare upload for ${file.name} (HTTP ${res.status})`);
      }
      const { uploadUrl, key } = await res.json();
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`Upload to storage failed for ${file.name} (HTTP ${put.status}) — the upload link may have expired, try again`);
      const doc = await createClaimDocumentRecord({ applicationId: appId, lineItemId, fileName: file.name, fileKey: key, fileSize: file.size, mimeType: file.type });
      setUploadedFiles(prev => ({ ...prev, [fieldKey]: { docId: doc.id, fileKey: key } }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Upload failed for ${file.name}`);
    } finally {
      setUploadingFields(prev => { const s = new Set(prev); s.delete(fieldKey); return s; });
    }
  }

  // Delete a previously-uploaded file from R2 + DB
  async function removeOneUpload(fieldKey: string) {
    const uploaded = uploadedFiles[fieldKey];
    if (!uploaded) return;
    try {
      await deleteClaimDocument(uploaded.docId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove the attached file — it may still be attached");
      return; // keep local state so the user knows removal did not actually succeed
    }
    setUploadedFiles(prev => { const n = { ...prev }; delete n[fieldKey]; return n; });
  }

  // Removes a document straight from the "Currently Attached Documents" list
  // in the edit form — the self-service way to clean up a stray/orphaned
  // receipt (e.g. one left behind by an incomplete row that never made it
  // into a line item) without needing DB access.
  async function handleDeleteDocument(docId: string) {
    setDeletingDocId(docId);
    try {
      await deleteClaimDocument(docId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove document");
      setDeletingDocId(null);
      return;
    }
    setEditingApp(prev => prev ? { ...prev, documents: prev.documents.filter(d => d.id !== docId) } : prev);
    const fieldKey = Object.entries(uploadedFiles).find(([, v]) => v.docId === docId)?.[0];
    if (fieldKey) {
      setUploadedFiles(prev => { const n = { ...prev }; delete n[fieldKey]; return n; });
      const [field, rowId] = fieldKey.split(":");
      if (field === "flightFile") setTravelRows(prev => prev.map(r => r.id === rowId ? { ...r, existingFlightFileName: undefined } : r));
      else if (field === "accomFile") setTravelRows(prev => prev.map(r => r.id === rowId ? { ...r, existingAccomFileName: undefined } : r));
      else if (field === "tEntFile") setTravelRows(prev => prev.map(r => r.id === rowId ? { ...r, existingTEntFileName: undefined } : r));
      else if (field === "misc") setMiscRows(prev => prev.map(r => r.id === rowId ? { ...r, existingFileName: undefined } : r));
      else if (field === "inent") setInEntRows(prev => prev.map(r => r.id === rowId ? { ...r, existingFileName: undefined } : r));
      else if (field === "other") setOtherRows(prev => prev.map(r => r.id === rowId ? { ...r, existingFileName: undefined } : r));
    }
    toast.success("Document removed");
    setDeletingDocId(null);
  }

  // Downloads a claim's PDF, surfacing the server's actual error text on failure
  // instead of leaving the user with a blank tab or a silent failed download.
  async function handleDownloadPdf(appId: string, applicationNo: string) {
    setDownloadingPdfId(appId);
    try {
      const res = await fetch(`/api/claim/${appId}/pdf`);
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).trim();
        throw new Error(text || `Failed to download PDF (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Claim-${applicationNo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download PDF");
    } finally {
      setDownloadingPdfId(null);
    }
  }

  function loadAppIntoForm(app: ClaimApplicationWithDetails) {
    setEditingApp(app);
    setSelectedTypeId(app.claimTypeId);
    const periodMatch = app.claimDate.match(/^(\d{4}-\d{2})-\d{2}$/);
    setClaimPeriod(periodMatch ? periodMatch[1] : "");
    // "Draft" is the server's placeholder description for an unfinished draft
    // (server/claim.ts: `description: data.description.trim() || "Draft"`) —
    // only strip it while the claim is still a DRAFT. A REJECTED claim's
    // description was always genuine submitted content, even if it happens
    // to literally read "Draft".
    setNote(app.status === "DRAFT" && app.description === "Draft" ? "" : app.description);
    setQueuedFiles([]);
    setUploadingFields(new Set());
    if (app.entertainmentDetails && app.entertainmentDetails.length > 0) {
      setUploadedFiles({});
      setEntRows(app.entertainmentDetails.map(ed => ({
        id: Math.random().toString(36).slice(2),
        eventDate: ed.eventDate,
        restaurantName: ed.restaurantName,
        customerName: ed.customerName,
        departmentOrganization: ed.departmentOrganization,
        purpose: ed.purpose,
        amount: ed.amount,
        custSearch: "",
      })));
      setTravelRows([emptyTravel()]); setMiscRows([]); setInEntRows([]); setOtherRows([]);
      setOvMyrRows([]); setOvFxRows([]); setOvOtherRows([]);
    } else {
      const docsByLineItemId = new Map<string, ClaimDocumentRow>();
      for (const doc of app.documents) if (doc.lineItemId) docsByLineItemId.set(doc.lineItemId, doc);
      const { travelRows, miscRows, inEntRows, otherRows, ovMyrRows, ovFxRows, ovOtherRows } = buildFormRows(app.lineItems, docsByLineItemId);
      setTravelRows(travelRows);
      setMiscRows(miscRows);
      setInEntRows(inEntRows);
      setOtherRows(otherRows);
      setOvMyrRows(ovMyrRows);
      setOvFxRows(ovFxRows);
      setOvOtherRows(ovOtherRows);
      setEntRows([emptyEntRow()]);

      // Re-key the matched documents by their fieldKey so removing/replacing
      // one goes through the existing uploadedFiles → deleteClaimDocument path.
      const restoredUploads: Record<string, { docId: string; fileKey: string }> = {};
      for (const row of travelRows) {
        const flightDoc = docsByLineItemId.get(row.id);
        if (flightDoc && row.existingFlightFileName) restoredUploads[`flightFile:${row.id}`] = { docId: flightDoc.id, fileKey: flightDoc.fileKey };
        const accomDoc = docsByLineItemId.get(row.accomId);
        if (accomDoc && row.existingAccomFileName) restoredUploads[`accomFile:${row.id}`] = { docId: accomDoc.id, fileKey: accomDoc.fileKey };
        const tEntDoc = docsByLineItemId.get(row.tEntId);
        if (tEntDoc && row.existingTEntFileName) restoredUploads[`tEntFile:${row.id}`] = { docId: tEntDoc.id, fileKey: tEntDoc.fileKey };
      }
      for (const row of miscRows) {
        const doc = docsByLineItemId.get(row.id);
        if (doc && row.existingFileName) restoredUploads[`misc:${row.id}`] = { docId: doc.id, fileKey: doc.fileKey };
      }
      for (const row of inEntRows) {
        const doc = docsByLineItemId.get(row.id);
        if (doc && row.existingFileName) restoredUploads[`inent:${row.id}`] = { docId: doc.id, fileKey: doc.fileKey };
      }
      for (const row of otherRows) {
        const doc = docsByLineItemId.get(row.id);
        if (doc && row.existingFileName) restoredUploads[`other:${row.id}`] = { docId: doc.id, fileKey: doc.fileKey };
      }
      setUploadedFiles(restoredUploads);
    }
    setSubmitOpen(true);
  }

  function handleTypeChange(id: string) {
    setSelectedTypeId(id);
    setClaimPeriod(""); setNote(""); setQueuedFiles([]);
    setTravelRows([emptyTravel()]); setMiscRows([]); setInEntRows([]); setOtherRows([]);
    setOvMyrRows([]); setOvFxRows([]); setOvOtherRows([]);
    setEntRows([emptyEntRow()]);
  }

  // Backfills the default (end-of-period) date onto any row the user hasn't
  // touched yet, so picking the period after adding a row still helps —
  // not just rows added after the period is already set.
  function handlePeriodChange(period: string) {
    setClaimPeriod(period);
    const d = lastDayOfPeriod(period);
    if (!d) return;
    setTravelRows(prev => prev.map(r => r.lineDate ? r : { ...r, lineDate: d }));
    setMiscRows(prev => prev.map(r => r.lineDate ? r : { ...r, lineDate: d }));
    setInEntRows(prev => prev.map(r => r.lineDate ? r : { ...r, lineDate: d }));
    setOtherRows(prev => prev.map(r => r.lineDate ? r : { ...r, lineDate: d }));
    setOvMyrRows(prev => prev.map(r => r.lineDate ? r : { ...r, lineDate: d }));
    setOvFxRows(prev => prev.map(r => r.lineDate ? r : { ...r, lineDate: d }));
    setOvOtherRows(prev => prev.map(r => r.lineDate ? r : { ...r, lineDate: d }));
    setEntRows(prev => prev.map(r => r.eventDate ? r : { ...r, eventDate: d }));
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

  // Approved travel forms not yet used in a claim — fetched lazily when the
  // picker opens rather than on every page load.
  async function handleOpenTravelFormPicker() {
    setTravelFormPickerOpen(true);
    setLoadingTravelForms(true);
    try {
      const forms = await getMyApprovedUnclaimedTravelForms();
      setAvailableTravelForms(forms);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load travel forms");
    } finally {
      setLoadingTravelForms(false);
    }
  }
  function handleSelectTravelForm(form: TravelFormWithDetails) {
    const newRows: TravelRow[] = form.stops.map(stop => ({
      id: newId(), lineDate: stop.stopDate,
      fromLocation: stop.fromLocation, toLocation: stop.toLocation,
      distanceKm: stop.distanceKm || "", mode: stop.mode || "", purpose: stop.purpose,
      travelFormId: form.id, travelFormNo: form.applicationNo,
      dailyId: newId(), breakfastDays: "", lunchDays: "", dinnerDays: "",
      accomId: newId(), accomAmount: "",
      tEntId: newId(), tEntAmount: "",
    }));
    setTravelRows(prev => [...prev, ...newRows]);
    setAvailableTravelForms(prev => prev.filter(f => f.id !== form.id));
    setTravelFormPickerOpen(false);
    toast.success(
      newRows.length > 1
        ? `${newRows.length} trip legs pre-filled from ${form.applicationNo}`
        : `Trip pre-filled from ${form.applicationNo}`,
    );
  }
  function handleUnlinkTravelForm(rowId: string) {
    setTravelRows(prev => prev.map(r => r.id === rowId ? { ...r, travelFormId: undefined, travelFormNo: undefined } : r));
  }

  const EXISTING_FILE_FIELD = { flightFile: "existingFlightFileName", accomFile: "existingAccomFileName", tEntFile: "existingTEntFileName" } as const;
  async function setTravelFile(rowId: string, field: "accomFile" | "tEntFile" | "flightFile", file: File | undefined) {
    const fieldKey = `${field}:${rowId}`;
    if (file === undefined) {
      setTravelRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: undefined, [EXISTING_FILE_FIELD[field]]: undefined } : r));
      await removeOneUpload(fieldKey);
      return;
    }
    setTravelRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: file } : r));
    if (editingApp) {
      const row = travelRows.find(r => r.id === rowId);
      const lineItemId = field === "accomFile" ? row?.accomId : field === "tEntFile" ? row?.tEntId : rowId;
      await uploadOneFile(file, editingApp.id, fieldKey, lineItemId);
    }
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
      const id = newId();
      setQueuedFiles(p => [...p, { file: f, id }]);
      if (editingApp) void uploadOneFile(f, editingApp.id, `qf:${id}`);
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
    const isDraft = cancelTarget.status === "DRAFT";
    try {
      await deleteClaim(cancelTarget.id);
      toast.success(isDraft ? "Draft deleted" : "Claim withdrawn");
      setCancelTarget(null);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally { setCancelling(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedType || !formType) { toast.error("This claim's type is no longer available — contact HR"); return; }
    if (!claimPeriod) { toast.error("Select a claim period / date"); return; }
    if ((formType === CLAIM_FORM.LOCAL || formType === CLAIM_FORM.OVERSEAS) && !/^\d{4}-\d{2}$/.test(claimPeriod)) {
      toast.error("Claim period is invalid — please re-select it");
      return;
    }
    setSubmitting(true);
    try {
      let lineItems: ClaimLineItemInput[] | undefined;
      let entertainmentDetails: ClaimEntertainmentDetailInput[] | undefined;
      // Hoisted so the upload-queue step below (shared across all claim types) can
      // filter files down to the same rows that actually became line items.
      let miscValid: typeof miscRows = [];
      let inEntValid: typeof inEntRows = [];
      let otherValid: typeof otherRows = [];

      if (formType === CLAIM_FORM.LOCAL) {
        // Validate receipt presence for misc / in-base-ent / other rows
        miscValid  = miscRows.filter(r => r.lineDate && parseFloat(r.amountMyr) > 0);
        inEntValid = inEntRows.filter(r => r.lineDate && r.venue.trim() && parseFloat(r.amountMyr) > 0);
        otherValid = otherRows.filter(r => r.lineDate && r.description.trim() && parseFloat(r.amountMyr) > 0);
        const flightMissingReceipt = travelRows.find(r => r.mode === TRAVEL_MODE.FLIGHT && !r.flightFile && !r.existingFlightFileName);
        if (flightMissingReceipt) { toast.error("Flight receipt is required for flight travel"); setSubmitting(false); return; }
        const accomMissingReceipt = travelRows.find(r => parseFloat(r.accomAmount) > 0 && !r.accomFile && !r.existingAccomFileName);
        if (accomMissingReceipt) { toast.error("Accommodation receipt is required"); setSubmitting(false); return; }
        const tEntMissingReceipt = travelRows.find(r => parseFloat(r.tEntAmount) > 0 && !r.tEntFile && !r.existingTEntFileName);
        if (tEntMissingReceipt) { toast.error("Travel entertainment receipt is required"); setSubmitting(false); return; }
        const missingReceipt = [...miscValid, ...inEntValid, ...otherValid].find(r => !r.file && !r.existingFileName);
        if (missingReceipt) { toast.error("Each expense item requires an attached receipt"); setSubmitting(false); return; }

        // Catch the reverse case: a row has a receipt attached (so the user
        // clearly meant to submit it) but is missing another required field
        // (date/amount/etc). Without this check the row silently fails the
        // *Valid filters below and never becomes a line item — the receipt
        // still uploads (it's sent immediately on pick) and ends up orphaned
        // with no line item to show for it, with zero feedback to the user.
        const incompleteAccom = travelRows.find(r => (r.accomFile || r.existingAccomFileName) && !(parseFloat(r.accomAmount) > 0));
        if (incompleteAccom) { toast.error("Accommodation has a receipt attached but no amount entered — fill in the amount or remove the receipt"); setSubmitting(false); return; }
        const incompleteTEnt = travelRows.find(r => (r.tEntFile || r.existingTEntFileName) && !(parseFloat(r.tEntAmount) > 0));
        if (incompleteTEnt) { toast.error("Travel entertainment has a receipt attached but no amount entered — fill in the amount or remove the receipt"); setSubmitting(false); return; }
        const incompleteMisc = miscRows.find(r => (r.file || r.existingFileName) && !(r.lineDate && parseFloat(r.amountMyr) > 0));
        if (incompleteMisc) { toast.error(`A ${MISC_SUB_LABELS[incompleteMisc.subType]} expense has a receipt attached but is missing a date or amount — complete the row or remove the receipt`); setSubmitting(false); return; }
        const incompleteInEnt = inEntRows.find(r => (r.file || r.existingFileName) && !(r.lineDate && r.venue.trim() && parseFloat(r.amountMyr) > 0));
        if (incompleteInEnt) { toast.error("An In-Base Entertainment expense has a receipt attached but is missing a date, venue, or amount — complete the row or remove the receipt"); setSubmitting(false); return; }
        const incompleteOther = otherRows.find(r => (r.file || r.existingFileName) && !(r.lineDate && r.description.trim() && parseFloat(r.amountMyr) > 0));
        if (incompleteOther) { toast.error("An Other Expenses item has a receipt attached but is missing a date, description, or amount — complete the row or remove the receipt"); setSubmitting(false); return; }

        lineItems = [
          ...travelRows.flatMap(r => {
            if (!r.lineDate) return [];
            const items: ClaimLineItemInput[] = [];
            const km = parseFloat(r.distanceKm);
            const usesMileage = r.mode !== TRAVEL_MODE.FLIGHT && r.mode !== TRAVEL_MODE.COMPANY_CAR;
            const mileageAmt = usesMileage && km > 0 ? km * ratePerKm : 0;
            // Always create a TRAVEL line item so documents (e.g. flight receipt) have an anchor
            if (r.lineDate && (r.fromLocation.trim() || r.toLocation.trim() || r.purpose.trim() || r.mode)) {
              items.push({ id: r.id, docId: uploadedFiles[`flightFile:${r.id}`]?.docId, travelFormId: r.travelFormId, category: LINE_CATEGORY.TRAVEL, lineDate: r.lineDate, fromLocation: r.fromLocation || undefined, toLocation: r.toLocation || undefined, distanceKm: usesMileage && km > 0 ? km : undefined, ratePerUnit: usesMileage ? (selectedType.ratePerUnit ?? undefined) : undefined, description: r.purpose.trim() || (r.mode ? TRAVEL_MODE_LABELS[r.mode] : undefined), amountMyr: mileageAmt.toFixed(2) });
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
              items.push({ id: r.accomId, docId: uploadedFiles[`accomFile:${r.id}`]?.docId, category: LINE_CATEGORY.TRAVEL_ACCOMMODATION, lineDate: r.lineDate, amountMyr: r.accomAmount });
            }
            if (parseFloat(r.tEntAmount) > 0) {
              items.push({ id: r.tEntId, docId: uploadedFiles[`tEntFile:${r.id}`]?.docId, category: LINE_CATEGORY.TRAVEL_ENTERTAINMENT, lineDate: r.lineDate, amountMyr: r.tEntAmount });
            }
            return items;
          }),
          ...miscValid.map(r => ({ id: r.id, docId: uploadedFiles[`misc:${r.id}`]?.docId, category: r.subType as typeof LINE_CATEGORY[keyof typeof LINE_CATEGORY], lineDate: r.lineDate, description: r.description || MISC_SUB_LABELS[r.subType], amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...inEntValid.map(r => ({ id: r.id, docId: uploadedFiles[`inent:${r.id}`]?.docId, category: LINE_CATEGORY.IN_BASE_ENT, lineDate: r.lineDate, venue: r.venue, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...otherValid.map(r => ({ id: r.id, docId: uploadedFiles[`other:${r.id}`]?.docId, category: LINE_CATEGORY.OTHER_LOCAL, lineDate: r.lineDate, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
        ];
        if (lineItems.length === 0) { toast.error("Add at least one expense item"); setSubmitting(false); return; }
      } else if (formType === CLAIM_FORM.OVERSEAS) {
        lineItems = [
          ...ovMyrRows.filter(r => r.lineDate && r.destination.trim() && parseFloat(r.amountMyr) > 0)
            .map(r => ({ id: r.id, category: LINE_CATEGORY.OVERSEAS_MYR, lineDate: r.lineDate, destination: r.destination, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...ovFxRows.filter(r => r.lineDate && r.destination.trim() && parseFloat(r.amountForeign) > 0 && parseFloat(r.exchangeRate) > 0)
            .map(r => ({ id: r.id, category: LINE_CATEGORY.OVERSEAS_FX, lineDate: r.lineDate, destination: r.destination, currency: r.currency, amountForeign: r.amountForeign, exchangeRate: r.exchangeRate, amountMyr: fxMyr(r.amountForeign, r.exchangeRate).toFixed(2) } satisfies ClaimLineItemInput)),
          ...ovOtherRows.filter(r => r.lineDate && r.description.trim() && parseFloat(r.amountMyr) > 0)
            .map(r => ({ id: r.id, category: LINE_CATEGORY.OVERSEAS_OTHER, lineDate: r.lineDate, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
        ];
        if (lineItems.length === 0) { toast.error("Add at least one expense item"); setSubmitting(false); return; }
      } else {
        const validEnt = entRows.filter(r => r.eventDate && r.restaurantName.trim() && r.customerName.trim() && r.departmentOrganization.trim() && r.purpose.trim() && parseFloat(r.amount) > 0);
        if (validEnt.length === 0) {
          toast.error("At least one complete entertainment detail is required"); setSubmitting(false); return;
        }
        entertainmentDetails = validEnt.map(r => ({ eventDate: r.eventDate, restaurantName: r.restaurantName, customerName: r.customerName, departmentOrganization: r.departmentOrganization, purpose: r.purpose, amount: r.amount }));
      }

      const periodLabel = /^\d{4}-\d{2}$/.test(claimPeriod)
        ? new Date(claimPeriod + "-02").toLocaleDateString("en-MY", { month: "long", year: "numeric" })
        : null;
      const autoDesc = formType === CLAIM_FORM.LOCAL
        ? (note.trim() || (periodLabel ? `Local Claim — ${periodLabel}` : "Local Claim"))
        : formType === CLAIM_FORM.OVERSEAS
        ? (note.trim() || (periodLabel ? `Overseas Claim — ${periodLabel}` : "Overseas Claim"))
        : (entRows[0]?.purpose.trim() || "Entertainment");

      const claimData = { claimTypeId: selectedType.id, claimPeriod, description: autoDesc, lineItems, entertainmentDetails };

      let appId: string;
      if (editingApp?.status === "DRAFT") {
        await finalizeDraftClaim(editingApp.id, claimData);
        appId = editingApp.id;
      } else if (editingApp?.status === "REJECTED") {
        await resubmitRejectedClaim(editingApp.id, claimData);
        appId = editingApp.id;
      } else {
        appId = await submitClaim(claimData);
      }

      // Build upload queue — skip files already uploaded via immediate upload.
      // Only queue files for rows that actually made it into `lineItems` above
      // (same validity filters) — a file on a row that got excluded (e.g. no
      // lineDate/amount) would otherwise be uploaded and linked to a
      // lineItemId that was never inserted into claim_line_item.
      type UploadJob = { file: File; lineItemId?: string; fieldKey: string };
      const uploadJobs: UploadJob[] = [
        ...travelRows.filter(r => r.lineDate && r.flightFile && !uploadedFiles[`flightFile:${r.id}`]).map(r => ({ file: r.flightFile!, lineItemId: r.id, fieldKey: `flightFile:${r.id}` })),
        ...travelRows.filter(r => r.lineDate && r.accomFile && parseFloat(r.accomAmount) > 0 && !uploadedFiles[`accomFile:${r.id}`]).map(r => ({ file: r.accomFile!, lineItemId: r.accomId, fieldKey: `accomFile:${r.id}` })),
        ...travelRows.filter(r => r.lineDate && r.tEntFile && parseFloat(r.tEntAmount) > 0 && !uploadedFiles[`tEntFile:${r.id}`]).map(r => ({ file: r.tEntFile!, lineItemId: r.tEntId, fieldKey: `tEntFile:${r.id}` })),
        ...miscValid.filter(r => r.file && !uploadedFiles[`misc:${r.id}`]).map(r => ({ file: r.file!, lineItemId: r.id, fieldKey: `misc:${r.id}` })),
        ...inEntValid.filter(r => r.file && !uploadedFiles[`inent:${r.id}`]).map(r => ({ file: r.file!, lineItemId: r.id, fieldKey: `inent:${r.id}` })),
        ...otherValid.filter(r => r.file && !uploadedFiles[`other:${r.id}`]).map(r => ({ file: r.file!, lineItemId: r.id, fieldKey: `other:${r.id}` })),
        ...queuedFiles.filter(qf => !uploadedFiles[`qf:${qf.id}`]).map(qf => ({ file: qf.file, fieldKey: `qf:${qf.id}` })),
      ];

      // Each job is isolated — the claim itself is already saved above, so an
      // attachment failure here must not surface as a misleading "Failed to
      // submit" (which would wrongly suggest the whole claim was lost).
      const failedUploads: string[] = [];
      for (const job of uploadJobs) {
        try {
          const res = await fetch("/api/claim/upload-url", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ appId, fileName:job.file.name, mimeType:job.file.type, fileSize:job.file.size }) });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error ?? `HTTP ${res.status}`);
          }
          const { uploadUrl, key } = await res.json();
          const upload = await fetch(uploadUrl, { method:"PUT", headers:{"Content-Type":job.file.type}, body:job.file });
          if (!upload.ok) throw new Error(`upload to storage failed (HTTP ${upload.status})`);
          await createClaimDocumentRecord({ applicationId:appId, lineItemId:job.lineItemId, fileName:job.file.name, fileKey:key, fileSize:job.file.size, mimeType:job.file.type });
        } catch (err) {
          const reason = err instanceof Error ? err.message : "unknown error";
          toast.error(`${job.file.name} could not be attached: ${reason}`);
          failedUploads.push(job.file.name);
        }
      }

      const submitLabel = editingApp?.status === "DRAFT" ? "Draft submitted" : editingApp?.status === "REJECTED" ? "Claim resubmitted" : "Claim submitted";
      toast.success(failedUploads.length > 0 ? `${submitLabel} — ${failedUploads.length} attachment(s) failed, see above` : submitLabel);
      setSubmitOpen(false); resetForm();
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    } finally { setSubmitting(false); }
  }

  async function handleSaveDraft() {
    if (!selectedType) { toast.error("Select a claim type first"); return; }
    setSavingDraft(true);
    try {
      let draftLineItems: ClaimLineItemInput[] | undefined;
      let draftEntDetails: ClaimEntertainmentDetailInput[] | undefined;
      if (formType === CLAIM_FORM.LOCAL) {
        draftLineItems = [
          ...travelRows.flatMap(r => {
            if (!r.lineDate) return [];
            const items: ClaimLineItemInput[] = [];
            const km = parseFloat(r.distanceKm);
            const usesMileage = r.mode !== TRAVEL_MODE.FLIGHT && r.mode !== TRAVEL_MODE.COMPANY_CAR;
            const mileageAmt = usesMileage && km > 0 ? km * ratePerKm : 0;
            if (r.fromLocation.trim() || r.toLocation.trim() || r.purpose.trim() || r.mode) {
              items.push({ id: r.id, docId: uploadedFiles[`flightFile:${r.id}`]?.docId, travelFormId: r.travelFormId, category: LINE_CATEGORY.TRAVEL, lineDate: r.lineDate, fromLocation: r.fromLocation || undefined, toLocation: r.toLocation || undefined, distanceKm: usesMileage && km > 0 ? km : undefined, ratePerUnit: usesMileage ? (selectedType.ratePerUnit ?? undefined) : undefined, description: r.purpose.trim() || (r.mode ? TRAVEL_MODE_LABELS[r.mode] : undefined), amountMyr: mileageAmt.toFixed(2) });
            }
            const bf = parseFloat(r.breakfastDays)||0;
            const ln = parseFloat(r.lunchDays)||0;
            const dn = parseFloat(r.dinnerDays)||0;
            const dailyTotal = bf*mealBreakfastRate + ln*mealLunchRate + dn*mealDinnerRate;
            if (dailyTotal > 0) {
              const parts: string[] = [];
              if (bf > 0) parts.push(`Breakfast ×${bf}d`);
              if (ln > 0) parts.push(`Lunch ×${ln}d`);
              if (dn > 0) parts.push(`Dinner ×${dn}d`);
              items.push({ id: r.dailyId, category: LINE_CATEGORY.TRAVEL_DAILY_ALLOWANCE, lineDate: r.lineDate, description: parts.join(", "), amountMyr: dailyTotal.toFixed(2) });
            }
            if (parseFloat(r.accomAmount) > 0) items.push({ id: r.accomId, docId: uploadedFiles[`accomFile:${r.id}`]?.docId, category: LINE_CATEGORY.TRAVEL_ACCOMMODATION, lineDate: r.lineDate, amountMyr: r.accomAmount });
            if (parseFloat(r.tEntAmount) > 0) items.push({ id: r.tEntId, docId: uploadedFiles[`tEntFile:${r.id}`]?.docId, category: LINE_CATEGORY.TRAVEL_ENTERTAINMENT, lineDate: r.lineDate, amountMyr: r.tEntAmount });
            return items;
          }),
          ...miscRows.filter(r => r.lineDate && parseFloat(r.amountMyr) > 0).map(r => ({ id: r.id, docId: uploadedFiles[`misc:${r.id}`]?.docId, category: r.subType as typeof LINE_CATEGORY[keyof typeof LINE_CATEGORY], lineDate: r.lineDate, description: r.description || MISC_SUB_LABELS[r.subType], amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...inEntRows.filter(r => r.lineDate && r.venue.trim() && parseFloat(r.amountMyr) > 0).map(r => ({ id: r.id, docId: uploadedFiles[`inent:${r.id}`]?.docId, category: LINE_CATEGORY.IN_BASE_ENT, lineDate: r.lineDate, venue: r.venue, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...otherRows.filter(r => r.lineDate && r.description.trim() && parseFloat(r.amountMyr) > 0).map(r => ({ id: r.id, docId: uploadedFiles[`other:${r.id}`]?.docId, category: LINE_CATEGORY.OTHER_LOCAL, lineDate: r.lineDate, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
        ];
      } else if (formType === CLAIM_FORM.OVERSEAS) {
        draftLineItems = [
          ...ovMyrRows.filter(r => r.lineDate && r.destination.trim() && parseFloat(r.amountMyr) > 0)
            .map(r => ({ id: r.id, category: LINE_CATEGORY.OVERSEAS_MYR, lineDate: r.lineDate, destination: r.destination, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
          ...ovFxRows.filter(r => r.lineDate && r.destination.trim() && parseFloat(r.amountForeign) > 0 && parseFloat(r.exchangeRate) > 0)
            .map(r => ({ id: r.id, category: LINE_CATEGORY.OVERSEAS_FX, lineDate: r.lineDate, destination: r.destination, currency: r.currency, amountForeign: r.amountForeign, exchangeRate: r.exchangeRate, amountMyr: fxMyr(r.amountForeign, r.exchangeRate).toFixed(2) } satisfies ClaimLineItemInput)),
          ...ovOtherRows.filter(r => r.lineDate && r.description.trim() && parseFloat(r.amountMyr) > 0)
            .map(r => ({ id: r.id, category: LINE_CATEGORY.OVERSEAS_OTHER, lineDate: r.lineDate, description: r.description, amountMyr: r.amountMyr } satisfies ClaimLineItemInput)),
        ];
      } else {
        draftEntDetails = entRows
          .filter(r => r.eventDate && r.restaurantName.trim() && r.customerName.trim() && r.departmentOrganization.trim() && r.purpose.trim() && parseFloat(r.amount) > 0)
          .map(r => ({ eventDate: r.eventDate, restaurantName: r.restaurantName, customerName: r.customerName, departmentOrganization: r.departmentOrganization, purpose: r.purpose, amount: r.amount }));
      }
      const claimData = {
        claimTypeId: selectedType.id,
        claimPeriod: claimPeriod || new Date().toISOString().slice(0,7),
        description: note.trim() || "Draft",
        lineItems: draftLineItems,
        entertainmentDetails: draftEntDetails,
      };

      let appId: string;
      if (editingApp?.status === "DRAFT") {
        await updateDraftClaim(editingApp.id, claimData);
        appId = editingApp.id;
      } else {
        appId = await saveDraftClaim(claimData);
      }

      // Upload all attached receipts + queued files (skip already-uploaded ones).
      // Filters mirror draftLineItems above so a file never gets linked to a
      // lineItemId that was excluded from the draft (never inserted into claim_line_item).
      const draftJobs: { file: File; lineItemId?: string; fieldKey: string }[] = [
        ...travelRows.filter(r => r.lineDate && r.flightFile && !uploadedFiles[`flightFile:${r.id}`]).map(r => ({ file: r.flightFile!, lineItemId: r.id, fieldKey: `flightFile:${r.id}` })),
        ...travelRows.filter(r => r.lineDate && r.accomFile && parseFloat(r.accomAmount) > 0 && !uploadedFiles[`accomFile:${r.id}`]).map(r => ({ file: r.accomFile!, lineItemId: r.accomId, fieldKey: `accomFile:${r.id}` })),
        ...travelRows.filter(r => r.lineDate && r.tEntFile && parseFloat(r.tEntAmount) > 0 && !uploadedFiles[`tEntFile:${r.id}`]).map(r => ({ file: r.tEntFile!, lineItemId: r.tEntId, fieldKey: `tEntFile:${r.id}` })),
        ...miscRows.filter(r => r.lineDate && parseFloat(r.amountMyr) > 0 && r.file && !uploadedFiles[`misc:${r.id}`]).map(r => ({ file: r.file!, lineItemId: r.id, fieldKey: `misc:${r.id}` })),
        ...inEntRows.filter(r => r.lineDate && r.venue.trim() && parseFloat(r.amountMyr) > 0 && r.file && !uploadedFiles[`inent:${r.id}`]).map(r => ({ file: r.file!, lineItemId: r.id, fieldKey: `inent:${r.id}` })),
        ...otherRows.filter(r => r.lineDate && r.description.trim() && parseFloat(r.amountMyr) > 0 && r.file && !uploadedFiles[`other:${r.id}`]).map(r => ({ file: r.file!, lineItemId: r.id, fieldKey: `other:${r.id}` })),
        ...queuedFiles.filter(qf => !uploadedFiles[`qf:${qf.id}`]).map(qf => ({ file: qf.file, fieldKey: `qf:${qf.id}` })),
      ];
      for (const job of draftJobs) {
        await uploadOneFile(job.file, appId, job.fieldKey, job.lineItemId);
      }

      toast.success("Draft saved");
      setSubmitOpen(false); resetForm();
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save draft");
    } finally { setSavingDraft(false); }
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
                  <TableHead className="w-28 text-right">Actions</TableHead>
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
                          {hasReviewChanges(app) && (
                            <Badge className="text-xs px-1.5 py-0 h-5 bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                              Reviewed with changes
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtClaimDate(app.claimDate, ct?.category ?? "")}</TableCell>
                      <TableCell className="max-w-xs"><p className="text-sm text-muted-foreground truncate" title={app.description}>{app.description}</p></TableCell>
                      <TableCell className="text-right text-sm font-semibold">{fmtAmount(app.amount)}</TableCell>
                      <TableCell><StatusBadge status={app.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="View claim" onClick={() => setViewClaimTarget(app)}>
                            <EyeIcon className="h-3.5 w-3.5"/>
                          </Button>
                          {app.status !== "DRAFT" && (
                            <Button
                              variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              title={downloadingPdfId === app.id ? "Generating PDF…" : "Download PDF"}
                              disabled={downloadingPdfId === app.id}
                              onClick={() => handleDownloadPdf(app.id, app.applicationNo)}
                            >
                              {downloadingPdfId === app.id ? (
                                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"/>
                              ) : (
                                <PrinterIcon className="h-3.5 w-3.5"/>
                              )}
                            </Button>
                          )}
                          {app.documents.length > 0 && (
                            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" title="View documents" onClick={() => setViewDocsApp(app)}>
                              <EyeIcon className="h-3.5 w-3.5"/>
                              {app.documents.length > 1 ? `${app.documents.length} docs` : "Doc"}
                            </Button>
                          )}
                          {app.status === "DRAFT" && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => loadAppIntoForm(app)}>
                              Continue
                            </Button>
                          )}
                          {app.status === "REJECTED" && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50" onClick={() => loadAppIntoForm(app)}>
                              Edit &amp; Resubmit
                            </Button>
                          )}
                          {(app.status === "DRAFT" || app.status === "PENDING" || app.status === "CHECKED") && (
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setCancelTarget(app)} title={app.status === "DRAFT" ? "Delete draft" : "Withdraw"}>
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
                {cancelTarget?.status === "DRAFT"
                  ? <>Delete draft <strong>{cancelTarget?.claimTypeName} ({cancelTarget?.applicationNo})</strong>? This will permanently remove the draft.</>
                  : <>Withdraw <strong>{cancelTarget?.claimTypeName} ({cancelTarget?.applicationNo})</strong> for <strong>{fmtAmount(cancelTarget?.amount ?? "0")}</strong>? This cannot be undone.</>
                }
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="destructive" onClick={handleCancel} disabled={cancelling} className="flex-1">
                {cancelling ? "Deleting…" : cancelTarget?.status === "DRAFT" ? "Yes, Delete" : "Yes, Withdraw"}
              </Button>
              <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>Keep</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* View Claim Sheet — read-only, includes any checker edits/slashes */}
      <Sheet open={!!viewClaimTarget} onOpenChange={open => !open && setViewClaimTarget(null)}>
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Claim Details</SheetTitle></SheetHeader>
          {viewClaimTarget && <ClaimReadOnlyDetail app={viewClaimTarget}/>}
          <Button variant="outline" className="w-full mt-6" onClick={() => setViewClaimTarget(null)}>Close</Button>
        </SheetContent>
      </Sheet>

      {/* View Documents Sheet */}
      <Sheet open={!!viewDocsApp} onOpenChange={open => !open && setViewDocsApp(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-full! overflow-y-auto px-8">
          <SheetHeader className="mb-5">
            <SheetTitle>Receipts & Documents</SheetTitle>
          </SheetHeader>
          {viewDocsApp && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {viewDocsApp.applicationNo} · {viewDocsApp.claimTypeName}
              </div>
              {viewDocsApp.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No documents attached.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {viewDocsApp.documents.map((doc) => (
                    <a
                      key={doc.id}
                      href={`/api/claim/download/${doc.fileKey}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-xs hover:bg-muted/50 transition-colors group"
                    >
                      <FileDownIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary"/>
                      <span className="flex-1 truncate text-foreground font-medium">{doc.fileName}</span>
                      <span className="text-muted-foreground shrink-0">
                        {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)} KB` : ""}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400 shrink-0 font-medium">Download</span>
                    </a>
                  ))}
                </div>
              )}
              <Button variant="outline" className="w-full mt-4" onClick={() => setViewDocsApp(null)}>Close</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Travel Form Picker Sheet */}
      <Sheet open={travelFormPickerOpen} onOpenChange={setTravelFormPickerOpen}>
        <SheetContent className="w-full sm:max-w-md max-w-full! overflow-y-auto px-6">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <RouteIcon className="h-5 w-5 text-muted-foreground"/>
              Select an Approved Travel Form
            </SheetTitle>
          </SheetHeader>
          {loadingTravelForms ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
          ) : availableTravelForms.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No approved, unclaimed travel forms found. Submit one under My Travel Forms and get it approved first.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {availableTravelForms.map(form => (
                <button
                  key={form.id}
                  type="button"
                  onClick={() => handleSelectTravelForm(form)}
                  className="text-left rounded-md border border-border p-3 hover:bg-muted/50 hover:border-primary transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-medium">{form.applicationNo}</span>
                    <span className="text-xs text-muted-foreground">{form.startDate} – {form.endDate}</span>
                  </div>
                  <p className="text-sm font-medium mt-1">{formatTravelItinerary(form.stops)}</p>
                  {form.stops.length > 1 && (
                    <p className="text-xs text-muted-foreground mt-0.5">Adds {form.stops.length} trip legs to your claim</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">{travelPurposesSummary(form.stops)}</p>
                </button>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Submit Claim Sheet */}
      <Sheet open={submitOpen} onOpenChange={open => { if (submitting) return; if (!open) resetForm(); setSubmitOpen(open); }}>
        <SheetContent className="w-full sm:max-w-2xl max-w-full! overflow-y-auto px-6">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2">
              <ReceiptIcon className="h-5 w-5 text-muted-foreground"/>
              {editingApp?.status === "DRAFT" ? "Continue Draft" : editingApp?.status === "REJECTED" ? "Edit & Resubmit" : "Submit Claim"}
            </SheetTitle>
          </SheetHeader>

          {editingApp?.status === "REJECTED" && (editingApp.reviewComment || editingApp.checkerComment) && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              <span className="font-semibold">Rejection reason: </span>
              {editingApp.checkerComment || editingApp.reviewComment}
            </div>
          )}
          {editingApp?.status === "DRAFT" && (
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
              Continuing draft <span className="font-mono font-semibold">{editingApp.applicationNo}</span>. Files must be re-attached before submitting.
            </div>
          )}
          {editingApp?.status === "REJECTED" && (
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
              Previously attached documents are kept automatically — only newly added items need new receipts.
            </div>
          )}
          {editingApp && editingApp.documents.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Currently Attached Documents ({editingApp.documents.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {editingApp.documents.map(doc => {
                  const linked = doc.lineItemId !== null;
                  return (
                    <div key={doc.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted/50 transition-colors group">
                      <FileDownIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary"/>
                      <a href={`/api/claim/download/${doc.fileKey}`} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-foreground font-medium hover:underline">
                        {doc.fileName}
                      </a>
                      {!linked && <span className="text-amber-600 dark:text-amber-400 shrink-0 text-[10px] font-semibold uppercase tracking-wide" title="Not linked to any expense row on this claim">Unlinked</span>}
                      <button
                        type="button"
                        onClick={() => { void handleDeleteDocument(doc.id); }}
                        disabled={deletingDocId === doc.id}
                        className="text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-50"
                        title="Remove this document"
                      >
                        {deletingDocId === doc.id ? <LoaderIcon className="h-3.5 w-3.5 animate-spin"/> : <TrashIcon className="h-3.5 w-3.5"/>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                  <input type="month" value={claimPeriod} onChange={e => handlePeriodChange(e.target.value)} className={inputCls+" w-48"} required/>
                </div>
              </Section>

              {/* 1.1 Travel */}
              <Section title="1.1  Travel Expenses" badge={travelTotal > 0 ? fmtAmount(travelTotal) : undefined}>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={handleOpenTravelFormPicker}><RouteIcon className="h-3.5 w-3.5"/>Import from Travel Form</Button>
                </div>
                <div className="flex flex-col gap-4">
                  {(() => {
                    let standaloneCount = 0;
                    return travelGroups.map(group => {
                      const groupTotal = group.rows.reduce((s, r) => s + tripTotalOf(r), 0);
                      if (group.travelFormId) {
                        return (
                          <div key={group.key} className="rounded-lg border-2 border-blue-200 dark:border-blue-900 bg-card overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-900">
                              <div className="flex items-center gap-2">
                                <RouteIcon className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400"/>
                                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Itinerary — {group.travelFormNo}</span>
                                <span className="text-[10px] text-muted-foreground">{group.rows.length} {group.rows.length===1?"leg":"legs"}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                {groupTotal > 0 && <span className="text-xs font-bold text-green-700 dark:text-green-400">{fmtAmount(groupTotal)}</span>}
                                <button type="button" onClick={() => group.rows.forEach(r => handleUnlinkTravelForm(r.id))} className="text-[10px] text-muted-foreground hover:text-destructive underline underline-offset-2">Unlink all</button>
                              </div>
                            </div>
                            <div className="divide-y divide-border/60">
                              {group.rows.map((row, legIdx) => {
                                const tripTotal = tripTotalOf(row);
                                return (
                                  <div key={row.id} className="p-4 flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[11px] font-semibold text-muted-foreground">{travelLegLabel(group.rows, legIdx)}</span>
                                      <div className="flex items-center gap-2">
                                        {tripTotal > 0 && <span className="text-xs font-bold text-green-700 dark:text-green-400">{fmtAmount(tripTotal)}</span>}
                                        <button type="button" onClick={() => handleUnlinkTravelForm(row.id)} className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2" title="Detach this leg from the itinerary">Unlink</button>
                                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => { void removeOneUpload(`flightFile:${row.id}`); void removeOneUpload(`accomFile:${row.id}`); void removeOneUpload(`tEntFile:${row.id}`); remover(setTravelRows,1)(row.id); }} disabled={travelRows.length===1}><XIcon className="h-3.5 w-3.5"/></Button>
                                      </div>
                                    </div>
                                    {travelDetailFields(row)}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }
                      standaloneCount += 1;
                      const row = group.rows[0];
                      return (
                        <div key={group.key} className="rounded-lg border border-border bg-card overflow-hidden">
                          {/* ── Card header ─────────────────────────────────── */}
                          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                            <span className="text-xs font-semibold text-foreground">Trip {standaloneCount}</span>
                            <div className="flex items-center gap-2">
                              {groupTotal > 0 && <span className="text-xs font-bold text-green-700 dark:text-green-400">{fmtAmount(groupTotal)}</span>}
                              <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => { void removeOneUpload(`flightFile:${row.id}`); void removeOneUpload(`accomFile:${row.id}`); void removeOneUpload(`tEntFile:${row.id}`); remover(setTravelRows,1)(row.id); }} disabled={travelRows.length===1}><XIcon className="h-3.5 w-3.5"/></Button>
                            </div>
                          </div>

                          {/* ── Trip details ─────────────────────────────────── */}
                          <div className="p-4 flex flex-col gap-3">
                            {travelDetailFields(row)}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setTravelRows(p => [...p,emptyTravel(lastDayOfPeriod(claimPeriod))])}><PlusIcon className="h-3.5 w-3.5"/>Add Trip</Button>
                </div>
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
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => { void removeOneUpload(`misc:${row.id}`); setMiscRows(p => p.filter(r => r.id!==row.id)); }}><XIcon className="h-3.5 w-3.5"/></Button>
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
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Receipt <span className="text-destructive">*</span></span>
                                {amt > 0 && !row.file && !row.existingFileName && <span className="text-xs text-destructive">Receipt required *</span>}
                                {amt > 0 && (row.file || row.existingFileName) && <span className="text-xs font-medium text-green-700 dark:text-green-400">{fmtAmount(amt)}</span>}
                              </div>
                              <ReceiptPicker row={row} setter={setMiscRows} uploading={uploadingFields.has(`misc:${row.id}`)} afterPick={editingApp ? f => { void uploadOneFile(f, editingApp.id, `misc:${row.id}`, row.id); } : undefined} afterRemove={editingApp ? () => { void removeOneUpload(`misc:${row.id}`); } : undefined}/>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setMiscRows(p => [...p,emptyMisc(lastDayOfPeriod(claimPeriod))])}><PlusIcon className="h-3.5 w-3.5"/>Add Item</Button>
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
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => { void removeOneUpload(`inent:${row.id}`); setInEntRows(p => p.filter(r => r.id!==row.id)); }}><XIcon className="h-3.5 w-3.5"/></Button>
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
                              <ReceiptPicker row={row} setter={setInEntRows} uploading={uploadingFields.has(`inent:${row.id}`)} afterPick={editingApp ? f => { void uploadOneFile(f, editingApp.id, `inent:${row.id}`, row.id); } : undefined} afterRemove={editingApp ? () => { void removeOneUpload(`inent:${row.id}`); } : undefined}/>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setInEntRows(p => [...p,emptyInEnt(lastDayOfPeriod(claimPeriod))])}><PlusIcon className="h-3.5 w-3.5"/>Add Item</Button>
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
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => { void removeOneUpload(`other:${row.id}`); setOtherRows(p => p.filter(r => r.id!==row.id)); }}><XIcon className="h-3.5 w-3.5"/></Button>
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
                              <ReceiptPicker row={row} setter={setOtherRows} uploading={uploadingFields.has(`other:${row.id}`)} afterPick={editingApp ? f => { void uploadOneFile(f, editingApp.id, `other:${row.id}`, row.id); } : undefined} afterRemove={editingApp ? () => { void removeOneUpload(`other:${row.id}`); } : undefined}/>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setOtherRows(p => [...p,emptyOther(lastDayOfPeriod(claimPeriod))])}><PlusIcon className="h-3.5 w-3.5"/>Add Item</Button>
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
                  <input type="month" value={claimPeriod} onChange={e => handlePeriodChange(e.target.value)} className={inputCls+" w-48"} required/>
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
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setOvMyrRows(p => [...p,emptyOvMyr(lastDayOfPeriod(claimPeriod))])}><PlusIcon className="h-3.5 w-3.5"/>Add</Button>
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
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setOvFxRows(p => [...p,emptyOvFx(lastDayOfPeriod(claimPeriod))])}><PlusIcon className="h-3.5 w-3.5"/>Add</Button>
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
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setOvOtherRows(p => [...p,emptyOvOther(lastDayOfPeriod(claimPeriod))])}><PlusIcon className="h-3.5 w-3.5"/>Add</Button>
              </Section>

              {overseasTotal > 0 && (
                <div className="flex justify-between items-center py-2 border-t border-border">
                  <span className="text-sm text-muted-foreground">Grand Total (MYR)</span>
                  <span className="text-lg font-bold text-green-700 dark:text-green-400">{fmtAmount(overseasTotal)}</span>
                </div>
              )}
            </>)}

            {/* ── ENTERTAINMENT FORM ─────────────────────────────────────── */}
            {formType === CLAIM_FORM.ENTERTAINMENT_FORM && (<>
              <Section title="Claim Period">
                <div className="flex flex-col gap-1.5 w-48">
                  <Label>Month / Year <span className="text-destructive">*</span></Label>
                  <input type="month" value={claimPeriod} onChange={e => handlePeriodChange(e.target.value)} className={inputCls+" w-48"} required/>
                </div>
              </Section>
            </>)}
            {formType === CLAIM_FORM.ENTERTAINMENT_FORM && (
              <Section title="Entertainment Details">
                {entRows.map((row, idx) => {
                  const filteredCusts = customers.filter(c => {
                    const q = row.custSearch.toLowerCase();
                    if (!q) return true;
                    return c.name.toLowerCase().includes(q) || (c.organizationName ?? "").toLowerCase().includes(q);
                  });
                  const updateRow = (patch: Partial<EntRow>) =>
                    setEntRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
                  return (
                    <div key={row.id} className="border border-border rounded-lg p-3 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">Entry {idx + 1}</span>
                        {entRows.length > 1 && (
                          <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => setEntRows(prev => prev.filter((_, i) => i !== idx))}>
                            <TrashIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field>
                          <Label>Date <span className="text-destructive">*</span></Label>
                          <Input type="date" value={row.eventDate} onChange={e => updateRow({ eventDate: e.target.value })} max={new Date().toISOString().split("T")[0]} required/>
                        </Field>
                        <Field>
                          <Label>Amount (RM) <span className="text-destructive">*</span></Label>
                          <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={row.amount} onChange={e => updateRow({ amount: e.target.value })} required/>
                        </Field>
                      </div>
                      <Field>
                        <Label>Restaurant / Venue Name <span className="text-destructive">*</span></Label>
                        <Input value={row.restaurantName} onChange={e => updateRow({ restaurantName: e.target.value })} placeholder="e.g. Restoran Nelayan, Kuala Lumpur" required/>
                      </Field>
                      <Field>
                        <Label>Customer <span className="text-destructive">*</span></Label>
                        <Input
                          placeholder="Search customer name or organization..."
                          value={row.custSearch || row.customerName}
                          onChange={e => updateRow({ custSearch: e.target.value, customerName: e.target.value, departmentOrganization: row.custSearch ? row.departmentOrganization : "" })}
                        />
                        {row.custSearch.length > 0 && filteredCusts.length > 0 && (
                          <div className="border border-border rounded-md bg-popover shadow-md max-h-40 overflow-y-auto">
                            {filteredCusts.slice(0, 8).map(c => (
                              <button
                                key={c.id}
                                type="button"
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex flex-col"
                                onClick={() => updateRow({ customerName: c.name, departmentOrganization: c.organizationName ?? "", custSearch: "" })}
                              >
                                <span>{c.name}</span>
                                {c.organizationName && <span className="text-xs text-muted-foreground">{c.organizationName}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </Field>
                      <Field>
                        <Label>Department &amp; Organization <span className="text-destructive">*</span></Label>
                        <Input value={row.departmentOrganization} onChange={e => updateRow({ departmentOrganization: e.target.value })} placeholder="e.g. Procurement Dept, ABC Sdn Bhd" required/>
                      </Field>
                      <Field>
                        <Label>Purpose <span className="text-destructive">*</span></Label>
                        <Textarea value={row.purpose} onChange={e => updateRow({ purpose: e.target.value })} placeholder="e.g. Business discussion on Q3 supply contract renewal" rows={2} required/>
                      </Field>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-1">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5"
                    onClick={() => setEntRows(prev => [...prev, emptyEntRow(lastDayOfPeriod(claimPeriod))])}>
                    <PlusIcon className="h-3.5 w-3.5"/>Add Entry
                  </Button>
                  {entRows.length > 0 && (
                    <span className="text-sm font-medium">
                      Total: RM {entRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
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
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => { void removeOneUpload(`qf:${qf.id}`); setQueuedFiles(p => p.filter(f => f.id!==qf.id)); }}><XIcon className="h-3.5 w-3.5"/></Button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* Actions */}
            {selectedType && (
              <div className="flex flex-wrap gap-3 pt-1">
                <Button type="submit" disabled={submitting || savingDraft || !selectedTypeId || !claimPeriod} className="flex-1 sm:flex-none sm:min-w-44">
                  {submitting ? "Submitting…" : editingApp?.status === "DRAFT" ? "Submit Draft" : editingApp?.status === "REJECTED" ? "Resubmit Claim" : `Submit ${FORM_LABELS[formType ?? ""] ?? "Claim"}`}
                </Button>
                {(!editingApp || editingApp.status === "DRAFT") && (
                  <Button type="button" variant="outline" disabled={submitting || savingDraft || !selectedTypeId} onClick={handleSaveDraft} className="flex-1 sm:flex-none">
                    {savingDraft ? "Saving…" : "Save as Draft"}
                  </Button>
                )}
                <Button type="button" variant="outline" disabled={submitting || savingDraft} onClick={() => { resetForm(); setSubmitOpen(false); }}>Cancel</Button>
              </div>
            )}
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
