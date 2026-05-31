"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClaimTypeRow } from "@/server/claim";
import {
  createClaimType,
  updateClaimType,
  deleteClaimType,
  seedDefaultClaimTypes,
} from "@/server/claim";
import { PlusIcon, PencilIcon, Trash2Icon, TagsIcon, SproutIcon } from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: "LOCAL",             label: "Local Reimbursement Claim" },
  { value: "OVERSEAS",          label: "Overseas Expenses Reimbursement" },
  { value: "ENTERTAINMENT_FORM",label: "Entertainment Form" },
];

const UNIT_TYPES = [
  { value: "AMOUNT", label: "Amount (RM)" },
];

const CATEGORY_COLORS: Record<string, string> = {
  LOCAL:             "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700",
  OVERSEAS:          "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-700",
  ENTERTAINMENT_FORM:"bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/20 dark:text-pink-400 dark:border-pink-700",
};

// ── Types ──────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  code: string;
  category: string;
  unitType: string;
  ratePerUnit: string;
  requiresReceipt: boolean;
  maxAmountPerClaim: string;
  maxAmountPerYear: string;
  description: string;
  sortOrder: string;
}

const emptyForm = (): FormState => ({
  name: "",
  code: "",
  category: "LOCAL",
  unitType: "AMOUNT",
  ratePerUnit: "",
  requiresReceipt: true,
  maxAmountPerClaim: "",
  maxAmountPerYear: "",
  description: "",
  sortOrder: "0",
});

function formFromRow(row: ClaimTypeRow): FormState {
  return {
    name: row.name,
    code: row.code,
    category: row.category,
    unitType: row.unitType,
    ratePerUnit: row.ratePerUnit ?? "",
    requiresReceipt: row.requiresReceipt,
    maxAmountPerClaim: row.maxAmountPerClaim ?? "",
    maxAmountPerYear: row.maxAmountPerYear ?? "",
    description: row.description ?? "",
    sortOrder: String(row.sortOrder),
  };
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  claimTypes: ClaimTypeRow[];
}

