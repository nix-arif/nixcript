"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { TravelFormWithDetails } from "@/server/travel-form";
import { formatTravelItinerary } from "@/lib/travel/itinerary";
import { RouteIcon, SearchIcon, FileDownIcon } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:   "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
    APPROVED:  "bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700",
    REJECTED:  "bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700",
    CANCELLED: "bg-muted text-muted-foreground border-border hover:bg-muted",
  };
  const labels: Record<string, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" };
  return <Badge className={`border text-xs ${map[status] ?? "border-border"}`}>{labels[status] ?? status}</Badge>;
}

interface Props {
  travelForms: TravelFormWithDetails[];
}

export function AllTravelClient({ travelForms }: Props) {
  const [search, setSearch] = useState("");

  const filtered = travelForms.filter((f) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      f.applicationNo.toLowerCase().includes(q) ||
      (f.applicantName ?? "").toLowerCase().includes(q) ||
      f.stops.some((s) => s.fromLocation.toLowerCase().includes(q) || s.toLocation.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <RouteIcon className="h-5 w-5 text-muted-foreground"/>
          All Travel Forms
        </h1>
        <p className="text-sm text-muted-foreground">Every travel form submitted across the organisation, regardless of status.</p>
      </div>

      <div className="relative max-w-sm">
        <SearchIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground"/>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ref no., applicant, or destination…"
          className="w-full h-8 pl-8 pr-2 border border-input rounded-md text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border py-14 flex items-center justify-center text-sm text-muted-foreground">
          No travel forms found.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-32">Ref No.</TableHead>
                <TableHead>Applicant</TableHead>
                <TableHead className="max-w-2xs">Itinerary</TableHead>
                <TableHead className="w-44">Dates</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-16 text-right">Doc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{f.applicationNo}</TableCell>
                  <TableCell className="text-sm">{f.applicantName ?? "—"}</TableCell>
                  <TableCell className="max-w-2xs">
                    <p className="text-sm font-medium truncate" title={formatTravelItinerary(f.stops)}>{formatTravelItinerary(f.stops)}</p>
                    {(f.stops.length > 1 || f.claimedAt) && (
                      <div className="flex items-center gap-1 mt-1">
                        {f.stops.length > 1 && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{f.stops.length} legs</Badge>
                        )}
                        {f.claimedAt && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-blue-600 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-700">Claimed</Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {f.startDate}{f.startDate !== f.endDate && <> → {f.endDate}</>}
                  </TableCell>
                  <TableCell><StatusBadge status={f.status}/></TableCell>
                  <TableCell className="text-right">
                    {f.documents.length > 0 && (
                      <a href={`/api/travel-form/download/${f.documents[0].fileKey}`} target="_blank" rel="noopener noreferrer" title={`Download: ${f.documents[0].fileName}`}>
                        <FileDownIcon className="h-3.5 w-3.5 text-muted-foreground hover:text-primary inline-block"/>
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
