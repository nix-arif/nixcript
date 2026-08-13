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
import type { TravelFormWithDetails } from "@/server/travel-form";
import { approveTravelForm, rejectTravelForm } from "@/server/travel-form";
import { formatTravelItinerary, travelPurposesSummary, groupTravelJourneys } from "@/lib/travel/itinerary";
import { TRAVEL_MODE_LABELS } from "@/lib/claim/constants";
import {
  CheckIcon, XIcon, FileDownIcon, CheckCircle2Icon, RouteIcon,
} from "lucide-react";

interface Props {
  travelForms: TravelFormWithDetails[];
  permissions: string[];
}

export function TravelApprovalsClient({ travelForms, permissions: _permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [approveTarget, setApproveTarget] = useState<TravelFormWithDetails | null>(null);
  const [approveComment, setApproveComment] = useState("");
  const [approving, setApproving] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<TravelFormWithDetails | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function handleApprove() {
    if (!approveTarget) return;
    setApproving(true);
    try {
      await approveTravelForm(approveTarget.id, approveComment.trim() || undefined);
      toast.success(`Travel form approved for ${approveTarget.applicantName ?? "applicant"}`);
      setApproveTarget(null);
      setApproveComment("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { toast.error("Please provide a rejection reason"); return; }
    setRejecting(true);
    try {
      await rejectTravelForm(rejectTarget.id, rejectReason.trim());
      toast.success(`Travel form rejected for ${rejectTarget.applicantName ?? "applicant"}`);
      setRejectTarget(null);
      setRejectReason("");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-muted-foreground"/>
            Travel Approvals
          </h1>
          <p className="text-sm text-muted-foreground">Review and action pending travel authorization requests.</p>
        </div>
        {travelForms.length > 0 && (
          <Badge className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
            {travelForms.length} pending
          </Badge>
        )}
      </div>

      {travelForms.length === 0 ? (
        <div className="rounded-lg border border-border py-16 flex flex-col items-center gap-3 text-center">
          <CheckCircle2Icon className="h-10 w-10 text-green-400"/>
          <div>
            <p className="font-semibold text-foreground">All caught up!</p>
            <p className="text-sm text-muted-foreground mt-0.5">No pending travel forms at this time.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-44">Applicant</TableHead>
                <TableHead className="max-w-2xs">Itinerary</TableHead>
                <TableHead className="w-44">Dates</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead className="w-36 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {travelForms.map(f => (
                <TableRow key={f.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium leading-snug">{f.applicantName ?? "Unknown"}</span>
                      <span className="font-mono text-xs text-muted-foreground">{f.applicationNo}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-2xs">
                    <p className="text-sm font-medium truncate" title={formatTravelItinerary(f.stops)}>{formatTravelItinerary(f.stops)}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {f.stops.length > 1 && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{f.stops.length} legs</Badge>
                      )}
                      {f.documents.length > 0 && (
                        <a href={`/api/travel-form/download/${f.documents[0].fileKey}`} target="_blank" rel="noopener noreferrer" title={`Download: ${f.documents[0].fileName}`}>
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-blue-600 border-blue-200 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:border-blue-700 cursor-pointer gap-1">
                            <FileDownIcon className="h-2.5 w-2.5"/>Doc
                          </Badge>
                        </a>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {f.startDate}{f.startDate !== f.endDate && <> → {f.endDate}</>}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <p className="text-sm text-muted-foreground truncate" title={travelPurposesSummary(f.stops)}>{travelPurposesSummary(f.stops)}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button size="sm" className="h-7 gap-1 bg-green-600 hover:bg-green-700 text-white text-xs" onClick={() => { setApproveTarget(f); setApproveComment(""); }}>
                        <CheckIcon className="h-3 w-3"/>Approve
                      </Button>
                      <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={() => { setRejectTarget(f); setRejectReason(""); }}>
                        <XIcon className="h-3 w-3"/>Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Approve Sheet */}
      <Sheet open={!!approveTarget} onOpenChange={open => !open && setApproveTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5"><SheetTitle>Approve Travel Form</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 border border-border p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Applicant</span><span className="font-medium">{approveTarget?.applicantName ?? "—"}</span></div>
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-xs">Itinerary</span>
                {groupTravelJourneys(approveTarget?.stops ?? []).map((group, gi, groups) => (
                  <div key={group.startIdx} className="flex flex-col gap-1">
                    {groups.length > 1 && <span className="text-[10px] font-semibold text-muted-foreground">Journey {gi + 1}</span>}
                    {group.stops.map((s, i) => (
                      <div key={s.id} className="rounded border border-border/60 bg-background px-2 py-1 flex flex-col gap-0.5">
                        <div className="text-xs flex items-center justify-between gap-2">
                          <span className="text-muted-foreground shrink-0">#{i + 1} {s.stopDate}</span>
                          <span className="font-medium truncate">{s.fromLocation} → {s.toLocation}</span>
                          <span className="text-muted-foreground shrink-0">{s.mode ? TRAVEL_MODE_LABELS[s.mode] : ""}{s.estimatedCost ? ` · RM${s.estimatedCost}` : ""}</span>
                        </div>
                        <p className="text-xs text-muted-foreground italic">{s.purpose}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dates</span>
                <span className="font-medium">{approveTarget?.startDate}{approveTarget?.startDate !== approveTarget?.endDate && <> → {approveTarget?.endDate}</>}</span>
              </div>
              {approveTarget?.estimatedCost && (
                <div className="flex justify-between"><span className="text-muted-foreground">Est. Cost</span><span className="font-medium">RM {approveTarget.estimatedCost}</span></div>
              )}
              {approveTarget?.notes && (
                <div className="flex justify-between gap-4"><span className="text-muted-foreground shrink-0">Notes</span><span className="text-right">{approveTarget.notes}</span></div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="approveComment">Comment <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Textarea id="approveComment" value={approveComment} onChange={e => setApproveComment(e.target.value)} placeholder="Add an optional comment…" rows={3}/>
            </div>
            <div className="flex gap-2 pt-2">
              <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleApprove} disabled={approving}>
                {approving ? "Approving…" : "Approve"}
              </Button>
              <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={approving}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Reject Sheet */}
      <Sheet open={!!rejectTarget} onOpenChange={open => !open && setRejectTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5"><SheetTitle>Reject Travel Form</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 border border-border p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Applicant</span><span className="font-medium">{rejectTarget?.applicantName ?? "—"}</span></div>
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-xs">Itinerary</span>
                {groupTravelJourneys(rejectTarget?.stops ?? []).map((group, gi, groups) => (
                  <div key={group.startIdx} className="flex flex-col gap-1">
                    {groups.length > 1 && <span className="text-[10px] font-semibold text-muted-foreground">Journey {gi + 1}</span>}
                    {group.stops.map((s, i) => (
                      <div key={s.id} className="rounded border border-border/60 bg-background px-2 py-1 flex flex-col gap-0.5">
                        <div className="text-xs flex items-center justify-between gap-2">
                          <span className="text-muted-foreground shrink-0">#{i + 1} {s.stopDate}</span>
                          <span className="font-medium truncate">{s.fromLocation} → {s.toLocation}</span>
                          <span className="text-muted-foreground shrink-0">{s.mode ? TRAVEL_MODE_LABELS[s.mode] : ""}{s.estimatedCost ? ` · RM${s.estimatedCost}` : ""}</span>
                        </div>
                        <p className="text-xs text-muted-foreground italic">{s.purpose}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {rejectTarget?.notes && (
                <div className="flex justify-between gap-4"><span className="text-muted-foreground shrink-0">Notes</span><span className="text-right">{rejectTarget.notes}</span></div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rejectReason">Rejection Reason <span className="text-destructive">*</span></Label>
              <Textarea id="rejectReason" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Provide a reason (required)…" rows={3} required/>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="destructive" className="flex-1" onClick={handleReject} disabled={rejecting || !rejectReason.trim()}>
                {rejecting ? "Rejecting…" : "Reject"}
              </Button>
              <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={rejecting}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
