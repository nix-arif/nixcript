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
import type { ClaimTypeRow, ClaimCategoryAccountRow } from "@/server/claim";
import type { LedgerAccountRow } from "@/server/ledger";
import {
  createClaimType,
  updateClaimType,
  deleteClaimType,
  seedDefaultClaimTypes,
  setClaimCategoryAccount,
} from "@/server/claim";
import { PlusIcon, PencilIcon, Trash2Icon, TagsIcon, SproutIcon, BookOpenIcon } from "lucide-react";

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
  isActive: boolean;
  maxAmountPerClaim: string;
  maxAmountPerYear: string;
  hotelCapPerNight: string;
  mealBreakfastRate: string;
  mealLunchRate: string;
  mealDinnerRate: string;
  description: string;
  sortOrder: string;
  debitAccountId: string;
}

const emptyForm = (): FormState => ({
  name: "",
  code: "",
  category: "LOCAL",
  unitType: "AMOUNT",
  ratePerUnit: "",
  requiresReceipt: true,
  isActive: true,
  maxAmountPerClaim: "",
  maxAmountPerYear: "",
  hotelCapPerNight: "",
  mealBreakfastRate: "",
  mealLunchRate: "",
  mealDinnerRate: "",
  description: "",
  sortOrder: "0",
  debitAccountId: "",
});

function formFromRow(row: ClaimTypeRow): FormState {
  return {
    name: row.name,
    code: row.code,
    category: row.category,
    unitType: row.unitType,
    ratePerUnit: row.ratePerUnit ?? "",
    requiresReceipt: row.requiresReceipt,
    isActive: row.isActive,
    maxAmountPerClaim: row.maxAmountPerClaim ?? "",
    maxAmountPerYear: row.maxAmountPerYear ?? "",
    hotelCapPerNight: row.hotelCapPerNight ?? "",
    mealBreakfastRate: row.mealBreakfastRate ?? "",
    mealLunchRate: row.mealLunchRate ?? "",
    mealDinnerRate: row.mealDinnerRate ?? "",
    description: row.description ?? "",
    sortOrder: String(row.sortOrder),
    debitAccountId: row.debitAccountId ?? "",
  };
}

// ── Component ──────────────────────────────────────────────────────────────

// All categories that can be mapped, with friendly labels and groups
const CATEGORY_MAPPINGS: { value: string; label: string; group: string }[] = [
  { value: "TRAVEL",                label: "Travel — Mileage / Petrol",    group: "Local" },
  { value: "TRAVEL_DAILY_ALLOWANCE",label: "Travel — Daily Allowance",     group: "Local" },
  { value: "TRAVEL_ACCOMMODATION",  label: "Travel — Accommodation",       group: "Local" },
  { value: "TRAVEL_ENTERTAINMENT",  label: "Travel — Entertainment",       group: "Local" },
  { value: "TOLL",                  label: "Toll",                         group: "Local" },
  { value: "PARKING",               label: "Parking",                      group: "Local" },
  { value: "MOBILE",                label: "Mobile / Phone",               group: "Local" },
  { value: "IN_BASE_ENT",           label: "In-base Entertainment",        group: "Local" },
  { value: "OTHER_LOCAL",           label: "Other Local",                  group: "Local" },
  { value: "OVERSEAS_MYR",          label: "Overseas (MYR)",               group: "Overseas" },
  { value: "OVERSEAS_FX",           label: "Overseas (Foreign Currency)",  group: "Overseas" },
  { value: "OVERSEAS_OTHER",        label: "Overseas — Other",             group: "Overseas" },
  { value: "ENTERTAINMENT_FORM",    label: "Entertainment Form (whole claim)", group: "Entertainment" },
];

interface Props {
  claimTypes: ClaimTypeRow[];
  expenseAccounts: LedgerAccountRow[];
  initialCategoryMappings: ClaimCategoryAccountRow[];
}

