"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDownIcon, DownloadIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadPayrollTemplate, importPayrollExcel } from "./payroll-import";

export function PayrollImportMenu({
  onlyMonth,
  onDone,
}: {
  onlyMonth?: { month: number; year: number };
  onDone: () => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const r = await importPayrollExcel(file, { onlyMonth });
      if (r.ok || r.newPeriods)
        toast.success(
          `${r.ok} payslip${r.ok !== 1 ? "s" : ""} imported` +
            (r.newPeriods ? `, ${r.newPeriods} new period${r.newPeriods !== 1 ? "s" : ""}` : ""),
        );
      if (r.errors.length)
        toast.error(
          `${r.errors.length} row(s) skipped: ${r.errors.slice(0, 3).join("; ")}${r.errors.length > 3 ? "…" : ""}`,
        );
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the Excel file");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy}>
            <UploadIcon className="w-3.5 h-3.5" />
            {busy ? "Importing…" : "Import"}
            <ChevronDownIcon className="w-3 h-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
            <UploadIcon className="w-3.5 h-3.5" /> Upload Excel
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void downloadPayrollTemplate().catch((e) =>
                toast.error(e instanceof Error ? e.message : "Failed"),
              )
            }
          >
            <DownloadIcon className="w-3.5 h-3.5" /> Download template
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
