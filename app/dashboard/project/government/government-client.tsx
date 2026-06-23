"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  FileSpreadsheetIcon,
  XIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  LoaderIcon,
  DownloadIcon,
  FolderIcon,
  LayersIcon,
  BuildingIcon,
  InfoIcon,
} from "lucide-react";
import { lookupCustomersByName, createCustomer, getCustomers } from "@/server/customer";
import {
  createGovernmentBatch,
  type GovGroupResult,
  type GovRawItem,
} from "@/server/quotation";
import { Input } from "@/components/ui/input";
import { uid } from "@/lib/uid";

type OwnerOrg = { id: string; name: string; slug: string };

type Sheet2Info = {
  customerName: string;
  department?: string;
  organizationName?: string;
  organizationAddress?: string;
  validityDays: number;
  originalCompanyName?: string;
};

type ParsedFile = {
  uid: string;
  filename: string;
  title: string;
  rawItems: GovRawItem[];
  sheet2: Sheet2Info;
  customerStatus: "pending" | "checking" | "found" | "not_found";
  customerId?: string;
  selectedOriginalOrgId: string;
  parseError?: string;
};

type Arrangement = "by_title" | "by_type" | "by_company";

type GenerateState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "fetching"; done: number; total: number }
  | { phase: "done" };

// ── Sheet parsers ─────────────────────────────────────────────────────────────

const norm = (k: string) => k.toLowerCase().replace(/[\s_\-:]/g, "");

function extractField(row: Record<string, any>, targets: string[]): string | undefined {
  const set = new Set(targets.map(norm));
  for (const k of Object.keys(row)) {
    if (set.has(norm(k)) && row[k] !== undefined && row[k] !== "") {
      return String(row[k]).trim();
    }
  }
  return undefined;
}

function parseSheet1(ws: XLSX.WorkSheet): GovRawItem[] {
  const raw = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, any>[];
  return raw
    .map((row, i) => ({
      rowNo: String(i + 1),
      productCode: extractField(row, ["product code", "productcode", "code", "item code", "itemcode", "kod produk", "kodproduk"]),
      description: extractField(row, ["description", "desc", "penerangan", "keterangan", "item description"]),
      qty: extractField(row, ["qty", "quantity", "kuantiti"]),
      uom: extractField(row, ["uom", "unit", "unit of measure", "satuan"]),
      unitPrice: extractField(row, ["unit price", "unitprice", "price", "harga", "harga satuan"]),
    }))
    .filter((r) => r.productCode);
}

function parseSheet2(ws: XLSX.WorkSheet): Sheet2Info {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
  const kv: Record<string, string> = {};
  for (const row of raw) {
    if (row.length >= 2 && row[0]) {
      kv[norm(String(row[0]))] = String(row[1]).trim();
    }
  }
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = kv[norm(k)];
      if (v) return v;
    }
    return undefined;
  };

  return {
    customerName: get("customer name", "name", "nama", "pelanggan", "contact person") ?? "",
    department: get("department", "jabatan", "dept"),
    organizationName: get("organization", "company", "syarikat", "agensi", "ministry", "agency", "org name"),
    organizationAddress: get("address", "alamat"),
    validityDays: parseInt(get("validity days", "valid days", "validity", "tempoh sah", "valid") ?? "30") || 30,
    originalCompanyName: get("original company", "original", "syarikat utama", "syarikat asal", "main company"),
  };
}

function resolveOriginalOrg(
  name: string | undefined,
  orgs: OwnerOrg[],
  activeOrgId: string,
): string {
  if (!name || !orgs.length) return activeOrgId;
  const n = name.toLowerCase().trim();
  const match = orgs.find(
    (o) =>
      o.name.toLowerCase().trim() === n ||
      o.name.toLowerCase().includes(n) ||
      n.includes(o.name.toLowerCase().trim()),
  );
  return match?.id ?? activeOrgId;
}

// ── ZIP generation ────────────────────────────────────────────────────────────

function safeName(s: string) {
  return (s || "Unknown").replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
}

