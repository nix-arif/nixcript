"use client";

import { useState, useRef, useTransition } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ExternalLinkIcon,
  LoaderIcon,
  Settings2Icon,
  TableIcon,
  UploadIcon,
  RefreshCwIcon,
} from "lucide-react";
import { setWarrant2026SheetUrl, importXlsxDataToSheet } from "@/server/warrant";

function isValidGoogleSheetsUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    return (
      url.hostname.includes("google.com") &&
      /\/spreadsheets\/d\/[a-zA-Z0-9-_]+/.test(url.pathname)
    );
  } catch { return false; }
}

function toEmbedUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return null;
    const id = match[1];
    const gid = url.hash.match(/gid=(\d+)/)?.[1] ?? url.searchParams.get("gid") ?? "0";
    return `https://docs.google.com/spreadsheets/d/${id}/edit?embedded=true&gid=${gid}`;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Setup form (owner only — paste sheet link)
// ---------------------------------------------------------------------------

function SetupForm({
  onSave,
  onCancel,
  saving,
  hasExisting,
}: {
  onSave: (url: string) => void;
  onCancel?: () => void;
  saving: boolean;
  hasExisting: boolean;
}) {
  const [input, setInput] = useState("");
  const valid = isValidGoogleSheetsUrl(input);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950 mb-2">
            <TableIcon className="h-6 w-6 text-emerald-600" />
          </div>
          <h2 className="font-semibold text-lg">Connect a Google Sheet</h2>
          <p className="text-sm text-muted-foreground">
            Paste the sharing link. The sheet will be embedded here for all members.
          </p>
        </div>

        <ol className="text-xs text-muted-foreground space-y-1.5 bg-muted/40 rounded-lg p-4 list-decimal list-inside">
          <li>Open your Google Sheet</li>
          <li>Click <strong>Share</strong> → set to <strong>"Anyone with the link can edit"</strong></li>
          <li>Copy the link and paste it below</li>
        </ol>

        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="text-sm"
            />
            <Button onClick={() => onSave(input)} disabled={!valid || saving} className="shrink-0">
              {saving ? <LoaderIcon className="h-4 w-4 animate-spin" /> : "Connect"}
            </Button>
          </div>
          {input && !valid && (
            <p className="text-xs text-destructive">That doesn't look like a valid Google Sheets URL.</p>
          )}
        </div>

        {hasExisting && onCancel && (
          <div className="text-center">
            <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground underline">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Warrant2026Client({
  initialSheetUrl,
  isOwner,
}: {
  initialSheetUrl: string | null;
  isOwner: boolean;
}) {
  const [sheetUrl, setSheetUrl] = useState(initialSheetUrl);
  const [editing, setEditing] = useState(false);
  const [iframeKey, setIframeKey] = useState(0); // bump to reload iframe
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const embedUrl = sheetUrl ? toEmbedUrl(sheetUrl) : null;

  // ---- Connect sheet ----
  const handleSave = (url: string) => {
    if (!isValidGoogleSheetsUrl(url)) { toast.error("Invalid Google Sheets URL"); return; }
    startTransition(async () => {
      try {
        await setWarrant2026SheetUrl(url.trim());
        setSheetUrl(url.trim());
        setEditing(false);
        setIframeKey((k) => k + 1);
        toast.success("Google Sheet connected");
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to save");
      }
    });
  };

  // ---- xlsx upload → write to Google Sheet ----
  const handleFile = (file: File) => {
    if (!isOwner) return;
    setUploading(true);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          defval: "",
        });

        // Find first non-empty row as header
        const headerIdx = raw.findIndex((r) => r.some((c) => String(c ?? "").trim() !== ""));
        if (headerIdx === -1) { toast.error("File is empty"); setUploading(false); return; }

        const rows = raw
          .slice(headerIdx)
          .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
          .map((r) =>
            r.map((c) => {
              if (typeof c === "number" && c > 25000 && c < 60000) {
                const d = XLSX.SSF.parse_date_code(c);
                if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
              }
              return String(c ?? "").trim();
            }),
          );

        await importXlsxDataToSheet(rows);
        toast.success(`Imported ${rows.length - 1} rows into Google Sheet`);
        // Reload the iframe to show the new data
        setIframeKey((k) => k + 1);
      } catch (e: any) {
        toast.error(e?.message ?? "Import failed");
      } finally {
        setUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ---- Setup / change sheet views ----
  if (!embedUrl || editing) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <PageHeader title="Warrant 2026" description="Shared spreadsheet" />
        {isOwner
          ? (
            <SetupForm
              onSave={handleSave}
              onCancel={sheetUrl ? () => setEditing(false) : undefined}
              saving={isPending}
              hasExisting={!!sheetUrl}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              <div className="text-center">
                <TableIcon className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p>No spreadsheet connected yet.</p>
                <p className="text-xs mt-1">Ask your organization owner to connect a Google Sheet.</p>
              </div>
            </div>
          )
        }
      </div>
    );
  }

  // ---- Main view: embedded sheet + toolbar ----
  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Warrant 2026"
        description="Shared Google Spreadsheet"
        action={
          <div className="flex items-center gap-2">
            {isOwner && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading
                    ? <LoaderIcon className="h-4 w-4 mr-1.5 animate-spin" />
                    : <UploadIcon className="h-4 w-4 mr-1.5" />
                  }
                  Import Excel
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                />
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIframeKey((k) => k + 1)}
            >
              <RefreshCwIcon className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={sheetUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon className="h-4 w-4 mr-1.5" />
                Open in Google Sheets
              </a>
            </Button>
            {isOwner && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Settings2Icon className="h-4 w-4 mr-1.5" />
                Change Sheet
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 min-h-0">
        <iframe
          key={iframeKey}
          src={embedUrl}
          className="w-full h-full border-0"
          title="Warrant 2026 Spreadsheet"
          allow="clipboard-read; clipboard-write; storage-access"
        />
      </div>
    </div>
  );
}
