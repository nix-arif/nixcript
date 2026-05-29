"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { ClaimApplicationWithDetails, ClaimTypeRow } from "@/server/claim";
import { cancelClaim } from "@/server/claim";
import { PlusIcon, FileDownIcon, XIcon, ReceiptIcon, AlertTriangleIcon } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtAmount(v: string | number): string {
  return `RM ${parseFloat(String(v)).toFixed(2)}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  MILEAGE: "Mileage",
  MEDICAL: "Medical",
  MEAL: "Meal",
  TRANSPORT: "Transport",
  OVERTIME: "Overtime",
  ENTERTAINMENT: "Entertainment",
  OTHER: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  MILEAGE: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700",
  MEDICAL: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-700",
  MEAL: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-700",
  TRANSPORT: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-700",
  OVERTIME: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700",
  ENTERTAINMENT: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/20 dark:text-pink-400 dark:border-pink-700",
  OTHER: "bg-muted text-muted-foreground border-border",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
    APPROVED: "bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700",
    REJECTED: "bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700",
    CANCELLED: "bg-muted text-muted-foreground border-border hover:bg-muted",
  };
  const labels: Record<string, string> = {
    PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled",
  };
  return (
    <Badge className={`border text-xs ${map[status] ?? "border-border"}`}>
      {labels[status] ?? status}
    </Badge>
  );
}

// ── Summary Cards ──────────────────────────────────────────────────────────

function SummaryCards({
  applications,
  claimTypes,
}: {
  applications: ClaimApplicationWithDetails[];
  claimTypes: ClaimTypeRow[];
}) {
  const year = new Date().getFullYear();
  const thisYear = applications.filter(
    (a) => new Date(a.createdAt).getFullYear() === year,
  );

  // Group by claim type
  const byType: Record<string, { type: ClaimTypeRow; approved: number; pending: number }> = {};
  for (const ct of claimTypes) {
    byType[ct.id] = { type: ct, approved: 0, pending: 0 };
  }
  for (const app of thisYear) {
    if (!byType[app.claimTypeId]) continue;
    const amt = parseFloat(app.amount);
    if (app.status === "APPROVED") byType[app.claimTypeId].approved += amt;
    if (app.status === "PENDING") byType[app.claimTypeId].pending += amt;
  }

  const cards = Object.values(byType).filter(
    (e) => e.approved > 0 || e.pending > 0,
  );
  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {cards.map(({ type, approved, pending }) => {
        const catColor = CATEGORY_COLORS[type.category] ?? CATEGORY_COLORS.OTHER;
        return (
          <div
            key={type.id}
            className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2"
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="font-mono text-xs px-1.5 py-0 h-5">
                {type.code}
              </Badge>
              <Badge variant="outline" className={`text-xs px-1.5 py-0 h-5 ${catColor}`}>
                {CATEGORY_LABELS[type.category] ?? type.category}
              </Badge>
            </div>
            <p className="text-sm font-semibold leading-snug">{type.name}</p>
            <div className="text-2xl font-bold leading-none text-green-700 dark:text-green-400">
              {fmtAmount(approved)}
              <span className="text-xs font-normal text-muted-foreground ml-1">approved</span>
            </div>
            {pending > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                + {fmtAmount(pending)} pending
              </p>
            )}
          </div>
        );
      })}
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
  const [cancelTarget, setCancelTarget] = useState<ClaimApplicationWithDetails | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const canApply = permissions.includes("claim:apply") || permissions.includes("*");

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
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5 text-muted-foreground" />
            My Claims
          </h1>
          <p className="text-sm text-muted-foreground">
            View your claim history and submission status.
          </p>
        </div>
        {canApply && (
          <Link href="/dashboard/human-resources/claim/apply">
            <Button size="sm">
              <PlusIcon className="h-4 w-4 mr-1" />
              New Claim
            </Button>
          </Link>
        )}
      </div>

      {/* Summary Cards */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Claims Summary — {new Date().getFullYear()}
        </h2>
        <SummaryCards applications={applications} claimTypes={claimTypes} />
        {applications.filter((a) => new Date(a.createdAt).getFullYear() === new Date().getFullYear() && (a.status === "APPROVED" || a.status === "PENDING")).length === 0 && (
          <div className="rounded-lg border border-border py-8 text-center text-sm text-muted-foreground">
            No claims submitted this year yet.
          </div>
        )}
      </div>

      {/* History Table */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Claim History
        </h2>
        {applications.length === 0 ? (
          <div className="rounded-lg border border-border py-10 text-center text-sm text-muted-foreground">
            No claims submitted yet.{" "}
            {canApply && (
              <Link
                href="/dashboard/human-resources/claim/apply"
                className="text-primary hover:underline"
              >
                Submit a claim
              </Link>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-32.5">Ref No.</TableHead>
                  <TableHead>Claim Type</TableHead>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="max-w-xs">Description</TableHead>
                  <TableHead className="w-28 text-right">Amount</TableHead>
                  <TableHead className="w-27.5">Status</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => {
                  const ct = claimTypes.find((t) => t.id === app.claimTypeId);
                  const catColor = CATEGORY_COLORS[ct?.category ?? "OTHER"];
                  return (
                    <TableRow key={app.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {app.applicationNo}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium">{app.claimTypeName}</span>
                          {ct && (
                            <Badge variant="outline" className={`text-xs px-1.5 py-0 h-5 ${catColor}`}>
                              {CATEGORY_LABELS[ct.category] ?? ct.category}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {app.claimDate}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-sm text-muted-foreground truncate" title={app.description}>
                          {app.description}
                        </p>
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {fmtAmount(app.amount)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={app.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {app.documents.length > 0 && (
                            <a
                              href={`/api/claim/download/${app.documents[0].fileKey}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                title="Download receipt"
                              >
                                <FileDownIcon className="h-3.5 w-3.5" />
                              </Button>
                            </a>
                          )}
                          {app.status === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setCancelTarget(app)}
                              title="Cancel claim"
                            >
                              <XIcon className="h-3.5 w-3.5" />
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
      <Sheet open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Cancel Claim</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-3">
              <AlertTriangleIcon className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive leading-relaxed">
                Are you sure you want to cancel{" "}
                <strong>
                  {cancelTarget?.claimTypeName} ({cancelTarget?.applicationNo})
                </strong>{" "}
                for <strong>{fmtAmount(cancelTarget?.amount ?? "0")}</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="destructive"
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1"
              >
                {cancelling ? "Cancelling…" : "Yes, Cancel Claim"}
              </Button>
              <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                Keep
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