async function generateAndDownload(
  groups: GovGroupResult[],
  arrangement: Arrangement,
  includeMdaCerts: boolean,
  onProgress: (done: number, total: number) => void,
) {
  const { zip } = await import("fflate");

  type Task = { url: string; path: string };
  const tasks: Task[] = [];

  for (const group of groups) {
    const t = safeName(group.title);
    const co = safeName(group.customerOrgName || "Unknown");

    for (const q of group.quotations) {
      const orgN = safeName(q.orgName);
      const roleLabel = q.isDummy ? `Dummy ${q.dummyIndex}` : "Original";
      const filename = `${t} - ${orgN} (${roleLabel}).pdf`;

      let path: string;
      if (arrangement === "by_title") {
        path = `${t}/${filename}`;
      } else if (arrangement === "by_type") {
        const folder = q.isDummy ? `Dummy ${q.dummyIndex}` : "Original";
        path = `${folder}/${filename}`;
      } else {
        path = `${co}/${filename}`;
      }
      tasks.push({ url: `/api/quotation/${q.id}/pdf`, path });
    }

    if (includeMdaCerts) {
      const mdaFilename = `${t} - MDA Certs.pdf`;
      let mdaPath: string;
      if (arrangement === "by_title") {
        mdaPath = `${t}/${mdaFilename}`;
      } else if (arrangement === "by_type") {
        mdaPath = `MDA Certs/${mdaFilename}`;
      } else {
        mdaPath = `${safeName(group.customerOrgName || "Unknown")}/${mdaFilename}`;
      }
      tasks.push({ url: `/api/quotation/${group.originalId}/mda-certs`, path: mdaPath });
    }
  }

  const files: Record<string, Uint8Array> = {};
  const BATCH = 6;

  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async ({ url, path }) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return { path, bytes: null };
          return { path, bytes: new Uint8Array(await res.arrayBuffer()) };
        } catch {
          return { path, bytes: null };
        }
      }),
    );
    for (const { path, bytes } of results) {
      if (bytes) files[path] = bytes;
    }
    onProgress(Math.min(i + BATCH, tasks.length), tasks.length);
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  const blob = new Blob([zipped as unknown as Uint8Array<ArrayBuffer>], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "government-quotations.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  ownerOrgs: OwnerOrg[];
  activeOrgId: string;
}