export function ClaimTypesClient({ claimTypes }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ClaimTypeRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ClaimTypeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [seeding, setSeeding] = useState(false);

  function openCreate() {
    setEditTarget(null);
    setForm(emptyForm());
    setSheetOpen(true);
  }

  function openEdit(row: ClaimTypeRow) {
    setEditTarget(row);
    setForm(formFromRow(row));
    setSheetOpen(true);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (!form.code.trim()) { toast.error("Code is required"); return; }
    if ((form.unitType === "KM" || form.unitType === "HOUR") && !form.ratePerUnit) {
      toast.error("Rate per unit is required for KM / Hour types"); return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        code: form.code,
        category: form.category,
        unitType: form.unitType,
        ratePerUnit: form.ratePerUnit || undefined,
        requiresReceipt: form.requiresReceipt,
        maxAmountPerClaim: form.maxAmountPerClaim || undefined,
        maxAmountPerYear: form.maxAmountPerYear || undefined,
        description: form.description || undefined,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
      };
      if (editTarget) {
        await updateClaimType(editTarget.id, {
          ...payload,
          ratePerUnit: form.ratePerUnit || null,
          maxAmountPerClaim: form.maxAmountPerClaim || null,
          maxAmountPerYear: form.maxAmountPerYear || null,
        });
        toast.success("Claim type updated");
      } else {
        await createClaimType(payload);
        toast.success("Claim type created");
      }
      setSheetOpen(false);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClaimType(deleteTarget.id);
      toast.success("Claim type deleted");
      setDeleteTarget(null);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSeed() {
    setSeeding(true);
    try {
      await seedDefaultClaimTypes();
      toast.success("Default claim types seeded");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to seed");
    } finally {
      setSeeding(false);
    }
  }

  const isRateType = form.unitType === "KM" || form.unitType === "HOUR";

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <TagsIcon className="h-5 w-5 text-muted-foreground" />
            Claim Types
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure expense claim categories, rates, and caps.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {claimTypes.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeed}
              disabled={seeding}
              className="gap-1.5"
            >
              <SproutIcon className="h-3.5 w-3.5" />
              {seeding ? "Seeding…" : "Seed Defaults"}
            </Button>
          )}
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <PlusIcon className="h-4 w-4" />
            New Type
          </Button>
        </div>
      </div>

      {/* Table */}
      {claimTypes.length === 0 ? (
        <div className="rounded-lg border border-border py-16 flex flex-col items-center gap-3 text-center">
          <TagsIcon className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-semibold text-foreground">No claim types yet</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Create your first claim type or seed the defaults.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Name</TableHead>
                <TableHead className="w-20">Code</TableHead>
                <TableHead className="w-28">Category</TableHead>
                <TableHead>Rate / Cap</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claimTypes.map((ct) => (
                <TableRow key={ct.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{ct.name}</span>
                      {ct.description && (
                        <span className="text-xs text-muted-foreground truncate max-w-56" title={ct.description}>
                          {ct.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {ct.code}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${CATEGORY_COLORS[ct.category] ?? CATEGORY_COLORS.OTHER}`}
                    >
                      {CATEGORIES.find((c) => c.value === ct.category)?.label ?? ct.category}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {ct.unitType !== "AMOUNT" && ct.ratePerUnit && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                          RM {parseFloat(ct.ratePerUnit).toFixed(2)}/{ct.unitType === "KM" ? "km" : "hr"}
                        </Badge>
                      )}
                      {ct.unitType === "AMOUNT" && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                          Amount
                        </Badge>
                      )}
                      {ct.maxAmountPerClaim && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-muted-foreground">
                          Max/claim RM {parseFloat(ct.maxAmountPerClaim).toFixed(0)}
                        </Badge>
                      )}
                      {ct.maxAmountPerYear && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-muted-foreground">
                          Cap/yr RM {parseFloat(ct.maxAmountPerYear).toFixed(0)}
                        </Badge>
                      )}
                      {ct.requiresReceipt && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-blue-600 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-700">
                          Receipt
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={ct.isActive
                        ? "text-xs text-green-700 border-green-200 bg-green-50 dark:text-green-400 dark:border-green-700"
                        : "text-xs text-muted-foreground"}
                    >
                      {ct.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => openEdit(ct)}
                        title="Edit"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(ct)}
                        title="Delete"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => !open && setSheetOpen(false)}>
        <SheetContent className="w-full max-w-2xl! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>{editTarget ? "Edit Claim Type" : "New Claim Type"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            {/* Name + Code */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="ct-name">Name <span className="text-destructive">*</span></Label>
                <Input
                  id="ct-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Mileage Claim"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-code">Code <span className="text-destructive">*</span></Label>
                <Input
                  id="ct-code"
                  value={form.code}
                  onChange={(e) => set("code", e.target.value.toUpperCase())}
                  placeholder="MILE"
                  maxLength={10}
                  disabled={!!editTarget}
                />
              </div>
            </div>

            {/* Category + Unit Type */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-category">Category <span className="text-destructive">*</span></Label>
                <Select value={form.category} onValueChange={(v) => set("category", v)}>
                  <SelectTrigger id="ct-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-unitType">Unit Type <span className="text-destructive">*</span></Label>
                <Select value={form.unitType} onValueChange={(v) => { set("unitType", v); set("ratePerUnit", ""); }}>
                  <SelectTrigger id="ct-unitType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_TYPES.map((u) => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Rate per unit — only for KM / HOUR */}
            {isRateType && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-rate">
                  Rate per {form.unitType === "KM" ? "km" : "hour"} (RM){" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ct-rate"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.ratePerUnit}
                  onChange={(e) => set("ratePerUnit", e.target.value)}
                  placeholder="e.g. 0.80"
                />
              </div>
            )}

            {/* Caps */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-maxClaim">
                  Max per claim (RM){" "}
                  <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <Input
                  id="ct-maxClaim"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.maxAmountPerClaim}
                  onChange={(e) => set("maxAmountPerClaim", e.target.value)}
                  placeholder="No cap"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-maxYear">
                  Annual cap (RM){" "}
                  <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <Input
                  id="ct-maxYear"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.maxAmountPerYear}
                  onChange={(e) => set("maxAmountPerYear", e.target.value)}
                  placeholder="No cap"
                />
              </div>
            </div>

            {/* Receipt required + Active */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">Receipt Required</p>
                  <p className="text-xs text-muted-foreground">
                    Applicant must attach a receipt or supporting document
                  </p>
                </div>
                <Switch
                  checked={form.requiresReceipt}
                  onCheckedChange={(v) => set("requiresReceipt", v)}
                />
              </div>
              {editTarget && (
                <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium">Active</p>
                    <p className="text-xs text-muted-foreground">
                      Inactive types are hidden from the claim form
                    </p>
                  </div>
                  <Switch
                    checked={form.unitType === form.unitType && (editTarget?.isActive ?? true)}
                    onCheckedChange={(v) =>
                      updateClaimType(editTarget.id, { isActive: v }).then(() =>
                        startTransition(() => router.refresh()),
                      )
                    }
                  />
                </div>
              )}
            </div>

            {/* Description + Sort */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-desc">
                Description{" "}
                <span className="text-muted-foreground font-normal text-xs">(optional)</span>
              </Label>
              <Textarea
                id="ct-desc"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={2}
                placeholder="Brief description shown to employees"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-sort">Sort Order</Label>
              <Input
                id="ct-sort"
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", e.target.value)}
                className="w-24"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Saving…" : editTarget ? "Save Changes" : "Create Type"}
              </Button>
              <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Sheet */}
      <Sheet open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Delete Claim Type</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <strong className="text-foreground">{deleteTarget?.name}</strong>?
            </p>
            <div className="rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700 p-3 text-sm text-amber-700 dark:text-amber-400">
              If this claim type has existing applications, deletion will fail — deactivate it instead.
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1"
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
