"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ClaimApplicationWithDetails } from "@/server/claim";
import {
  checkClaim, rejectByChecker,
  editClaimLineItem, toggleClaimLineItemSlash,
  editClaimEntertainmentDetail, toggleClaimEntertainmentDetailSlash,
} from "@/server/claim";
import { CLAIM_FORM, LINE_CATEGORY } from "@/lib/claim/constants";
import { cn } from "@/lib/utils";
import {
  CheckIcon, XIcon, FileDownIcon, ClipboardListIcon,
  ArrowRightIcon, MapPinIcon, EyeIcon, CheckCircle2Icon, PencilIcon, PrinterIcon,
} from "lucide-react";
import { EditBadge, SlashBadge } from "@/components/claim/line-item-annotations";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmount(v: string | number): string {
  return `RM ${parseFloat(String(v)).toFixed(2)}`;
}

function fmtClaimDate(claimDate: string, formType: string | null): string {
  if ((formType === CLAIM_FORM.LOCAL || formType === CLAIM_FORM.OVERSEAS) && /^\d{4}-\d{2}-01$/.test(claimDate)) {
    const [year, month] = claimDate.split("-");
    return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" });
  }
  return claimDate;
}

function getFormType(app: ClaimApplicationWithDetails): string | null {
  if (app.entertainmentDetails && app.entertainmentDetails.length > 0) return CLAIM_FORM.ENTERTAINMENT_FORM;
  if (app.lineItems.length === 0) return null;
  const cat = app.lineItems[0].category;
  if (cat.startsWith("OVERSEAS")) return CLAIM_FORM.OVERSEAS;
  return CLAIM_FORM.LOCAL;
}

const FORM_LABELS: Record<string, string> = {
  LOCAL: "Local Reimbursement",
  OVERSEAS: "Overseas Expenses",
  ENTERTAINMENT_FORM: "Entertainment",
};

