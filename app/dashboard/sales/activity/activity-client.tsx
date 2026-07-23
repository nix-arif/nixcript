"use client";

import { useState, useMemo, useRef, Fragment } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  createSalesActivity,
  updateSalesActivity,
  deleteSalesActivity,
  bulkCreateSalesActivities,
  getSalesActivities,
  type SalesActivityRow,
  type CreateSalesActivityInput,
} from "@/server/sales-activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  PlusIcon,
  DownloadIcon,
  PencilIcon,
  TrashIcon,
  SearchIcon,
  FilterIcon,
  UploadIcon,
  FileSpreadsheetIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
} from "lucide-react";

type Member = { id: string; name: string };

type Props = {
  initialActivities: SalesActivityRow[];
  members: Member[];
  currentUserId: string;
  canSeeAll: boolean;
};

const PRODUCT_CATEGORIES = [
  "Surgical Instruments",
  "Diagnostic Equipment",
  "Consumables",
  "Implants",
  "Rehabilitation",
  "Laboratory",
  "Radiology",
  "Endoscopy",
  "Sterilization",
  "Others",
];

const TEMPLATE_HEADERS = ["Date (YYYY-MM-DD)", "Customer Organization", "Customer Name", "Product Category", "Remark"];

const today = () => new Date().toISOString().split("T")[0];

function emptyForm(): CreateSalesActivityInput {
  return { date: today(), customerOrganization: "", customerName: "", productCategory: "", remark: "" };
}

// ── Upload preview row ──────────────────────────────────────────────────────

type PreviewRow = CreateSalesActivityInput & { _error?: string };

