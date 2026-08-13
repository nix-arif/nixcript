"use client";

import { useState, useRef, useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  applyForTravelForm, createTravelFormDocumentRecord, saveDraftTravelForm,
  updateDraftTravelForm, finalizeDraftTravelForm, deleteTravelFormDocument,
} from "@/server/travel-form";
import type { TravelStopInput, TravelFormWithDetails, TravelFormDocumentRow } from "@/server/travel-form";
import { travelLegLabel, groupTravelJourneys, isReturnLeg, effectiveLegPurpose } from "@/lib/travel/itinerary";
import { TRAVEL_MODE, TRAVEL_MODE_LABELS } from "@/lib/claim/constants";
import { ArrowLeftIcon, UploadIcon, XIcon, RouteIcon, LoaderIcon, InfoIcon, PlusIcon, Undo2Icon } from "lucide-react";

interface QueuedFile {
  file: File;
  id: string;
}

interface StopState {
  id: string;
  stopDate: string;
  fromLocation: string;
  toLocation: string;
  mode: string;
  purpose: string;
  distanceKm: string | null;
  estimatedCost: string;
  calculating: boolean;
  // Set only via "Add Separate Journey" — forces a new journey group even if
  // this leg's (default) From happens to match the previous leg's To, so a
  // deliberate "this is unconnected" click is never silently merged back
  // into the same journey by coincidence.
  journeyBreak: boolean;
}

interface Props {
  ratePerKm: number;
  draft?: TravelFormWithDetails;
}