const SECTION_LABELS: Record<string, string> = {
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

// ── Line Item Detail ──────────────────────────────────────────────────────────

type LineItem = ClaimApplicationWithDetails["lineItems"][number];

function LineItemRow({
  item, i, cat, editable, saving, onSaveEdit, onToggleSlash,
}: {
  item: LineItem;
  i: number;
  cat: string;
  editable: boolean;
  saving: boolean;
  onSaveEdit: (item: LineItem, patch: { amountMyr?: string; description?: string }, reason: string) => Promise<void>;
  onToggleSlash: (item: LineItem, reason?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState(item.amountMyr);
  const [draftDescription, setDraftDescription] = useState(item.description ?? "");
  const [editReason, setEditReason] = useState("");
  const [slashPrompt, setSlashPrompt] = useState(false);
  const [slashReason, setSlashReason] = useState("");

  const canEditDescription = cat !== LINE_CATEGORY.TRAVEL && cat !== LINE_CATEGORY.OVERSEAS_FX;
  const arCls = item.slashed ? "line-through opacity-50" : "";

  async function handleSave() {
    const patch: { amountMyr?: string; description?: string } = {};
    if (draftAmount !== item.amountMyr) patch.amountMyr = draftAmount;
    if (canEditDescription && draftDescription !== (item.description ?? "")) patch.description = draftDescription;
    if (Object.keys(patch).length === 0) { setEditing(false); return; }
    await onSaveEdit(item, patch, editReason);
    setEditing(false); setEditReason("");
  }

  return (
    <div className="px-3 py-2.5 flex flex-col gap-1 text-xs">
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground w-4 shrink-0">{i + 1}.</span>
        <div className={cn("flex-1 flex flex-col gap-0.5 min-w-0", arCls)}>
          {cat === LINE_CATEGORY.TRAVEL ? (
            <div className="flex items-center gap-1 text-foreground font-medium">
              <MapPinIcon className="h-3 w-3 text-muted-foreground shrink-0"/>
              <span className="truncate">{item.fromLocation}</span>
              <ArrowRightIcon className="h-3 w-3 text-muted-foreground shrink-0"/>
              <span className="truncate">{item.toLocation}</span>
            </div>
          ) : cat === LINE_CATEGORY.OVERSEAS_FX ? (
            <div className="text-foreground font-medium">
              {item.destination && <span className="mr-1">{item.destination}</span>}
              <span className="text-muted-foreground">{item.amountForeign} {item.currency} × {item.exchangeRate}</span>
            </div>
          ) : editing && canEditDescription ? (
            <input
              value={draftDescription}
              onChange={e => setDraftDescription(e.target.value)}
              className="w-full h-6 border border-input rounded px-1.5 text-xs bg-background"
              placeholder="Description"
            />
          ) : (
            <span className="text-foreground font-medium truncate">
              {item.venue
                ? `${item.venue}${item.description ? ` — ${item.description}` : ""}`
                : item.destination
                  ? `${item.destination}${item.description ? ` — ${item.description}` : ""}`
                  : item.description}
            </span>
          )}
          <span className="text-muted-foreground">
            {item.lineDate}
            {cat === LINE_CATEGORY.TRAVEL && item.distanceKm && ` · ${item.distanceKm} km`}
          </span>
        </div>
        {editing ? (
          <input
            type="number"
            step="0.01"
            value={draftAmount}
            onChange={e => setDraftAmount(e.target.value)}
            className="w-20 h-6 border border-input rounded px-1.5 text-xs bg-background text-right shrink-0"
          />
        ) : (
          <span className={cn("text-green-700 dark:text-green-400 font-medium shrink-0", arCls)}>{fmtAmount(item.amountMyr)}</span>
        )}
        {editable && !editing && (
          <button type="button" onClick={() => { setDraftAmount(item.amountMyr); setDraftDescription(item.description ?? ""); setEditing(true); }} className="text-muted-foreground hover:text-amber-600 shrink-0" title="Edit this line">
            <PencilIcon className="h-3 w-3"/>
          </button>
        )}
        {editable && (
          <button
            type="button"
            disabled={saving}
            onClick={() => item.slashed ? void onToggleSlash(item) : setSlashPrompt(true)}
            className={cn("shrink-0 disabled:opacity-50", item.slashed ? "text-red-500" : "text-muted-foreground hover:text-red-500")}
            title={item.slashed ? "Un-slash this line" : "Slash this line"}
          >
            <XIcon className="h-3 w-3"/>
          </button>
        )}
      </div>

      {editing && (
        <div className="pl-6 flex flex-col gap-1.5">
          <Textarea value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="Reason for edit (required)…" rows={2} className="text-xs"/>
          <div className="flex gap-1.5">
            <Button size="sm" className="h-6 text-[11px] px-2" disabled={saving || !editReason.trim()} onClick={handleSave}>Save</Button>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" disabled={saving} onClick={() => { setEditing(false); setEditReason(""); }}>Cancel</Button>
          </div>
        </div>
      )}

      {slashPrompt && (
        <div className="pl-6 flex flex-col gap-1.5">
          <Textarea value={slashReason} onChange={e => setSlashReason(e.target.value)} placeholder="Reason for slashing this line (required)…" rows={2} className="text-xs"/>
          <div className="flex gap-1.5">
            <Button
              size="sm" variant="destructive" className="h-6 text-[11px] px-2"
              disabled={saving || !slashReason.trim()}
              onClick={async () => { await onToggleSlash(item, slashReason); setSlashPrompt(false); setSlashReason(""); }}
            >
              Slash
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" disabled={saving} onClick={() => { setSlashPrompt(false); setSlashReason(""); }}>Cancel</Button>
          </div>
        </div>
      )}

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
}

function LineItemDetail({
  items, editable = false, savingId = null, onSaveEdit, onToggleSlash,
}: {
  items: ClaimApplicationWithDetails["lineItems"];
  editable?: boolean;
  savingId?: string | null;
  onSaveEdit?: (item: LineItem, patch: { amountMyr?: string; description?: string }, reason: string) => Promise<void>;
  onToggleSlash?: (item: LineItem, reason?: string) => Promise<void>;
}) {
  if (items.length === 0) return null;
  const groups: Record<string, typeof items> = {};
  for (const item of items) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  }
  return (
    <div className="rounded-md border border-border overflow-hidden">
      {Object.entries(groups).map(([cat, rows]) => {
        const subtotal = rows.reduce((s, r) => s + (r.slashed ? 0 : parseFloat(r.amountMyr)), 0);
        return (
          <div key={cat}>
            <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">{SECTION_LABELS[cat] ?? cat}</span>
              <span className="text-xs font-semibold">{fmtAmount(subtotal)}</span>
            </div>
            <div className="divide-y divide-border">
              {rows.map((item, i) => (
                <LineItemRow
                  key={item.id}
                  item={item}
                  i={i}
                  cat={cat}
                  editable={editable}
                  saving={savingId === item.id}
                  onSaveEdit={onSaveEdit ?? (async () => {})}
                  onToggleSlash={onToggleSlash ?? (async () => {})}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Documents Section ─────────────────────────────────────────────────────────

function DocumentsSection({ documents }: { documents: ClaimApplicationWithDetails["documents"] }) {
  if (documents.length === 0) return <p className="text-xs text-muted-foreground italic">No documents attached.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {documents.map((doc) => (
        <a
          key={doc.id}
          href={`/api/claim/download/${doc.fileKey}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted/50 transition-colors group"
        >
          <FileDownIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary"/>
          <span className="flex-1 truncate text-foreground font-medium">{doc.fileName}</span>
          <span className="text-muted-foreground shrink-0">{doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)} KB` : ""}</span>
          <span className="text-blue-600 dark:text-blue-400 shrink-0 font-medium">Download</span>
        </a>
      ))}
    </div>
  );
}

// ── Claim Detail Content ──────────────────────────────────────────────────────

// ── Entertainment Detail Row ────────────────────────────────────────────────────

type EntertainmentDetail = ClaimApplicationWithDetails["entertainmentDetails"][number];

function EntertainmentDetailRow({
  ed, idx, showLabel, editable, saving, onSaveEdit, onToggleSlash,
}: {
  ed: EntertainmentDetail;
  idx: number;
  showLabel: boolean;
  editable: boolean;
  saving: boolean;
  onSaveEdit: (item: EntertainmentDetail, patch: { amount?: string; purpose?: string }, reason: string) => Promise<void>;
  onToggleSlash: (item: EntertainmentDetail, reason?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState(ed.amount);
  const [draftPurpose, setDraftPurpose] = useState(ed.purpose);
  const [editReason, setEditReason] = useState("");
  const [slashPrompt, setSlashPrompt] = useState(false);
  const [slashReason, setSlashReason] = useState("");
  const arCls = ed.slashed ? "line-through opacity-50" : "";

  async function handleSave() {
    const patch: { amount?: string; purpose?: string } = {};
    if (draftAmount !== ed.amount) patch.amount = draftAmount;
    if (draftPurpose !== ed.purpose) patch.purpose = draftPurpose;
    if (Object.keys(patch).length === 0) { setEditing(false); return; }
    await onSaveEdit(ed, patch, editReason);
    setEditing(false); setEditReason("");
  }

  return (
    <div className="divide-y divide-border border-t border-border first:border-t-0">
      <div className="px-3 py-1.5 bg-muted/20 flex items-center justify-between">
        {showLabel ? (
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Entry {idx + 1}</span>
        ) : <span/>}
        {editable && (
          <div className="flex items-center gap-1.5">
            {!editing && (
              <button type="button" onClick={() => { setDraftAmount(ed.amount); setDraftPurpose(ed.purpose); setEditing(true); }} className="text-muted-foreground hover:text-amber-600" title="Edit this entry">
                <PencilIcon className="h-3 w-3"/>
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => ed.slashed ? void onToggleSlash(ed) : setSlashPrompt(true)}
              className={cn("disabled:opacity-50", ed.slashed ? "text-red-500" : "text-muted-foreground hover:text-red-500")}
              title={ed.slashed ? "Un-slash this entry" : "Slash this entry"}
            >
              <XIcon className="h-3 w-3"/>
            </button>
          </div>
        )}
      </div>
      {[
        ["Date", ed.eventDate],
        ["Restaurant / Venue", ed.restaurantName],
        ["Customer", ed.customerName],
        ["Dept & Org", ed.departmentOrganization],
      ].map(([label, value]) => (
        <div key={label} className={cn("px-3 py-2 flex justify-between gap-4", arCls)}>
          <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
          <span className="text-right text-xs font-medium">{value}</span>
        </div>
      ))}
      <div className="px-3 py-2 flex justify-between gap-4 items-center">
        <span className="text-muted-foreground shrink-0 text-xs">Purpose</span>
        {editing ? (
          <input value={draftPurpose} onChange={e => setDraftPurpose(e.target.value)} className="flex-1 h-6 border border-input rounded px-1.5 text-xs bg-background text-right"/>
        ) : (
          <span className={cn("text-right text-xs font-medium", arCls)}>{ed.purpose}</span>
        )}
      </div>
      <div className="px-3 py-2 flex justify-between gap-4 items-center">
        <span className="text-muted-foreground shrink-0 text-xs">Amount</span>
        {editing ? (
          <input type="number" step="0.01" value={draftAmount} onChange={e => setDraftAmount(e.target.value)} className="w-24 h-6 border border-input rounded px-1.5 text-xs bg-background text-right"/>
        ) : (
          <span className={cn("text-right text-xs font-medium", arCls)}>{fmtAmount(ed.amount)}</span>
        )}
      </div>

      {editing && (
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <Textarea value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="Reason for edit (required)…" rows={2} className="text-xs"/>
          <div className="flex gap-1.5">
            <Button size="sm" className="h-6 text-[11px] px-2" disabled={saving || !editReason.trim()} onClick={handleSave}>Save</Button>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" disabled={saving} onClick={() => { setEditing(false); setEditReason(""); }}>Cancel</Button>
          </div>
        </div>
      )}
      {slashPrompt && (
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <Textarea value={slashReason} onChange={e => setSlashReason(e.target.value)} placeholder="Reason for slashing this entry (required)…" rows={2} className="text-xs"/>
          <div className="flex gap-1.5">
            <Button
              size="sm" variant="destructive" className="h-6 text-[11px] px-2"
              disabled={saving || !slashReason.trim()}
              onClick={async () => { await onToggleSlash(ed, slashReason); setSlashPrompt(false); setSlashReason(""); }}
            >
              Slash
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" disabled={saving} onClick={() => { setSlashPrompt(false); setSlashReason(""); }}>Cancel</Button>
          </div>
        </div>
      )}
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
}

function ClaimDetailContent({
  app, editable = false, savingId = null,
  onSaveLineEdit, onToggleLineSlash, onSaveEntEdit, onToggleEntSlash,
}: {
  app: ClaimApplicationWithDetails;
  editable?: boolean;
  savingId?: string | null;
  onSaveLineEdit?: (item: LineItem, patch: { amountMyr?: string; description?: string }, reason: string) => Promise<void>;
  onToggleLineSlash?: (item: LineItem, reason?: string) => Promise<void>;
  onSaveEntEdit?: (item: EntertainmentDetail, patch: { amount?: string; purpose?: string }, reason: string) => Promise<void>;
  onToggleEntSlash?: (item: EntertainmentDetail, reason?: string) => Promise<void>;
}) {
  const ft = getFormType(app);
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Applicant</span>
          <span className="font-medium">{app.applicantName ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Ref No.</span>
          <span className="font-mono text-xs font-medium">{app.applicationNo}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Claim type</span>
          <span className="font-medium">{app.claimTypeName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Period / Date</span>
          <span className="font-medium">{fmtClaimDate(app.claimDate, ft)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Amount</span>
          <span className="font-bold text-green-700 dark:text-green-400">{fmtAmount(app.amount)}</span>
        </div>
        {app.description && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Note</span>
            <span className="text-right text-xs">{app.description}</span>
          </div>
        )}
      </div>
      {app.lineItems.length > 0 && (
        <LineItemDetail
          items={app.lineItems}
          editable={editable}
          savingId={savingId}
          onSaveEdit={onSaveLineEdit}
          onToggleSlash={onToggleLineSlash}
        />
      )}
      {app.entertainmentDetails && app.entertainmentDetails.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden text-sm">
          <div className="px-3 py-2 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground">
            Entertainment Details ({app.entertainmentDetails.length})
          </div>
          {app.entertainmentDetails.map((ed, idx) => (
            <EntertainmentDetailRow
              key={ed.id}
              ed={ed}
              idx={idx}
              showLabel={app.entertainmentDetails.length > 1}
              editable={editable}
              saving={savingId === ed.id}
              onSaveEdit={onSaveEntEdit ?? (async () => {})}
              onToggleSlash={onToggleEntSlash ?? (async () => {})}
            />
          ))}
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Receipts & Documents ({app.documents.length})
        </p>
        <DocumentsSection documents={app.documents}/>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  applications: ClaimApplicationWithDetails[];
}

export function ClaimCheckerClient({ applications }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [viewTarget, setViewTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [checkTarget, setCheckTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [checkComment, setCheckComment] = useState("");
  const [checking, setChecking] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  // Patches a single line/entertainment item into whichever open sheet(s) reference it,
  // so the checker sees the correction immediately without a full page reload.
  function patchLineItem(appId: string, itemId: string, patch: Partial<LineItem>, newTotal: string) {
    const updater = (prev: ClaimApplicationWithDetails | null) =>
      prev && prev.id === appId
        ? { ...prev, amount: newTotal, lineItems: prev.lineItems.map(li => (li.id === itemId ? { ...li, ...patch } : li)) }
        : prev;
    setViewTarget(updater);
    setCheckTarget(updater);
    setRejectTarget(updater);
  }

  function patchEntItem(appId: string, itemId: string, patch: Partial<EntertainmentDetail>, newTotal: string) {
    const updater = (prev: ClaimApplicationWithDetails | null) =>
      prev && prev.id === appId
        ? { ...prev, amount: newTotal, entertainmentDetails: prev.entertainmentDetails.map(ed => (ed.id === itemId ? { ...ed, ...patch } : ed)) }
        : prev;
    setViewTarget(updater);
    setCheckTarget(updater);
    setRejectTarget(updater);
  }

  async function handleSaveLineEdit(item: LineItem, patch: { amountMyr?: string; description?: string }, reason: string) {
    setSavingItemId(item.id);
    try {
      const result = await editClaimLineItem(item.id, patch, reason);
      patchLineItem(item.applicationId, item.id, {
        amountMyr: result.amountMyr,
        description: result.description,
        originalAmountMyr: item.originalAmountMyr ?? (patch.amountMyr !== undefined ? item.amountMyr : null),
        originalDescription: item.originalDescription ?? (patch.description !== undefined ? item.description : null),
        editedBy: "edited",
        editedByName: result.editedByName,
        editedAt: result.editedAt,
        editReason: reason,
      }, result.newTotal);
      toast.success("Line item updated");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to edit item");
    } finally { setSavingItemId(null); }
  }

  async function handleToggleLineSlash(item: LineItem, reason?: string) {
    setSavingItemId(item.id);
    try {
      const nowSlashed = !item.slashed;
      const result = await toggleClaimLineItemSlash(item.id, nowSlashed, reason);
      patchLineItem(item.applicationId, item.id, {
        slashed: nowSlashed,
        slashedByName: result.slashedByName,
        slashedAt: result.slashedAt,
        slashReason: nowSlashed ? (reason?.trim() ?? null) : null,
      }, result.newTotal);
      toast.success(nowSlashed ? "Line item slashed" : "Slash cleared");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update item");
    } finally { setSavingItemId(null); }
  }

  async function handleSaveEntEdit(item: EntertainmentDetail, patch: { amount?: string; purpose?: string }, reason: string) {
    setSavingItemId(item.id);
    try {
      const result = await editClaimEntertainmentDetail(item.id, patch, reason);
      patchEntItem(item.applicationId, item.id, {
        amount: result.amount,
        purpose: result.purpose,
        originalAmount: item.originalAmount ?? (patch.amount !== undefined ? item.amount : null),
        originalPurpose: item.originalPurpose ?? (patch.purpose !== undefined ? item.purpose : null),
        editedBy: "edited",
        editedByName: result.editedByName,
        editedAt: result.editedAt,
        editReason: reason,
      }, result.newTotal);
      toast.success("Entry updated");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to edit entry");
    } finally { setSavingItemId(null); }
  }

  async function handleToggleEntSlash(item: EntertainmentDetail, reason?: string) {
    setSavingItemId(item.id);
    try {
      const nowSlashed = !item.slashed;
      const result = await toggleClaimEntertainmentDetailSlash(item.id, nowSlashed, reason);
      patchEntItem(item.applicationId, item.id, {
        slashed: nowSlashed,
        slashedByName: result.slashedByName,
        slashedAt: result.slashedAt,
        slashReason: nowSlashed ? (reason?.trim() ?? null) : null,
      }, result.newTotal);
      toast.success(nowSlashed ? "Entry slashed" : "Slash cleared");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update entry");
    } finally { setSavingItemId(null); }
  }

  async function handleCheck() {
    if (!checkTarget) return;
    setChecking(true);
    try {
      await checkClaim(checkTarget.id, checkComment.trim() || undefined);
      toast.success(`Claim checked — forwarded to approver`);
      setCheckTarget(null); setCheckComment("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to check");
    } finally { setChecking(false); }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { toast.error("Please provide a rejection reason"); return; }
    setRejecting(true);
    try {
      await rejectByChecker(rejectTarget.id, rejectReason.trim());
      toast.success(`Claim rejected and returned to submitter`);
      setRejectTarget(null); setRejectReason("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    } finally { setRejecting(false); }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ClipboardListIcon className="h-5 w-5 text-muted-foreground"/>Claim Checker
          </h1>
          <p className="text-sm text-muted-foreground">First-level review before forwarding to approver.</p>
        </div>
        {applications.length > 0 && (
          <Badge className="bg-blue-100 text-blue-800 border border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700">
            {applications.length} pending
          </Badge>
        )}
      </div>

      {applications.length === 0 ? (
        <div className="rounded-lg border border-border py-16 flex flex-col items-center gap-3 text-center">
          <CheckCircle2Icon className="h-10 w-10 text-green-400"/>
          <div>
            <p className="font-semibold text-foreground">All caught up!</p>
            <p className="text-sm text-muted-foreground mt-0.5">No pending claims to check.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-40">Applicant</TableHead>
                <TableHead>Claim Type</TableHead>
                <TableHead className="w-32">Period / Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-28 text-right">Amount</TableHead>
                <TableHead className="w-44 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map(app => {
                const ft = getFormType(app);
                return (
                  <TableRow key={app.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium leading-snug">{app.applicantName ?? "Unknown"}</span>
                        <span className="font-mono text-xs text-muted-foreground">{app.applicationNo}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium">{app.claimTypeName}</span>
                        {ft && <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{FORM_LABELS[ft] ?? ft}</Badge>}
                        {app.lineItems.length > 0 && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{app.lineItems.length} items</Badge>
                        )}
                        {app.documents.length > 0 && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-blue-600 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-700 gap-1">
                            <FileDownIcon className="h-2.5 w-2.5"/>{app.documents.length} doc{app.documents.length > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {fmtClaimDate(app.claimDate, ft)}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <p className="text-sm text-muted-foreground truncate" title={app.description ?? ""}>{app.description}</p>
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold">{fmtAmount(app.amount)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setViewTarget(app)}>
                          <EyeIcon className="h-3 w-3"/>View
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="Download PDF" asChild>
                          <a href={`/api/claim/${app.id}/pdf`} target="_blank" rel="noopener noreferrer">
                            <PrinterIcon className="h-3 w-3"/>
                          </a>
                        </Button>
                        <Button size="sm" className="h-7 gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs" onClick={() => { setCheckTarget(app); setCheckComment(""); }}>
                          <CheckIcon className="h-3 w-3"/>Check
                        </Button>
                        <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={() => { setRejectTarget(app); setRejectReason(""); }}>
                          <XIcon className="h-3 w-3"/>Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* View Sheet */}
      <Sheet open={!!viewTarget} onOpenChange={open => !open && setViewTarget(null)}>
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Claim Details</SheetTitle></SheetHeader>
          {viewTarget && (
            <ClaimDetailContent
              app={viewTarget}
              editable
              savingId={savingItemId}
              onSaveLineEdit={handleSaveLineEdit}
              onToggleLineSlash={handleToggleLineSlash}
              onSaveEntEdit={handleSaveEntEdit}
              onToggleEntSlash={handleToggleEntSlash}
            />
          )}
          <div className="flex gap-2 pt-6">
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => { setCheckTarget(viewTarget); setCheckComment(""); setViewTarget(null); }}
            >
              <CheckIcon className="h-3.5 w-3.5 mr-1.5"/>Check & Forward
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => { setRejectTarget(viewTarget); setRejectReason(""); setViewTarget(null); }}
            >
              <XIcon className="h-3.5 w-3.5 mr-1.5"/>Reject
            </Button>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Check Sheet */}
      <Sheet open={!!checkTarget} onOpenChange={open => !open && setCheckTarget(null)}>
        <SheetContent className="w-full sm:max-w-xl max-w-full! overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Check Claim</SheetTitle></SheetHeader>
          {checkTarget && (
            <div className="space-y-4">
              <ClaimDetailContent
                app={checkTarget}
                editable
                savingId={savingItemId}
                onSaveLineEdit={handleSaveLineEdit}
                onToggleLineSlash={handleToggleLineSlash}
                onSaveEntEdit={handleSaveEntEdit}
                onToggleEntSlash={handleToggleEntSlash}
              />
              <div className="space-y-1.5">
                <Label htmlFor="checkComment">Comment <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                <Textarea id="checkComment" value={checkComment} onChange={e => setCheckComment(e.target.value)} placeholder="Add an optional note for the approver…" rows={3}/>
              </div>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleCheck} disabled={checking}>
                  {checking ? "Forwarding…" : "Check & Forward to Approver"}
                </Button>
                <Button variant="outline" onClick={() => setCheckTarget(null)} disabled={checking}>Cancel</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Reject Sheet */}
      <Sheet open={!!rejectTarget} onOpenChange={open => !open && setRejectTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5"><SheetTitle>Reject Claim</SheetTitle></SheetHeader>
          {rejectTarget && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 border border-border p-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Applicant</span>
                  <span className="font-medium">{rejectTarget.applicantName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Claim type</span>
                  <span className="font-medium">{rejectTarget.claimTypeName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">{fmtAmount(rejectTarget.amount)}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rejectReason">Rejection Reason <span className="text-destructive">*</span></Label>
                <Textarea id="rejectReason" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Provide a reason for rejection (required)…" rows={3} required/>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="destructive" className="flex-1" onClick={handleReject} disabled={rejecting || !rejectReason.trim()}>
                  {rejecting ? "Rejecting…" : "Reject Claim"}
                </Button>
                <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={rejecting}>Cancel</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