function parseDate(raw: unknown): string {
  if (!raw) return "";
  const s = String(raw).trim();
  // Excel serial number
  if (/^\d{4,5}$/.test(s)) {
    const d = XLSX.SSF.parse_date_code(Number(s));
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  // YYYY-MM-DD or similar
  const match = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return s;
}

export function ActivityClient({ initialActivities, members, currentUserId, canSeeAll }: Props) {
  const [activities, setActivities] = useState<SalesActivityRow[]>(initialActivities);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateSalesActivityInput>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterUserId, setFilterUserId] = useState("ALL");
  const [filtering, setFiltering] = useState(false);

  // Upload
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadPreview, setUploadPreview] = useState<PreviewRow[] | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (!canSeeAll && a.userId !== currentUserId) return false;
      if (filterUserId !== "ALL" && a.userId !== filterUserId) return false;
      if (filterFrom && a.date < filterFrom) return false;
      if (filterTo && a.date > filterTo) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.customerOrganization.toLowerCase().includes(q) ||
          a.customerName.toLowerCase().includes(q) ||
          a.productCategory.toLowerCase().includes(q) ||
          (a.remark ?? "").toLowerCase().includes(q) ||
          a.userName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [activities, search, filterFrom, filterTo, filterUserId, canSeeAll, currentUserId]);

  // ── Template download ──────────────────────────────────────────────────────

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      [today(), "Hospital Kuala Lumpur", "Dr. Ahmad", "Surgical Instruments", "Initial visit"],
    ]);
    ws["!cols"] = [{ wch: 18 }, { wch: 30 }, { wch: 25 }, { wch: 22 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Activity");
    XLSX.writeFile(wb, "sales-activity-template.xlsx");
  }

  // ── Upload / parse ─────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!uploadRef.current) uploadRef.current = e.target;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];

        const preview: PreviewRow[] = raw.map((row) => {
          const keys = Object.keys(row).map((k) => k.toLowerCase().trim());
          const get = (patterns: string[]) => {
            for (const p of patterns) {
              const k = Object.keys(row).find((k) => k.toLowerCase().trim().includes(p));
              if (k) return String(row[k] ?? "").trim();
            }
            return "";
          };

          const date = parseDate(get(["date"]));
          const customerOrganization = get(["organization", "org", "hospital", "company"]);
          const customerName = get(["customer name", "name"]);
          const productCategory = get(["category", "product"]);
          const remark = get(["remark", "note", "comment"]);

          const errors: string[] = [];
          if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("invalid date");
          if (!customerOrganization) errors.push("missing organization");
          if (!customerName) errors.push("missing customer name");
          if (!productCategory) errors.push("missing product category");

          return {
            date,
            customerOrganization,
            customerName,
            productCategory,
            remark,
            _error: errors.length > 0 ? errors.join(", ") : undefined,
          };
        });

        setUploadPreview(preview);
        setUploadOpen(true);
      } catch {
        toast.error("Failed to read file");
      } finally {
        if (uploadRef.current) uploadRef.current.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    if (!uploadPreview) return;
    const valid = uploadPreview.filter((r) => !r._error);
    if (valid.length === 0) { toast.error("No valid rows to import"); return; }

    setImporting(true);
    try {
      const count = await bulkCreateSalesActivities(
        valid.map(({ _error, ...r }) => r),
      );
      toast.success(`${count} ${count === 1 ? "activity" : "activities"} imported`);
      const fresh = await getSalesActivities();
      setActivities(fresh);
      setUploadOpen(false);
      setUploadPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  // ── Log / Edit ─────────────────────────────────────────────────────────────

  function openNew() {
    setEditingId(null);
    setForm(emptyForm());
    setSheetOpen(true);
  }

  function openEdit(row: SalesActivityRow) {
    setEditingId(row.id);
    setForm({ date: row.date, customerOrganization: row.customerOrganization, customerName: row.customerName, productCategory: row.productCategory, remark: row.remark ?? "" });
    setSheetOpen(true);
  }

  async function handleSave() {
    if (!form.date) { toast.error("Date is required"); return; }
    if (!form.customerOrganization.trim()) { toast.error("Customer organization is required"); return; }
    if (!form.customerName.trim()) { toast.error("Customer name is required"); return; }
    if (!form.productCategory.trim()) { toast.error("Product category is required"); return; }

    setSaving(true);
    try {
      if (editingId) {
        await updateSalesActivity({ ...form, id: editingId });
        toast.success("Activity updated");
      } else {
        await createSalesActivity(form);
        toast.success("Activity logged");
      }
      const fresh = await getSalesActivities();
      setActivities(fresh);
      setSheetOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteSalesActivity(deleteId);
      setActivities((prev) => prev.filter((a) => a.id !== deleteId));
      toast.success("Activity deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  }

  async function handleApplyFilters() {
    setFiltering(true);
    try {
      const fresh = await getSalesActivities({
        from: filterFrom || undefined,
        to: filterTo || undefined,
        userId: filterUserId !== "ALL" ? filterUserId : undefined,
        search: search || undefined,
      });
      setActivities(fresh);
    } catch {
      toast.error("Failed to load activities");
    } finally {
      setFiltering(false);
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  function handleExport() {
    if (filtered.length === 0) { toast.error("No data to export"); return; }

    const rows = filtered.map((a) => {
      const base: Record<string, string> = {
        Date: a.date,
        "Customer Organization": a.customerOrganization,
        "Customer Name": a.customerName,
        "Product Category": a.productCategory,
        Remark: a.remark ?? "",
      };
      if (canSeeAll) base["Sales Person"] = a.userName;
      return base;
    });

    // Reorder so Sales Person is first when present
    const ordered = canSeeAll
      ? rows.map(({ Date, "Sales Person": sp, ...rest }) => ({ Date, "Sales Person": sp, ...rest }))
      : rows;

    const ws = XLSX.utils.json_to_sheet(ordered);
    ws["!cols"] = canSeeAll
      ? [{ wch: 12 }, { wch: 22 }, { wch: 30 }, { wch: 25 }, { wch: 22 }, { wch: 40 }]
      : [{ wch: 12 }, { wch: 30 }, { wch: 25 }, { wch: 22 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Activity");
    XLSX.writeFile(wb, `sales-activity-${today()}.xlsx`);
  }

  const validCount = uploadPreview?.filter((r) => !r._error).length ?? 0;
  const errorCount = uploadPreview?.filter((r) => !!r._error).length ?? 0;

  return (
    <div className="p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Sales Activity</h1>
          <p className="text-sm text-muted-foreground">Log and track sales visits and interactions.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <FileSpreadsheetIcon className="h-4 w-4 mr-1.5" />
            Download Template
          </Button>
          <Button variant="outline" size="sm" onClick={() => uploadRef.current?.click()}>
            <UploadIcon className="h-4 w-4 mr-1.5" />
            Import .xlsx
          </Button>
          <input ref={uploadRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <DownloadIcon className="h-4 w-4 mr-1.5" />
            Export .xlsx
          </Button>
          <Button size="sm" onClick={openNew}>
            <PlusIcon className="h-4 w-4 mr-1.5" />
            Log Activity
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        {canSeeAll && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Sales Person</Label>
            <Select value={filterUserId} onValueChange={setFilterUserId}>
              <SelectTrigger className="h-8 text-xs w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1 flex-1 min-w-48">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Organization, name, category..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs pl-8" />
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={handleApplyFilters} disabled={filtering}>
          <FilterIcon className="h-3.5 w-3.5 mr-1" />
          {filtering ? "Loading..." : "Apply"}
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-27.5">Date</TableHead>
              {canSeeAll && <TableHead>Sales Person</TableHead>}
              <TableHead>Customer Organization</TableHead>
              <TableHead>Customer Name</TableHead>
              <TableHead>Product Category</TableHead>
              <TableHead>Remark</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canSeeAll ? 7 : 6} className="text-center text-sm text-muted-foreground py-12">
                  No activities found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm font-mono">{a.date}</TableCell>
                  {canSeeAll && <TableCell className="text-sm">{a.userName}</TableCell>}
                  <TableCell className="text-sm">{a.customerOrganization}</TableCell>
                  <TableCell className="text-sm">{a.customerName}</TableCell>
                  <TableCell className="text-sm">{a.productCategory}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{a.remark ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(a)}>
                        <PencilIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteId(a.id)}>
                        <TrashIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
      </p>

      {/* Log / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingId ? "Edit Activity" : "Log Activity"}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 mt-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="act-date">Date *</Label>
              <Input id="act-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="act-org">Customer Organization *</Label>
              <Input id="act-org" placeholder="e.g. Hospital Kuala Lumpur" value={form.customerOrganization} onChange={(e) => setForm((f) => ({ ...f, customerOrganization: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="act-name">Customer Name *</Label>
              <Input id="act-name" placeholder="e.g. Dr. Ahmad" value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="act-cat">Product Category *</Label>
              <Select value={form.productCategory} onValueChange={(v) => setForm((f) => ({ ...f, productCategory: v }))}>
                <SelectTrigger id="act-cat">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="act-remark">Remark</Label>
              <Textarea id="act-remark" placeholder="Notes about the visit or interaction..." value={form.remark ?? ""} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} rows={4} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Upload Preview Dialog */}
      <Dialog open={uploadOpen} onOpenChange={(o: boolean) => { if (!o) { setUploadOpen(false); setUploadPreview(null); } }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Preview</DialogTitle>
            <DialogDescription>
              {validCount} valid row{validCount !== 1 ? "s" : ""} ready to import
              {errorCount > 0 && `, ${errorCount} row${errorCount !== 1 ? "s" : ""} with errors (will be skipped)`}.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto flex-1 rounded border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Customer Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(uploadPreview ?? []).map((row, i) => (
                  <TableRow key={i} className={row._error ? "bg-destructive/5" : ""}>
                    <TableCell className="p-2">
                      {row._error
                        ? <AlertCircleIcon className="h-3.5 w-3.5 text-destructive" />
                        : <CheckCircle2Icon className="h-3.5 w-3.5 text-green-500" />}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {row.date}
                      {row._error && <div className="text-[10px] text-destructive">{row._error}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{row.customerOrganization}</TableCell>
                    <TableCell className="text-xs">{row.customerName}</TableCell>
                    <TableCell className="text-xs">{row.productCategory}</TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-37.5">{row.remark}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadOpen(false); setUploadPreview(null); }} disabled={importing}>Cancel</Button>
            <Button onClick={handleImport} disabled={importing || validCount === 0}>
              {importing ? "Importing..." : `Import ${validCount} row${validCount !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteId} onOpenChange={(o: boolean) => { if (!o) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete activity?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
