"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { TravelFormWithDetails } from "@/server/travel-form";
import { cancelTravelForm } from "@/server/travel-form";
import { formatTravelItinerary, travelPurposesSummary } from "@/lib/travel/itinerary";
import {
  PlusIcon, FileDownIcon, XIcon, RouteIcon, AlertTriangleIcon, PencilIcon,
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT:     "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-600",
    PENDING:   "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
    APPROVED:  "bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700",
    REJECTED:  "bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700",
    CANCELLED: "bg-muted text-muted-foreground border-border hover:bg-muted",
  };
  const labels: Record<string, string> = { DRAFT: "Draft", PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" };
  return <Badge className={`border text-xs ${map[status] ?? "border-border"}`}>{labels[status] ?? status}</Badge>;
}

interface Props {
  travelForms: TravelFormWithDetails[];
  permissions: string[];
}

export function MyTravelClient({ travelForms, permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cancelTarget, setCancelTarget] = useState<TravelFormWithDetails | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const canApply = permissions.includes("travel:apply") || permissions.includes("*");

  async function handleCancel() {
    if (!cancelTarget) return;
    const isDraft = cancelTarget.status === "DRAFT";
    setCancelling(true);
    try {
      await cancelTravelForm(cancelTarget.id);
      toast.success(isDraft ? "Draft deleted" : "Travel form cancelled");
      setCancelTarget(null);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : (isDraft ? "Failed to delete draft" : "Failed to cancel"));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-muted-foreground"/>
            My Travel Forms
          </h1>
          <p className="text-sm text-muted-foreground">
            Request travel authorization before going outstation. Once approved, it can be pulled into an expense claim.
          </p>
        </div>
        {canApply && (
          <Link href="/dashboard/human-resources/travel/apply">
            <Button size="sm"><PlusIcon className="h-4 w-4 mr-1"/>New Travel Form</Button>
          </Link>
        )}
      </div>

      {travelForms.length === 0 ? (
        <div className="rounded-lg border border-border py-10 text-center text-sm text-muted-foreground">
          No travel forms submitted yet.{" "}
          {canApply && <Link href="/dashboard/human-resources/travel/apply" className="text-primary hover:underline">Submit one</Link>}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-32">Ref No.</TableHead>
                <TableHead className="max-w-2xs">Itinerary</TableHead>
                <TableHead className="w-44">Dates</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {travelForms.map(f => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{f.applicationNo}</TableCell>
                  <TableCell className="max-w-2xs">
                    <p className="text-sm font-medium truncate" title={formatTravelItinerary(f.stops)}>{formatTravelItinerary(f.stops)}</p>
                    {(f.stops.length > 1 || (f.status === "APPROVED" && f.claimedAt)) && (
                      <div className="flex items-center gap-1 mt-1">
                        {f.stops.length > 1 && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{f.stops.length} legs</Badge>
                        )}
                        {f.status === "APPROVED" && f.claimedAt && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-blue-600 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-700">
                            Claimed{f.claimApplicationNo ? ` · ${f.claimApplicationNo}` : ""}
                          </Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {f.startDate}{f.startDate !== f.endDate && <> → {f.endDate}</>}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <p className="text-sm text-muted-foreground truncate" title={travelPurposesSummary(f.stops)}>{travelPurposesSummary(f.stops)}</p>
                  </TableCell>
                  <TableCell><StatusBadge status={f.status}/></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {f.status === "DRAFT" && (
                        <Link href={`/dashboard/human-resources/travel/apply?draftId=${f.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Continue draft"><PencilIcon className="h-3.5 w-3.5"/></Button>
                        </Link>
                      )}
                      {f.documents.length > 0 && (
                        <a href={`/api/travel-form/download/${f.documents[0].fileKey}`} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Download document"><FileDownIcon className="h-3.5 w-3.5"/></Button>
                        </a>
                      )}
                      {(f.status === "DRAFT" || f.status === "PENDING" || (f.status === "APPROVED" && !f.claimedAt)) && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setCancelTarget(f)} title={f.status === "DRAFT" ? "Delete draft" : "Cancel"}>
                          <XIcon className="h-3.5 w-3.5"/>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={!!cancelTarget} onOpenChange={open => !open && setCancelTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>{cancelTarget?.status === "DRAFT" ? "Delete Draft" : "Cancel Travel Form"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-3">
              <AlertTriangleIcon className="h-4 w-4 text-destructive mt-0.5 shrink-0"/>
              <p className="text-sm text-destructive leading-relaxed">
                {cancelTarget?.status === "DRAFT"
                  ? <>Are you sure you want to delete this draft ({cancelTarget ? formatTravelItinerary(cancelTarget.stops) : ""})? This action cannot be undone.</>
                  : <>Are you sure you want to cancel <strong>{cancelTarget?.applicationNo}</strong> ({cancelTarget ? formatTravelItinerary(cancelTarget.stops) : ""})? This action cannot be undone.</>}
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="destructive" onClick={handleCancel} disabled={cancelling} className="flex-1">
                {cancelling ? "Working…" : cancelTarget?.status === "DRAFT" ? "Yes, Delete" : "Yes, Cancel"}
              </Button>
              <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>Keep</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