export function ClaimTypesClient({ claimTypes, expenseAccounts, initialCategoryMappings }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ClaimTypeRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ClaimTypeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [seeding, setSeeding] = useState(false);

  // Category → account mappings state
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>(
    Object.fromEntries(initialCategoryMappings.map((m) => [m.category, m.ledgerAccountId])),
  );
  const [savingCategory, setSavingCategory] = useState<string | null>(null);

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
        isActive: form.isActive,
        maxAmountPerClaim: form.maxAmountPerClaim || undefined,
        maxAmountPerYear: form.maxAmountPerYear || undefined,
        hotelCapPerNight: form.hotelCapPerNight || undefined,
        mealBreakfastRate: form.mealBreakfastRate || undefined,
        mealLunchRate: form.mealLunchRate || undefined,
        mealDinnerRate: form.mealDinnerRate || undefined,
        description: form.description || undefined,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
        debitAccountId: form.debitAccountId || undefined,
      };
      if (editTarget) {
        await updateClaimType(editTarget.id, {
          ...payload,
          ratePerUnit: form.ratePerUnit || null,
          maxAmountPerClaim: form.maxAmountPerClaim || null,
          maxAmountPerYear: form.maxAmountPerYear || null,
          hotelCapPerNight: form.hotelCapPerNight || null,
          mealBreakfastRate: form.mealBreakfastRate || null,
          mealLunchRate: form.mealLunchRate || null,
          mealDinnerRate: form.mealDinnerRate || null,
          debitAccountId: form.debitAccountId || null,
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

  async function handleCategoryAccountChange(category: string, accountId: string) {
    const value = accountId === "__none__" ? null : accountId;
    setSavingCategory(category);
    try {
      await setClaimCategoryAccount(category, value);
      setCategoryMap((prev) => {
        const next = { ...prev };
        if (value) next[category] = value;
        else delete next[category];
        return next;
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setSavingCategory(null);
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
  const isLocal = form.category === "LOCAL";

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
                <TableHead className="w-36">Expense Account</TableHead>
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
                      {ct.ratePerUnit && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                          RM {parseFloat(ct.ratePerUnit).toFixed(2)}/km
                        </Badge>
                      )}
                      {!ct.ratePerUnit && ct.unitType === "AMOUNT" && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                          Amount
                        </Badge>
                      )}
                      {ct.hotelCapPerNight && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700">
                          Hotel cap RM {parseFloat(ct.hotelCapPerNight).toFixed(0)}/night
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
                    {ct.debitAccountId ? (
                      <span className="text-xs font-mono text-muted-foreground">
                        {expenseAccounts.find((a) => a.id === ct.debitAccountId)?.code ?? "—"}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
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

            {/* Mileage rate — always shown for LOCAL, or for KM/HOUR unit types */}
            {(isLocal || isRateType) && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-rate">
                  Mileage rate (RM/km){" "}
                  {isRateType && <span className="text-destructive">*</span>}
                  {!isRateType && <span className="text-muted-foreground font-normal text-xs">(for travel section)</span>}
                </Label>
                <Input
                  id="ct-rate"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.ratePerUnit}
                  onChange={(e) => set("ratePerUnit", e.target.value)}
                  placeholder="e.g. 0.50"
                />
              </div>
            )}

            {/* Hotel cap — only for LOCAL */}
            {isLocal && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-hotelCap">
                  Outstation hotel cap (RM/night){" "}
                  <span className="text-muted-foreground font-normal text-xs">(optional — receipts above this are capped)</span>
                </Label>
                <Input
                  id="ct-hotelCap"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.hotelCapPerNight}
                  onChange={(e) => set("hotelCapPerNight", e.target.value)}
                  placeholder="e.g. 200.00"
                />
              </div>
            )}

            {/* Meal rates — only for LOCAL */}
            {isLocal && (
              <div className="flex flex-col gap-2">
                <Label>
                  Daily meal allowance rates{" "}
                  <span className="text-muted-foreground font-normal text-xs">(optional — set fixed per-meal rates for outstation travel)</span>
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Breakfast (RM)</span>
                    <Input
                      type="number" min="0" step="0.01"
                      value={form.mealBreakfastRate}
                      onChange={(e) => set("mealBreakfastRate", e.target.value)}
                      placeholder="e.g. 10.00"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Lunch (RM)</span>
                    <Input
                      type="number" min="0" step="0.01"
                      value={form.mealLunchRate}
                      onChange={(e) => set("mealLunchRate", e.target.value)}
                      placeholder="e.g. 15.00"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Dinner (RM)</span>
                    <Input
                      type="number" min="0" step="0.01"
                      value={form.mealDinnerRate}
                      onChange={(e) => set("mealDinnerRate", e.target.value)}
                      placeholder="e.g. 20.00"
                    />
                  </div>
                </div>
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
                    checked={form.isActive}
                    onCheckedChange={(v) => set("isActive", v)}
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

            {/* Expense account for journal posting */}
            <div className="flex flex-col gap-1.5 rounded-md border border-border p-4 bg-muted/10">
              <div className="flex items-center gap-2 mb-1">
                <BookOpenIcon className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="ct-account" className="text-sm font-medium">
                  Expense account{" "}
                  <span className="text-muted-foreground font-normal text-xs">(for auto journal on approval)</span>
                </Label>
              </div>
              {expenseAccounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No EXPENSE accounts in your Chart of Accounts yet. Add one first under Ledger → Accounts.
                </p>
              ) : (
                <Select
                  value={form.debitAccountId || "__none__"}
                  onValueChange={(v) => set("debitAccountId", v === "__none__" ? "" : v)}
                >
                  <SelectTrigger id="ct-account">
                    <SelectValue placeholder="Not mapped — no journal will be posted" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not mapped</SelectItem>
                    {expenseAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Also ensure a <strong>Staff Claims Payable</strong> account with subtype{" "}
                <code className="font-mono text-[11px]">STAFF_CLAIMS_PAYABLE</code> exists in your COA — that is used as the credit side.
              </p>
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

      {/* Category → COA Account Mapping */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <BookOpenIcon className="h-4 w-4 text-muted-foreground" />
            Expense Category → Account Mapping
          </h2>
          <p className="text-sm text-muted-foreground">
            Map each line-item category to a COA expense account. On approval, the journal entry
            posts one debit line per account. Unmapped categories fall back to the claim type's
            expense account if set.
          </p>
        </div>

        {expenseAccounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No EXPENSE accounts in your Chart of Accounts yet.
            Go to <strong>Ledger → Accounts</strong> and create your expense accounts first.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            {["Local", "Overseas", "Entertainment"].map((group) => {
              const rows = CATEGORY_MAPPINGS.filter((c) => c.group === group);
              return (
                <div key={group}>
                  <div className="px-4 py-2 bg-muted/30 border-b border-border">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{group}</span>
                  </div>
                  {rows.map((cat, i) => (
                    <div
                      key={cat.value}
                      className={`grid grid-cols-[1fr_280px] items-center px-4 py-2.5 gap-4 ${
                        i < rows.length - 1 ? "border-b border-border/50" : ""
                      }`}
                    >
                      <span className="text-sm">{cat.label}</span>
                      <div className="relative">
                        <Select
                          value={categoryMap[cat.value] ?? "__none__"}
                          onValueChange={(v) => handleCategoryAccountChange(cat.value, v)}
                          disabled={savingCategory === cat.value}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="— Not mapped" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Not mapped</SelectItem>
                            {expenseAccounts.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.code} — {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {savingCategory === cat.value && (
                          <span className="absolute right-8 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 px-4 py-3 text-xs text-blue-700 dark:text-blue-400 space-y-1">
          <p><strong>Also required:</strong> a <strong>Staff Claims Payable</strong> account in Ledger → Accounts with subtype set to <code className="font-mono">STAFF_CLAIMS_PAYABLE</code> — this is the credit side of every claim journal entry.</p>
        </div>
      </div>

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