export function GovernmentClient({ ownerOrgs, activeOrgId }: Props) {
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [drag, setDrag] = useState(false);
  const [arrangement, setArrangement] = useState<Arrangement>("by_title");
  const [includeMdaCerts, setIncludeMdaCerts] = useState(true);
  const [inclMof, setInclMof] = useState(true);
  const [inclSsm, setInclSsm] = useState(true);
  const [inclTcc, setInclTcc] = useState(true);
  const [inclBankStatement, setInclBankStatement] = useState(true);
  const [inclMdaEstablishment, setInclMdaEstablishment] = useState(true);
  const [inclLampiran12, setInclLampiran12] = useState(true);
  const [inclLampiran13, setInclLampiran13] = useState(true);
  const [genState, setGenState] = useState<GenerateState>({ phase: "idle" });
  const [generatedGroups, setGeneratedGroups] = useState<GovGroupResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<ParsedFile[]>([]);
  filesRef.current = files;

  async function processFiles(raw: File[]) {
    const uid = () => Math.random().toString(36).slice(2);

    const parsed: ParsedFile[] = [];
    const currentCount = filesRef.current.length;

    for (const f of raw) {
      if (currentCount + parsed.length >= 100) break;
      try {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        if (wb.SheetNames.length < 2) {
          parsed.push({
            uid: uid(),
            filename: f.name,
            title: "",
            rawItems: [],
            sheet2: { customerName: "", validityDays: 30 },
            customerStatus: "pending",
            selectedOriginalOrgId: activeOrgId,
            parseError: "File must have at least 2 sheets",
          });
          continue;
        }

        const sheet1Items = parseSheet1(wb.Sheets[wb.SheetNames[0]]);
        const sheet2Info = parseSheet2(wb.Sheets[wb.SheetNames[1]]);
        const title = wb.SheetNames[0];
        const resolvedOrgId = resolveOriginalOrg(
          sheet2Info.originalCompanyName,
          ownerOrgs,
          activeOrgId,
        );

        parsed.push({
          uid: uid(),
          filename: f.name,
          title,
          rawItems: sheet1Items,
          sheet2: sheet2Info,
          customerStatus: "pending",
          selectedOriginalOrgId: resolvedOrgId,
        });
      } catch (e: any) {
        parsed.push({
          uid: uid(),
          filename: f.name,
          title: "",
          rawItems: [],
          sheet2: { customerName: "", validityDays: 30 },
          customerStatus: "pending",
          selectedOriginalOrgId: activeOrgId,
          parseError: e.message ?? "Failed to parse file",
        });
      }
    }

    if (!parsed.length) return;

    setFiles((prev) => {
      const remaining = 100 - prev.length;
      return [...prev, ...parsed.slice(0, remaining)];
    });

    // Names that need lookup (skip parse errors and empty names)
    const names = parsed
      .filter((f) => !f.parseError && f.sheet2.customerName)
      .map((f) => f.sheet2.customerName);

    if (!names.length) return;

    // Mark these files as "checking" so each row shows its own spinner
    const checkingSet = new Set(names.map((n) => n.toLowerCase().trim()));
    setFiles((prev) =>
      prev.map((pf) =>
        pf.customerStatus === "pending" &&
        checkingSet.has(pf.sheet2.customerName.toLowerCase().trim())
          ? { ...pf, customerStatus: "checking" }
          : pf,
      ),
    );

    try {
      const results = await lookupCustomersByName([...new Set(names)]);
      const byName = new Map(results.map((r) => [r.name.toLowerCase().trim(), r]));

      setFiles((prev) =>
        prev.map((pf) => {
          if (pf.customerStatus !== "checking") return pf;
          const result = byName.get(pf.sheet2.customerName.toLowerCase().trim());
          if (!result) return { ...pf, customerStatus: "not_found" };
          return {
            ...pf,
            customerStatus: result.found ? "found" : "not_found",
            customerId: result.customer?.id,
          };
        }),
      );
    } catch (e: any) {
      // Reset checking → pending so the user can retry
      setFiles((prev) =>
        prev.map((pf) =>
          pf.customerStatus === "checking" ? { ...pf, customerStatus: "pending" } : pf,
        ),
      );
      toast.error(e.message ?? "Customer lookup failed");
    }
  }

  const removeFile = (uid: string) =>
    setFiles((prev) => prev.filter((f) => f.uid !== uid));

  const setOriginalOrg = (uid: string, orgId: string) =>
    setFiles((prev) =>
      prev.map((f) => (f.uid === uid ? { ...f, selectedOriginalOrgId: orgId } : f)),
    );

  const checking = files.some((f) => f.customerStatus === "checking");
  const missingCustomers = files.filter((f) => f.customerStatus === "not_found");
  const validFiles = files.filter(
    (f) => !f.parseError && f.customerStatus === "found" && f.customerId,
  );
  const canGenerate = validFiles.length > 0 && genState.phase === "idle" && !checking;

  // Per-name resolver state
  type ResolverMode = "search" | "create";
  type CustomerResult = Awaited<ReturnType<typeof getCustomers>>[number];
  const [activeResolver, setActiveResolver] = useState<string | null>(null);
  const [resolverMode, setResolverMode] = useState<ResolverMode>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: "", department: "", organizationName: "", organizationAddress: "",
    contactNo: "", email: "",
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openResolver(customerName: string) {
    const src = files.find(
      (f) => f.sheet2.customerName.toLowerCase() === customerName.toLowerCase(),
    );
    setActiveResolver(customerName);
    setResolverMode("search");
    setSearchQuery(customerName);
    setSearchResults([]);
    // Pre-fill create form in case user switches to it
    setCustomerForm({
      name: customerName,
      department: src?.sheet2.department ?? "",
      organizationName: src?.sheet2.organizationName ?? "",
      organizationAddress: src?.sheet2.organizationAddress ?? "",
      contactNo: "",
      email: "",
    });
    // Auto-run search
    runSearch(customerName);
  }

  async function runSearch(q: string) {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const rows = await getCustomers(q.trim());
      setSearchResults(rows);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function onSearchChange(q: string) {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(q), 300);
  }

  function resolveWith(cust: CustomerResult) {
    if (!activeResolver) return;
    const lowerName = activeResolver.toLowerCase().trim();
    setFiles((prev) =>
      prev.map((f) =>
        f.sheet2.customerName.toLowerCase().trim() === lowerName
          ? { ...f, customerStatus: "found", customerId: cust.id }
          : f,
      ),
    );
    toast.success(`Matched to "${cust.name}"`);
    setActiveResolver(null);
  }

  async function handleCreateCustomer() {
    if (!activeResolver || !customerForm.name.trim()) return;
    setSavingCustomer(true);
    try {
      const newCust = await createCustomer({
        name: customerForm.name.trim(),
        contactNo: customerForm.contactNo.trim() || undefined,
        email: customerForm.email.trim() || undefined,
        companies:
          customerForm.organizationName.trim()
            ? [
                {
                  organizationName: customerForm.organizationName.trim(),
                  organizationAddress:
                    customerForm.organizationAddress.trim() || undefined,
                  department: customerForm.department.trim() || undefined,
                  isPrimary: true,
                },
              ]
            : [],
      });
      const lowerName = activeResolver.toLowerCase().trim();
      setFiles((prev) =>
        prev.map((f) =>
          f.sheet2.customerName.toLowerCase().trim() === lowerName
            ? { ...f, customerStatus: "found", customerId: newCust.id }
            : f,
        ),
      );
      toast.success(`Customer "${newCust.name}" created`);
      setActiveResolver(null);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create customer");
    } finally {
      setSavingCustomer(false);
    }
  }

  const handleGenerate = async () => {
    if (!canGenerate) return;

    setGenState({ phase: "creating" });
    try {
      const inputs = validFiles.map((f) => ({
        title: f.title,
        items: f.rawItems,
        customerId: f.customerId!,
        validityDays: f.sheet2.validityDays,
        originalOrgId: f.selectedOriginalOrgId,
        includeMdaCerts,
        inclMof,
        inclSsm,
        inclTcc,
        inclBankStatement,
        inclMdaEstablishment,
        inclLampiran12,
        inclLampiran13,
      }));

      const groups = await createGovernmentBatch(inputs);
      setGeneratedGroups(groups);

      const totalPdfs = groups.reduce(
        (s, g) => s + g.quotations.length + (includeMdaCerts ? 1 : 0),
        0,
      );
      setGenState({ phase: "fetching", done: 0, total: totalPdfs });

      await generateAndDownload(groups, arrangement, includeMdaCerts, (done, total) => {
        setGenState({ phase: "fetching", done, total });
      });

      setGenState({ phase: "done" });
      toast.success("ZIP downloaded");
    } catch (e: any) {
      toast.error(e.message ?? "Generation failed");
      setGenState({ phase: "idle" });
    }
  };

  const reset = () => {
    setFiles([]);
    setGeneratedGroups([]);
    setGenState({ phase: "idle" });
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Government Project"
        description="Upload spreadsheets (2-sheet format) to bulk-create quotations and download organized PDFs"
      />

      {/* Upload zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={(e) => {
          // Only clear drag state when leaving the zone itself, not a child
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const dropped = Array.from(e.dataTransfer.files).filter((f) =>
            /\.(xlsx|xls|csv)$/i.test(f.name),
          );
          if (dropped.length) processFiles(dropped);
        }}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all text-center mb-4",
          drag
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-muted/20",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          className="hidden"
          onChange={(e) => {
            const selected = Array.from(e.target.files ?? []);
            if (selected.length) processFiles(selected);
            e.target.value = "";
          }}
        />
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <FileSpreadsheetIcon className="w-6 h-6 text-muted-foreground" />
        </div>
        <div>
          <div className="text-sm font-medium">
            {files.length === 0
              ? "Click or drag & drop spreadsheets"
              : `Add more files (${files.length}/100)`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            .xlsx · .xls — Sheet 1: items, Sheet 2: customer info
          </div>
        </div>
      </div>

      {/* Sheet 2 format reminder */}
      {files.length === 0 && (
        <div className="rounded-xl border border-border bg-muted/10 p-4 text-xs text-muted-foreground space-y-2 mb-4">
          <div className="font-medium text-foreground mb-1">Sheet 2 format (key-value, Column A → Column B)</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <span className="text-muted-foreground/70">Customer Name</span><span>Contact person name</span>
            <span className="text-muted-foreground/70">Department</span><span>e.g. Procurement Division</span>
            <span className="text-muted-foreground/70">Organization</span><span>Customer company / ministry</span>
            <span className="text-muted-foreground/70">Address</span><span>Customer address</span>
            <span className="text-muted-foreground/70">Validity Days</span><span>e.g. 30</span>
            <span className="text-muted-foreground/70">Original Company</span><span>Your company that acts as original</span>
          </div>
        </div>
      )}

      {/* Files review table */}
      {files.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {files.length} file{files.length > 1 ? "s" : ""} ·{" "}
              {checking
                ? <span className="text-blue-500">looking up customers…</span>
                : <span>{validFiles.length} ready · {missingCustomers.length} issues</span>
              }
            </span>
            <button
              onClick={reset}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/20">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">File</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">Title</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-40">Customer</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground border-b border-border w-14">Items</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground border-b border-border w-16">Validity</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border w-44">Original Company</th>
                  <th className="px-3 py-2 border-b border-border w-8"></th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr
                    key={f.uid}
                    className={cn(
                      i < files.length - 1 ? "border-b border-border" : "",
                      f.parseError ? "opacity-50" : "",
                    )}
                  >
                    <td className="px-3 py-2 max-w-40 truncate text-muted-foreground font-mono">
                      {f.filename}
                    </td>
                    <td className="px-3 py-2 font-medium max-w-50 truncate">
                      {f.parseError ? (
                        <span className="text-destructive italic">{f.parseError}</span>
                      ) : (
                        f.title
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {f.parseError ? null : (
                        <div className="flex items-center gap-1.5">
                          {(f.customerStatus === "pending" || f.customerStatus === "checking") && (
                            <LoaderIcon className={cn("w-3.5 h-3.5 shrink-0", f.customerStatus === "checking" ? "animate-spin text-blue-500" : "text-muted-foreground/30")} />
                          )}
                          {f.customerStatus === "found" && (
                            <CheckCircleIcon className="w-3.5 h-3.5 text-green-600 shrink-0" />
                          )}
                          {f.customerStatus === "not_found" && (
                            <AlertCircleIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          )}
                          <span
                            className={cn(
                              "truncate",
                              f.customerStatus === "not_found" ? "text-amber-600" : "",
                            )}
                          >
                            {f.sheet2.customerName || "—"}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                      {f.rawItems.length}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                      {f.sheet2.validityDays}d
                    </td>
                    <td className="px-3 py-2">
                      {!f.parseError && ownerOrgs.length > 1 && (
                        <select
                          value={f.selectedOriginalOrgId}
                          onChange={(e) => setOriginalOrg(f.uid, e.target.value)}
                          className="w-full text-xs bg-transparent border border-border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          {ownerOrgs.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                      )}
                      {!f.parseError && ownerOrgs.length <= 1 && (
                        <span className="text-muted-foreground">{ownerOrgs[0]?.name ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => removeFile(f.uid)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Missing customers warning */}
      {missingCustomers.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 overflow-hidden mb-4">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/20">
            <AlertCircleIcon className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {[...new Set(missingCustomers.map((f) => f.sheet2.customerName))].length} customer
              {[...new Set(missingCustomers.map((f) => f.sheet2.customerName))].length > 1 ? "s" : ""} not found — resolve them below to continue
            </span>
          </div>

          {[...new Set(missingCustomers.map((f) => f.sheet2.customerName))].map((name) => {
            const src = files.find((f) => f.sheet2.customerName === name);
            const isOpen = activeResolver === name;
            return (
              <div key={name} className="border-t border-amber-200 dark:border-amber-800">
                {/* Row header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50/50 dark:bg-amber-950/10">
                  <div className="text-sm text-amber-800 dark:text-amber-300 font-medium">
                    {name}
                    {src?.sheet2.organizationName && (
                      <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-500">
                        · {src.sheet2.organizationName}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400"
                    onClick={() => isOpen ? setActiveResolver(null) : openResolver(name)}
                  >
                    {isOpen ? "Cancel" : "Resolve"}
                  </Button>
                </div>

                {/* Resolver panel */}
                {isOpen && (
                  <div className="px-4 py-4 bg-background border-t border-amber-100 dark:border-amber-900 space-y-3">
                    {/* Mode toggle */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setResolverMode("search")}
                        className={cn(
                          "text-xs px-3 py-1.5 rounded-md border transition-all",
                          resolverMode === "search"
                            ? "border-primary bg-primary/5 text-primary font-medium"
                            : "border-border text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        Search existing
                      </button>
                      <button
                        onClick={() => setResolverMode("create")}
                        className={cn(
                          "text-xs px-3 py-1.5 rounded-md border transition-all",
                          resolverMode === "create"
                            ? "border-primary bg-primary/5 text-primary font-medium"
                            : "border-border text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        Create new
                      </button>
                    </div>

                    {/* Search mode */}
                    {resolverMode === "search" && (
                      <div className="space-y-2">
                        <Input
                          value={searchQuery}
                          onChange={(e) => onSearchChange(e.target.value)}
                          placeholder="Search by name, organization…"
                          className="h-8 text-sm"
                          autoFocus
                        />
                        {searching && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                            <LoaderIcon className="w-3 h-3 animate-spin" />
                            Searching…
                          </div>
                        )}
                        {!searching && searchResults.length === 0 && searchQuery.trim() && (
                          <p className="text-xs text-muted-foreground py-1">
                            No customers found — try a different search or switch to &quot;Create new&quot;.
                          </p>
                        )}
                        {!searching && searchResults.length > 0 && (
                          <div className="border border-border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                            {searchResults.map((cust) => (
                              <button
                                key={cust.id}
                                onClick={() => resolveWith(cust)}
                                className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted/40 border-b border-border last:border-0 transition-colors"
                              >
                                <div className="font-medium">{cust.name}</div>
                                {cust.companies.length > 0 && (
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    {[
                                      cust.companies[0].organizationName,
                                      cust.companies[0].department,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Create mode */}
                    {resolverMode === "create" && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Name *</label>
                            <Input
                              value={customerForm.name}
                              onChange={(e) => setCustomerForm((p) => ({ ...p, name: e.target.value }))}
                              placeholder="Full name"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Department</label>
                            <Input
                              value={customerForm.department}
                              onChange={(e) => setCustomerForm((p) => ({ ...p, department: e.target.value }))}
                              placeholder="e.g. Procurement Division"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Organization</label>
                            <Input
                              value={customerForm.organizationName}
                              onChange={(e) => setCustomerForm((p) => ({ ...p, organizationName: e.target.value }))}
                              placeholder="Ministry / Company"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Contact No.</label>
                            <Input
                              value={customerForm.contactNo}
                              onChange={(e) => setCustomerForm((p) => ({ ...p, contactNo: e.target.value }))}
                              placeholder="e.g. 0123456789"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Address</label>
                            <Input
                              value={customerForm.organizationAddress}
                              onChange={(e) => setCustomerForm((p) => ({ ...p, organizationAddress: e.target.value }))}
                              placeholder="Organization address"
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            onClick={handleCreateCustomer}
                            disabled={savingCustomer || !customerForm.name.trim()}
                            className="min-w-28"
                          >
                            {savingCustomer ? (
                              <><LoaderIcon className="w-3.5 h-3.5 animate-spin mr-1.5" />Saving…</>
                            ) : (
                              "Save Customer"
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Configuration */}
      {files.length > 0 && (
        <div className="border border-border rounded-xl p-5 mb-4 space-y-5">
          {/* Attached documents */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-3">Attached documents</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2.5">
              {([
                { id: "incl-mda-certs",  label: "MDA Certificates",             checked: includeMdaCerts,     set: setIncludeMdaCerts },
                { id: "incl-mof",        label: "MOF Certificate",               checked: inclMof,             set: setInclMof },
                { id: "incl-ssm",        label: "SSM",                           checked: inclSsm,             set: setInclSsm },
                { id: "incl-tcc",        label: "TCC (Tax Compliance)",          checked: inclTcc,             set: setInclTcc },
                { id: "incl-bank",       label: "Bank Statement",                checked: inclBankStatement,   set: setInclBankStatement },
                { id: "incl-mda-est",    label: "MDA Establishment",             checked: inclMdaEstablishment, set: setInclMdaEstablishment },
                { id: "incl-lamp12",     label: "Lampiran 12",                   checked: inclLampiran12,      set: setInclLampiran12 },
                { id: "incl-lamp13",     label: "Lampiran 13",                   checked: inclLampiran13,      set: setInclLampiran13 },
              ] as const).map(({ id, label, checked, set }) => (
                <div key={id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={id}
                    checked={checked}
                    onChange={(e) => (set as (v: boolean) => void)(e.target.checked)}
                    className="w-4 h-4 accent-primary shrink-0"
                  />
                  <label htmlFor={id} className="text-sm cursor-pointer select-none leading-tight">
                    {label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Arrangement */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-3">
              Output arrangement
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  {
                    key: "by_title" as Arrangement,
                    label: "By Title",
                    icon: <FolderIcon className="w-4 h-4" />,
                    desc: "One folder per quotation title, containing all company versions",
                  },
                  {
                    key: "by_type" as Arrangement,
                    label: "By Type",
                    icon: <LayersIcon className="w-4 h-4" />,
                    desc: "Separate folders for Original, Dummy 1, Dummy 2 and MDA Certs",
                  },
                  {
                    key: "by_company" as Arrangement,
                    label: "By Company",
                    icon: <BuildingIcon className="w-4 h-4" />,
                    desc: "Group quotations by the customer's organization",
                  },
                ] as const
              ).map(({ key, label, icon, desc }) => (
                <button
                  key={key}
                  onClick={() => setArrangement(key)}
                  className={cn(
                    "text-left rounded-xl border p-4 transition-all",
                    arrangement === key
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={cn(
                        arrangement === key ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {icon}
                    </span>
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Generate / Progress */}
      {files.length > 0 && (
        <div className="flex items-center justify-between p-4 bg-background border border-border rounded-xl">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <InfoIcon className="w-3.5 h-3.5 shrink-0" />
            {genState.phase === "idle" && (
              canGenerate
                ? `${validFiles.length} quotation${validFiles.length > 1 ? "s" : ""} ready · ${ownerOrgs.length} org${ownerOrgs.length > 1 ? "s" : ""} × each`
                : "Resolve customer issues before generating"
            )}
            {genState.phase === "creating" && "Creating quotations in database…"}
            {genState.phase === "fetching" && (
              `Generating PDFs… ${genState.done} / ${genState.total}`
            )}
            {genState.phase === "done" && "ZIP downloaded successfully"}
          </div>

          <div className="flex gap-2 items-center">
            {genState.phase === "fetching" && (
              <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 rounded-full"
                  style={{ width: `${(genState.done / genState.total) * 100}%` }}
                />
              </div>
            )}
            {genState.phase === "done" ? (
              <Button size="sm" variant="outline" onClick={reset}>
                Start Over
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={!canGenerate || genState.phase !== "idle"}
                className="gap-2 min-w-44"
              >
                {genState.phase === "creating" || genState.phase === "fetching" ? (
                  <><LoaderIcon className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                ) : (
                  <><DownloadIcon className="w-3.5 h-3.5" /> Generate &amp; Download ZIP</>
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