let counter = 0;
function newId() {
  counter += 1;
  return `stop-${Date.now()}-${counter}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Default "From" for a brand-new journey — the common home base. "Add Stop"
// and "Add Return Leg" both overwrite this with the last leg's own location
// right after calling emptyStop(), so it only ever surfaces for the very
// first leg of the form or a freshly added separate journey.
const DEFAULT_FROM_LOCATION = "sunway kayangan";

function emptyStop(): StopState {
  return {
    id: newId(),
    stopDate: todayStr(),
    fromLocation: DEFAULT_FROM_LOCATION,
    toLocation: "",
    mode: TRAVEL_MODE.OWN_VEHICLE,
    purpose: "",
    distanceKm: null,
    estimatedCost: "",
    calculating: false,
    journeyBreak: false,
  };
}

function stopsFromDraft(draft: TravelFormWithDetails): StopState[] {
  if (draft.stops.length === 0) return [emptyStop()];
  return draft.stops.map(s => ({
    id: newId(),
    stopDate: s.stopDate,
    fromLocation: s.fromLocation,
    toLocation: s.toLocation,
    mode: s.mode,
    purpose: s.purpose,
    distanceKm: s.distanceKm,
    estimatedCost: s.estimatedCost ?? "",
    calculating: false,
    journeyBreak: s.journeyBreak,
  }));
}

export function ApplyTravelClient({ ratePerKm, draft }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Stable across server render and client hydration (unlike stop.id, which
  // is Date.now()-based and only safe for React keys / internal lookups —
  // never for DOM id/htmlFor, where a server/client mismatch would trigger
  // a hydration warning). Combined with each stop's array index below.
  const formId = useId();

  const [stops, setStops] = useState<StopState[]>(() => (draft ? stopsFromDraft(draft) : [emptyStop()]));
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [existingDocs, setExistingDocs] = useState<TravelFormDocumentRow[]>(draft?.documents ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  async function handleRemoveExistingDoc(docId: string) {
    try {
      await deleteTravelFormDocument(docId);
      setExistingDocs(prev => prev.filter(d => d.id !== docId));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to remove document");
    }
  }

  function updateStop(id: string, patch: Partial<StopState>) {
    setStops(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addStop() {
    setStops(prev => {
      const last = prev[prev.length - 1];
      const next = emptyStop();
      if (last) {
        next.fromLocation = last.toLocation;
        next.stopDate = last.stopDate;
        next.purpose = last.purpose;
      }
      return [...prev, next];
    });
  }

  function removeStop(id: string) {
    setStops(prev => (prev.length > 1 ? prev.filter(s => s.id !== id) : prev));
  }

  const journeyGroups = groupTravelJourneys(stops);
  const lastGroup = journeyGroups[journeyGroups.length - 1];
  const journeyOrigin = lastGroup?.stops[0]?.fromLocation ?? "";
  // True once the current journey has already looped back to where it
  // started — at that point "Add Stop" (continue the route) and "Add Return
  // Leg" (go back to the start) both stop making sense; only starting a
  // fresh, separate journey does.
  const journeyClosed = stops.length > 0 && isReturnLeg(stops, stops.length - 1);

  // Shortcut for the common case: heading back to where the current journey
  // started. From = last leg's destination, To = that journey's origin —
  // both already known, so the distance/cost lookup can fire immediately
  // instead of waiting for the user to blur the (already-filled) fields.
  // Its purpose is resolved automatically (see effectiveLegPurpose) rather
  // than asked for, since a return leg doesn't have one of its own.
  function addReturnLeg() {
    const last = stops[stops.length - 1];
    if (!last || !journeyOrigin.trim() || !last.toLocation.trim()) return;
    const next = emptyStop();
    next.fromLocation = last.toLocation;
    next.toLocation = journeyOrigin;
    next.stopDate = last.stopDate;
    setStops(prev => [...prev, next]);
    void calculateDistance(next.id, next.fromLocation, next.toLocation);
  }

  // For a trip that isn't a continuation of the current route (e.g. flew
  // home in between, then drove somewhere unrelated) — a blank leg with no
  // location or date carried over, marked journeyBreak so it always starts
  // its own journey even if its default From matches the last leg's To.
  function addJourney() {
    setStops(prev => [...prev, { ...emptyStop(), journeyBreak: true }]);
  }

  // Per-leg one-way mileage estimate via the same OpenStreetMap (Nominatim +
  // OSRM) lookup the expense claim form uses, at the org's LOCAL claim
  // rate/km. A return trip is just another stop the user adds, so this is
  // no longer doubled — each leg is calculated on its own.
  async function calculateDistance(stopId: string, from: string, to: string) {
    if (!from.trim() || !to.trim()) return;
    updateStop(stopId, { calculating: true });
    try {
      const res = await fetch("/api/claim/distance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Could not calculate distance"); return; }
      setStops(prev => prev.map(s => (s.id === stopId
        ? { ...s, distanceKm: String(data.distanceKm), estimatedCost: (data.distanceKm * ratePerKm).toFixed(2) }
        : s)));
    } catch {
      toast.error("Distance lookup failed");
    } finally {
      updateStop(stopId, { calculating: false });
    }
  }

  const isFormValid = stops.every((s, idx) =>
    s.fromLocation.trim() !== "" && s.toLocation.trim() !== "" && s.stopDate !== "" && s.mode.trim() !== "" &&
    (isReturnLeg(stops, idx) || s.purpose.trim() !== ""));

  const sortedDates = stops.map(s => s.stopDate).filter(Boolean).sort();
  const tripStart = sortedDates[0];
  const tripEnd = sortedDates[sortedDates.length - 1];
  const totalCost = stops.reduce((sum, s) => sum + (parseFloat(s.estimatedCost) || 0), 0);
  const hasAnyCost = stops.some(s => s.estimatedCost.trim() !== "");

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setQueuedFiles(prev => [...prev, ...files.map(f => ({ file: f, id: Math.random().toString(36).slice(2) }))]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function buildStopInputs(): TravelStopInput[] {
    return stops.map((s, idx) => ({
      stopDate: s.stopDate,
      fromLocation: s.fromLocation.trim(),
      toLocation: s.toLocation.trim(),
      journeyBreak: s.journeyBreak,
      mode: s.mode,
      purpose: effectiveLegPurpose(stops, idx),
      distanceKm: s.distanceKm || undefined,
      estimatedCost: s.estimatedCost.trim() || undefined,
    }));
  }

  async function uploadQueuedFiles(formId: string) {
    for (const qf of queuedFiles) {
      const res = await fetch("/api/travel-form/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          travelFormId: formId,
          fileName: qf.file.name,
          mimeType: qf.file.type || "application/octet-stream",
          fileSize: qf.file.size,
        }),
      });
      if (!res.ok) { toast.error(`Failed to get upload URL for ${qf.file.name}`); continue; }
      const { uploadUrl, key } = await res.json();
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: qf.file,
        headers: { "Content-Type": qf.file.type || "application/octet-stream" },
      });
      if (!uploadRes.ok) { toast.error(`Failed to upload ${qf.file.name}`); continue; }
      await createTravelFormDocumentRecord({
        travelFormId: formId,
        fileName: qf.file.name,
        fileKey: key,
        fileSize: qf.file.size,
        mimeType: qf.file.type || "application/octet-stream",
      });
    }
    setQueuedFiles([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid || submitting) return;
    setSubmitting(true);
    try {
      const stopInputs = buildStopInputs();
      const payload = { stops: stopInputs, notes: notes.trim() || undefined };
      const formId = draft ? draft.id : await applyForTravelForm(payload);
      if (draft) await finalizeDraftTravelForm(draft.id, payload);

      await uploadQueuedFiles(formId);

      toast.success("Travel form submitted for approval");
      startTransition(() => router.push("/dashboard/human-resources/travel"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit travel form");
    } finally {
      setSubmitting(false);
    }
  }

  // No completeness requirements — the whole point of a draft is to save
  // whatever's been filled in so far and finish it later.
  async function handleSaveDraft() {
    if (savingDraft) return;
    setSavingDraft(true);
    try {
      const stopInputs = buildStopInputs();
      const payload = { stops: stopInputs, notes: notes.trim() || undefined };
      const formId = draft ? draft.id : await saveDraftTravelForm(payload);
      if (draft) await updateDraftTravelForm(draft.id, payload);

      await uploadQueuedFiles(formId);

      toast.success("Draft saved");
      startTransition(() => router.push("/dashboard/human-resources/travel"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <Link href="/dashboard/human-resources/travel">
          <Button variant="ghost" size="icon" className="mt-0.5 shrink-0"><ArrowLeftIcon className="h-4 w-4"/></Button>
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-muted-foreground"/>
            {draft ? "Continue Draft" : "New Travel Form"}
          </h1>
          <p className="text-sm text-muted-foreground">Request authorization before your trip. Once approved, it can pre-fill your expense claim.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-2xl">
        <section className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Itinerary</h2>
            <span className="text-xs text-muted-foreground">{stops.length} {stops.length === 1 ? "stop" : "stops"}</span>
          </div>
          <div className="p-4 flex flex-col gap-4">
            {journeyGroups.map((group, gi) => (
              <div key={group.startIdx} className="flex flex-col gap-3">
                {journeyGroups.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">Journey {gi + 1}</span>
                    <span className="h-px flex-1 bg-border"/>
                  </div>
                )}
                {group.stops.map((stop, i) => {
                  const idx = group.startIdx + i;
                  return (
                    <div key={stop.id} className="rounded-md border border-border p-3 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">{travelLegLabel(stops, idx)}</span>
                        <Button
                          type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => removeStop(stop.id)} disabled={stops.length === 1}
                        >
                          <XIcon className="h-3.5 w-3.5"/>
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`${formId}-from-${idx}`}>From <span className="text-destructive">*</span></Label>
                          <input
                            id={`${formId}-from-${idx}`} value={stop.fromLocation}
                            onChange={e => updateStop(stop.id, { fromLocation: e.target.value, distanceKm: null })}
                            onBlur={e => { if (e.target.value.trim() && stop.toLocation.trim()) void calculateDistance(stop.id, e.target.value, stop.toLocation); }}
                            placeholder="e.g. Shah Alam" className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" required
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`${formId}-to-${idx}`}>To <span className="text-destructive">*</span></Label>
                          <input
                            id={`${formId}-to-${idx}`} value={stop.toLocation}
                            onChange={e => updateStop(stop.id, { toLocation: e.target.value, distanceKm: null })}
                            onBlur={e => { if (e.target.value.trim() && stop.fromLocation.trim()) void calculateDistance(stop.id, stop.fromLocation, e.target.value); }}
                            placeholder="e.g. Ipoh" className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" required
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`${formId}-date-${idx}`}>Date <span className="text-destructive">*</span></Label>
                          <input
                            type="date" id={`${formId}-date-${idx}`} value={stop.stopDate}
                            onChange={e => updateStop(stop.id, { stopDate: e.target.value })}
                            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" required
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`${formId}-mode-${idx}`}>Mode <span className="text-destructive">*</span></Label>
                          <Select value={stop.mode} onValueChange={v => updateStop(stop.id, { mode: v })}>
                            <SelectTrigger id={`${formId}-mode-${idx}`}><SelectValue placeholder="Select mode…"/></SelectTrigger>
                            <SelectContent>
                              {Object.entries(TRAVEL_MODE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`${formId}-cost-${idx}`} className="flex items-center gap-1.5">
                          Estimated Cost (RM)
                          {stop.calculating && <LoaderIcon className="h-3 w-3 animate-spin text-muted-foreground"/>}
                        </Label>
                        <input
                          type="text" id={`${formId}-cost-${idx}`} value={stop.estimatedCost} readOnly
                          placeholder="Auto-calculated from route" className="w-full border border-input rounded-md px-3 py-2 text-sm bg-muted cursor-not-allowed text-muted-foreground"
                        />
                        {stop.distanceKm && (
                          <p className="text-xs text-muted-foreground flex items-start gap-1">
                            <InfoIcon className="h-3 w-3 mt-0.5 shrink-0"/>
                            {stop.distanceKm} km × RM{ratePerKm.toFixed(2)}/km via OpenStreetMap routing
                          </p>
                        )}
                      </div>
                      {isReturnLeg(stops, idx) ? (
                        <p className="text-xs text-muted-foreground flex items-start gap-1">
                          <InfoIcon className="h-3 w-3 mt-0.5 shrink-0"/>
                          This leg just completes the trip back to {stop.toLocation || "the start"} — it uses the purpose of the leg before it, no separate purpose needed.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`${formId}-purpose-${idx}`}>Purpose of this leg <span className="text-destructive">*</span></Label>
                          <Textarea
                            id={`${formId}-purpose-${idx}`}
                            value={stop.purpose}
                            onChange={e => updateStop(stop.id, { purpose: e.target.value })}
                            placeholder="Briefly describe the purpose of this leg…" rows={2} required
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={addStop} disabled={journeyClosed} title={journeyClosed ? "This journey already ends back where it started — start a separate journey instead" : undefined}>
                <PlusIcon className="h-3.5 w-3.5"/>Add Stop
              </Button>
              <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={addReturnLeg} disabled={journeyClosed} title={journeyClosed ? "Already back at the start of this journey" : undefined}>
                <Undo2Icon className="h-3.5 w-3.5"/>Add Return Leg
              </Button>
              <Button type="button" variant={journeyClosed ? "default" : "outline"} size="sm" className="w-fit gap-1.5" onClick={addJourney}>
                <RouteIcon className="h-3.5 w-3.5"/>Add Separate Journey
              </Button>
            </div>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <InfoIcon className="h-3 w-3 mt-0.5 shrink-0"/>
              {journeyClosed ? (
                <span>This journey is complete — it ends back where it started. If you also travelled somewhere unrelated, use <strong className="text-foreground font-medium">Add Separate Journey</strong> to start a new one.</span>
              ) : (
                <span><strong className="text-foreground font-medium">Add Stop</strong> continues from where the last leg ends. <strong className="text-foreground font-medium">Add Return Leg</strong> heads back to where this journey started. <strong className="text-foreground font-medium">Add Separate Journey</strong> starts a blank leg for a trip that isn&apos;t connected to the one above.</span>
              )}
            </p>
            {tripStart && tripEnd && (
              <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>Trip: <strong className="text-foreground">{tripStart}</strong>{tripStart !== tripEnd && <> → <strong className="text-foreground">{tripEnd}</strong></>}</span>
                {hasAnyCost && <span>Total Estimated Cost: <strong className="text-foreground">RM {totalCost.toFixed(2)}</strong></span>}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 bg-muted/40 border-b border-border">
            <h2 className="text-sm font-semibold">Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></h2>
          </div>
          <div className="p-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes for the approver…" rows={2}/>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 bg-muted/40 border-b border-border">
            <h2 className="text-sm font-semibold">Supporting Document <span className="text-muted-foreground font-normal text-xs">(optional)</span></h2>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={handleFileChange} className="hidden"/>
            <Button type="button" variant="outline" size="sm" className="w-fit gap-2" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon className="h-4 w-4"/>Attach Files
            </Button>
            {existingDocs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {existingDocs.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium text-foreground">{doc.fileName}</span>
                      <span className="text-muted-foreground text-xs shrink-0">{(doc.fileSize / 1024).toFixed(0)} KB</span>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => void handleRemoveExistingDoc(doc.id)}>
                      <XIcon className="h-3 w-3"/>
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {queuedFiles.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {queuedFiles.map(qf => (
                  <div key={qf.id} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium text-foreground">{qf.file.name}</span>
                      <span className="text-muted-foreground text-xs shrink-0">{(qf.file.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => setQueuedFiles(prev => prev.filter(f => f.id !== qf.id))}>
                      <XIcon className="h-3 w-3"/>
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Accepted: PDF, JPG, PNG, DOC, DOCX — max 10 MB per file.</p>
          </div>
        </section>

        <div className="flex items-center gap-3 pt-1">
          <Link href="/dashboard/human-resources/travel">
            <Button type="button" variant="outline" disabled={submitting || savingDraft}>Cancel</Button>
          </Link>
          <Button type="button" variant="outline" disabled={submitting || savingDraft} onClick={handleSaveDraft}>
            {savingDraft ? "Saving…" : "Save as Draft"}
          </Button>
          <Button type="submit" disabled={!isFormValid || submitting || savingDraft}>
            {submitting ? "Submitting…" : draft ? "Submit Draft" : "Submit Travel Form"}
          </Button>
        </div>
      </form>
    </div>
  );
}
