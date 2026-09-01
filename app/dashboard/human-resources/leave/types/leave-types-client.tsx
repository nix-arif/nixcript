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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LeaveTypeRow } from "@/server/leave";
import {
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  seedDefaultLeaveTypes,
} from "@/server/leave";
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  RefreshCwIcon,
  SettingsIcon,
  ToggleRightIcon,
  ToggleLeftIcon,
} from "lucide-react";

// ── Entitlement rules ──────────────────────────────────────────────────────

interface EntitlementRule {
  minYears: number;
  maxYears: number | null;
  days: number;
}

// Matches the existing "Medical/Sick Leave" naming convention — one shared
// trailing "Leave", not "Annual Leave/Emergency Leave".
function withEmergencyLabel(name: string, hasThreshold: boolean): string {
  if (!hasThreshold) return name;
  return `${name.replace(/\s*Leave$/i, "")}/Emergency Leave`;
}

function formatEntitlementRules(
  rules: Array<{ minYears: number; maxYears: number | null; days: number }>,
): string {
  if (rules.length === 0) return "—";
  if (rules.length === 1 && rules[0].maxYears === null && rules[0].minYears === 0) {
    return `${rules[0].days} days (fixed)`;
  }
  return rules
    .map((r) => (r.maxYears === null ? `${r.days}d (${r.minYears}+yr)` : `${r.days}d (<${r.maxYears}yr)`))
    .join(" · ");
}

function EntitlementRuleEditor({
  rules,
  onChange,
}: {
  rules: EntitlementRule[];
  onChange: (rules: EntitlementRule[]) => void;
}) {
  function update(idx: number, field: keyof EntitlementRule, value: string) {
    onChange(
      rules.map((r, i) => {
        if (i !== idx) return r;
        if (field === "maxYears")
          return { ...r, maxYears: value === "" ? null : parseInt(value, 10) };
        return { ...r, [field]: parseInt(value, 10) || 0 };
      }),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Entitlement Rules</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => onChange([...rules, { minYears: 0, maxYears: null, days: 0 }])}
        >
          <PlusIcon className="h-3 w-3" />
          Add Rule
        </Button>
      </div>
      {rules.length === 0 && (
        <p className="text-xs text-muted-foreground">No rules defined. Add at least one rule.</p>
      )}
      {rules.map((rule, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-3 rounded-md bg-muted/40 border border-border">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Min Years</Label>
            <input
              type="number"
              min={0}
              value={rule.minYears}
              onChange={(e) => update(idx, "minYears", e.target.value)}
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Max Years (blank = ∞)</Label>
            <input
              type="number"
              min={0}
              value={rule.maxYears ?? ""}
              onChange={(e) => update(idx, "maxYears", e.target.value)}
              placeholder="∞"
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Days</Label>
            <input
              type="number"
              min={0}
              value={rule.days}
              onChange={(e) => update(idx, "days", e.target.value)}
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(rules.filter((_, i) => i !== idx))}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ── Credit hour rules (credit-based types only) ─────────────────────────────

interface CreditHourRule {
  minHours: number;
  maxHours: number | null;
  days: number;
}

function formatHourRules(rules: Array<{ minHours: number; maxHours: number | null; days: number }>): string {
  if (rules.length === 0) return "1 day per date (default)";
  return rules
    .map((r) => (r.maxHours === null ? `${r.days}d (${r.minHours}h+)` : `${r.days}d (<${r.maxHours}h)`))
    .join(" · ");
}

// Sibling to EntitlementRuleEditor below — same row-based min/max/days
// editor, keyed by hours worked on a single date instead of years of
// service. Kept separate rather than generalized since EntitlementRuleEditor
// is load-bearing for the tenure-tier feature already.
function CreditHourRuleEditor({
  rules,
  onChange,
}: {
  rules: CreditHourRule[];
  onChange: (rules: CreditHourRule[]) => void;
}) {
  function update(idx: number, field: keyof CreditHourRule, value: string) {
    onChange(
      rules.map((r, i) => {
        if (i !== idx) return r;
        if (field === "maxHours")
          return { ...r, maxHours: value === "" ? null : parseFloat(value) };
        if (field === "days") return { ...r, days: parseFloat(value) || 0 };
        return { ...r, [field]: parseFloat(value) || 0 };
      }),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Hours &rarr; Days Rules</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => onChange([...rules, { minHours: 0, maxHours: null, days: 0 }])}
        >
          <PlusIcon className="h-3 w-3" />
          Add Rule
        </Button>
      </div>
      {rules.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No rules defined — every worked date will credit a flat 1 day regardless of hours.
        </p>
      )}
      {rules.map((rule, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-3 rounded-md bg-muted/40 border border-border">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Min Hours</Label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={rule.minHours}
              onChange={(e) => update(idx, "minHours", e.target.value)}
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Max Hours (blank = &infin;)</Label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={rule.maxHours ?? ""}
              onChange={(e) => update(idx, "maxHours", e.target.value)}
              placeholder="∞"
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Days</Label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={rule.days}
              onChange={(e) => update(idx, "days", e.target.value)}
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(rules.filter((_, i) => i !== idx))}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ── Form types ─────────────────────────────────────────────────────────────

interface FormData {
  name: string;
  code: string;
  isPaid: boolean;
  requiresDocument: boolean;
  allowHalfDay: boolean;
  isCreditBased: boolean;
  maxDaysPerApplication: string;
  carryForwardEnabled: boolean;
  maxCarryForward: string;
  carryForwardExpiryMonths: string;
  emergencyThresholdDays: string;
  entitlementRules: EntitlementRule[];
  creditHourRules: CreditHourRule[];
  creditExpiryDays: string;
  sortOrder: string;
  description: string;
}

const defaultForm: FormData = {
  name: "",
  code: "",
  isPaid: true,
  requiresDocument: false,
  allowHalfDay: true,
  isCreditBased: false,
  maxDaysPerApplication: "",
  carryForwardEnabled: false,
  maxCarryForward: "",
  carryForwardExpiryMonths: "",
  emergencyThresholdDays: "",
  entitlementRules: [{ minYears: 0, maxYears: null, days: 0 }],
  creditHourRules: [],
  creditExpiryDays: "",
  sortOrder: "0",
  description: "",
};

function rowToForm(lt: LeaveTypeRow): FormData {
  return {
    name: lt.name,
    code: lt.code,
    isPaid: lt.isPaid,
    requiresDocument: lt.requiresDocument,
    allowHalfDay: lt.allowHalfDay,
    isCreditBased: lt.isCreditBased,
    maxDaysPerApplication: lt.maxDaysPerApplication?.toString() ?? "",
    carryForwardEnabled: lt.carryForwardEnabled,
    maxCarryForward: lt.maxCarryForward?.toString() ?? "",
    carryForwardExpiryMonths: lt.carryForwardExpiryMonths?.toString() ?? "",
    emergencyThresholdDays: lt.emergencyThresholdDays?.toString() ?? "",
    entitlementRules: (lt.entitlementRules ?? []) as EntitlementRule[],
    creditHourRules: (lt.creditHourRules ?? []) as CreditHourRule[],
    creditExpiryDays: lt.creditExpiryDays?.toString() ?? "",
    sortOrder: lt.sortOrder.toString(),
    description: lt.description ?? "",
  };
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  types: LeaveTypeRow[];
  permissions: string[];
}

export function LeaveTypesClient({ types, permissions: _permissions }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [editTarget, setEditTarget] = useState<LeaveTypeRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormData>(defaultForm);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<LeaveTypeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [seeding, setSeeding] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function openCreate() {
    setForm(defaultForm);
    setEditTarget(null);
    setDialogOpen(true);
  }

  function openEdit(lt: LeaveTypeRow) {
    setForm(rowToForm(lt));
    setEditTarget(lt);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("Name and code are required");
      return;
    }
    if (form.entitlementRules.length === 0) {
      toast.error("At least one entitlement rule is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        isPaid: form.isPaid,
        requiresDocument: form.requiresDocument,
        allowHalfDay: form.allowHalfDay,
        isCreditBased: form.isCreditBased,
        maxDaysPerApplication: form.maxDaysPerApplication
          ? parseInt(form.maxDaysPerApplication, 10)
          : undefined,
        carryForwardEnabled: form.carryForwardEnabled,
        maxCarryForward: form.maxCarryForward
          ? parseInt(form.maxCarryForward, 10)
          : undefined,
        carryForwardExpiryMonths: form.carryForwardExpiryMonths
          ? parseInt(form.carryForwardExpiryMonths, 10)
          : undefined,
        emergencyThresholdDays: form.emergencyThresholdDays
          ? parseInt(form.emergencyThresholdDays, 10)
          : undefined,
        entitlementRules: form.entitlementRules,
        creditHourRules: form.creditHourRules,
        creditExpiryDays: form.creditExpiryDays
          ? parseInt(form.creditExpiryDays, 10)
          : undefined,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
        description: form.description.trim() || undefined,
      };
      if (editTarget) {
        await updateLeaveType(editTarget.id, payload);
        toast.success("Leave type updated");
      } else {
        await createLeaveType(payload);
        toast.success("Leave type created");
      }
      setDialogOpen(false);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(lt: LeaveTypeRow) {
    setTogglingId(lt.id);
    try {
      await updateLeaveType(lt.id, { isActive: !lt.isActive });
      toast.success(`Leave type ${lt.isActive ? "deactivated" : "activated"}`);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteLeaveType(deleteTarget.id);
      toast.success("Leave type deleted");
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
      await seedDefaultLeaveTypes();
      toast.success("Malaysia default leave types seeded successfully");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to seed");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-muted-foreground" />
            Leave Types
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure leave types and entitlement rules for your organisation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {types.length === 0 && (
            <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
              <RefreshCwIcon className={`h-4 w-4 mr-1 ${seeding ? "animate-spin" : ""}`} />
              {seeding ? "Seeding…" : "Seed Malaysia Defaults"}
            </Button>
          )}
          <Button size="sm" onClick={openCreate}>
            <PlusIcon className="h-4 w-4 mr-1" />
            New Leave Type
          </Button>
        </div>
      </div>

      {types.length === 0 ? (
        <div className="rounded-lg border border-border py-14 flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">No leave types configured yet.</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
              <RefreshCwIcon className={`h-4 w-4 mr-1 ${seeding ? "animate-spin" : ""}`} />
              {seeding ? "Seeding…" : "Seed Malaysia Defaults"}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <PlusIcon className="h-4 w-4 mr-1" />
              Create Custom Type
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-20">Category</TableHead>
                <TableHead>Entitlement</TableHead>
                {/* Flags: MC · ½ · CF — compact column */}
                <TableHead className="w-28">Options</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((lt) => (
                <TableRow key={lt.id} className={!lt.isActive ? "opacity-60" : undefined}>
                  {/* Code */}
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs px-1.5 py-0 h-5">
                      {lt.code}
                    </Badge>
                  </TableCell>

                  {/* Name + description */}
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {withEmergencyLabel(lt.name, lt.emergencyThresholdDays != null)}
                      </span>
                      {lt.description && (
                        <span
                          className="text-xs text-muted-foreground truncate max-w-56"
                          title={lt.description}
                        >
                          {lt.description}
                        </span>
                      )}
                    </div>
                  </TableCell>

                  {/* Paid / Unpaid */}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs px-1.5 py-0 h-5 ${
                        lt.isPaid
                          ? "text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-700 dark:bg-blue-900/20"
                          : "text-muted-foreground"
                      }`}
                    >
                      {lt.isPaid ? "Paid" : "Unpaid"}
                    </Badge>
                  </TableCell>

                  {/* Entitlement */}
                  <TableCell className="text-sm text-muted-foreground">
                    {lt.isCreditBased
                      ? formatHourRules(
                          lt.creditHourRules as Array<{
                            minHours: number;
                            maxHours: number | null;
                            days: number;
                          }>,
                        )
                      : formatEntitlementRules(
                          lt.entitlementRules as Array<{
                            minYears: number;
                            maxYears: number | null;
                            days: number;
                          }>,
                        )}
                  </TableCell>

                  {/* Options — compact flags */}
                  <TableCell>
                    <div className="flex items-center gap-1 flex-wrap">
                      {lt.requiresDocument && (
                        <Badge
                          variant="outline"
                          className="text-xs px-1.5 py-0 h-5 text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-700"
                          title="MC/document required"
                        >
                          MC
                        </Badge>
                      )}
                      {lt.allowHalfDay && (
                        <Badge
                          variant="outline"
                          className="text-xs px-1.5 py-0 h-5 text-green-700 border-green-200 bg-green-50 dark:text-green-400 dark:border-green-700"
                          title="Half-day allowed"
                        >
                          ½ day
                        </Badge>
                      )}
                      {lt.carryForwardEnabled && (
                        <Badge
                          variant="outline"
                          className="text-xs px-1.5 py-0 h-5 text-indigo-700 border-indigo-200 bg-indigo-50 dark:text-indigo-400 dark:border-indigo-700"
                          title={
                            (lt.maxCarryForward !== null
                              ? `Carry forward up to ${lt.maxCarryForward} days`
                              : "Carry forward unlimited") +
                            (lt.carryForwardExpiryMonths
                              ? `, expires end of month ${lt.carryForwardExpiryMonths} each year`
                              : "")
                          }
                        >
                          {lt.maxCarryForward !== null ? `CF ${lt.maxCarryForward}d` : "CF"}
                          {lt.carryForwardExpiryMonths ? ` (${lt.carryForwardExpiryMonths}mo)` : ""}
                        </Badge>
                      )}
                      {lt.isCreditBased && (
                        <Badge
                          variant="outline"
                          className="text-xs px-1.5 py-0 h-5 text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-400 dark:border-orange-700"
                          title="Entitlement is earned via approved replacement-credit requests, not an annual tier"
                        >
                          Credit-based
                        </Badge>
                      )}
                      {lt.isCreditBased && lt.creditExpiryDays !== null && (
                        <Badge
                          variant="outline"
                          className="text-xs px-1.5 py-0 h-5 text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-400 dark:border-orange-700"
                          title={`Each approved credit request expires ${lt.creditExpiryDays} days after its own approval date`}
                        >
                          Expires {lt.creditExpiryDays}d
                        </Badge>
                      )}
                      {lt.emergencyThresholdDays !== null && (
                        <Badge
                          variant="outline"
                          className="text-xs px-1.5 py-0 h-5 text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-400 dark:border-orange-700"
                          title={`Applications of ≤${lt.emergencyThresholdDays} days are auto-recorded as Emergency Leave, drawn from this same balance`}
                        >
                          EL ≤{lt.emergencyThresholdDays}d
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs px-1.5 py-0 h-5 ${
                        lt.isActive
                          ? "text-green-700 border-green-200 bg-green-50 dark:text-green-400 dark:border-green-700"
                          : "text-muted-foreground"
                      }`}
                    >
                      {lt.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => openEdit(lt)}
                        title="Edit"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        disabled={togglingId === lt.id}
                        onClick={() => handleToggle(lt)}
                        title={lt.isActive ? "Deactivate" : "Activate"}
                      >
                        {lt.isActive ? (
                          <ToggleRightIcon className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <ToggleLeftIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(lt)}
                        title="Delete"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
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
      <Sheet open={dialogOpen} onOpenChange={(open) => !open && setDialogOpen(false)}>
        <SheetContent className="w-full max-w-2xl! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>{editTarget ? "Edit Leave Type" : "New Leave Type"}</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            {/* Name + Code */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ltName">
                  Name <span className="text-destructive">*</span>
                </Label>
                <input
                  id="ltName"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Annual Leave"
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ltCode">
                  Code <span className="text-destructive">*</span>
                </Label>
                <input
                  id="ltCode"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="AL"
                  maxLength={10}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                  disabled={!!editTarget}
                />
                {editTarget && (
                  <p className="text-xs text-muted-foreground">Code cannot be changed after creation.</p>
                )}
              </div>
            </div>

            {/* Toggles */}
            <div className="rounded-md border border-border p-3 grid grid-cols-3 gap-3">
              {[
                { id: "ltIsPaid", label: "Paid Leave", field: "isPaid" as const },
                { id: "ltRequiresDoc", label: "Requires MC/Doc", field: "requiresDocument" as const },
                { id: "ltAllowHalfDay", label: "Allow Half-day", field: "allowHalfDay" as const },
                { id: "ltIsCreditBased", label: "Credit-Based Entitlement", field: "isCreditBased" as const },
              ].map(({ id, label, field }) => (
                <label key={id} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    id={id}
                    checked={form[field] as boolean}
                    onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.checked }))}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
            {form.isCreditBased && (
              <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  Entitlement isn&apos;t computed from the tier table below — it starts at 0 (set the
                  rule&apos;s days to 0) and grows only as members&apos; &ldquo;Request Replacement
                  Credit&rdquo; submissions get approved. Members then apply for the leave itself
                  normally, against that earned balance.
                </p>
                <CreditHourRuleEditor
                  rules={form.creditHourRules}
                  onChange={(creditHourRules) => setForm((f) => ({ ...f, creditHourRules }))}
                />
                <p className="text-xs text-muted-foreground">
                  Converts the hours worked on each claimed date into a day credit — e.g. under 4h
                  worked earns nothing, 4&ndash;8h counts as half a day, 8h+ earns a full day. Leave
                  empty to credit a flat 1 day per date regardless of hours.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="ltCreditExpiryDays">Credit Expires After (days)</Label>
                  <input
                    id="ltCreditExpiryDays"
                    type="number"
                    min={1}
                    value={form.creditExpiryDays}
                    onChange={(e) => setForm((f) => ({ ...f, creditExpiryDays: e.target.value }))}
                    placeholder="Never expires"
                    className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    Each approved credit request stays usable for this many days from the date it was
                    approved (its own window, not a shared yearly cutoff). Leave empty to never expire.
                  </p>
                </div>
              </div>
            )}

            {/* Max days + sort order */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ltMaxDays">Max Days Per Application</Label>
                <input
                  id="ltMaxDays"
                  type="number"
                  min={1}
                  value={form.maxDaysPerApplication}
                  onChange={(e) => setForm((f) => ({ ...f, maxDaysPerApplication: e.target.value }))}
                  placeholder="No limit"
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ltSortOrder">Sort Order</Label>
                <input
                  id="ltSortOrder"
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {/* Carry forward */}
            <div className="rounded-md border border-border p-3 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="ltCarryFwd"
                  checked={form.carryForwardEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, carryForwardEnabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-sm font-medium">Enable Carry Forward</span>
              </label>
              {form.carryForwardEnabled && (
                <div className="grid grid-cols-2 gap-4 pl-6">
                  <div className="space-y-1.5">
                    <Label htmlFor="ltMaxCarryFwd">Max Carry Forward Days</Label>
                    <input
                      id="ltMaxCarryFwd"
                      type="number"
                      min={0}
                      value={form.maxCarryForward}
                      onChange={(e) => setForm((f) => ({ ...f, maxCarryForward: e.target.value }))}
                      placeholder="Leave blank for unlimited"
                      className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ltCarryFwdExpiry">Expires After (months)</Label>
                    <input
                      id="ltCarryFwdExpiry"
                      type="number"
                      min={1}
                      max={12}
                      value={form.carryForwardExpiryMonths}
                      onChange={(e) => setForm((f) => ({ ...f, carryForwardExpiryMonths: e.target.value }))}
                      placeholder="Never expires"
                      className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <p className="text-xs text-muted-foreground">
                      e.g. 3 = carried-forward days must be used by 31 March, then forfeited.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Emergency Leave threshold */}
            <div className="rounded-md border border-border p-3 space-y-1.5">
              <Label htmlFor="ltEmergencyThreshold">Emergency Leave Threshold (days)</Label>
              <input
                id="ltEmergencyThreshold"
                type="number"
                min={0}
                value={form.emergencyThresholdDays}
                onChange={(e) => setForm((f) => ({ ...f, emergencyThresholdDays: e.target.value }))}
                placeholder="Leave blank to disable"
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Applications against this leave type of this many days or fewer are automatically
                recorded as <strong>Emergency Leave</strong> instead of {form.name || "this type"}.
                They still draw from this same balance — Emergency Leave is not a separate pool.
                Normally set on Annual Leave only.
              </p>
            </div>

            {/* Entitlement rules */}
            <EntitlementRuleEditor
              rules={form.entitlementRules}
              onChange={(rules) => setForm((f) => ({ ...f, entitlementRules: rules }))}
            />

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="ltDescription">Description</Label>
              <Textarea
                id="ltDescription"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional description…"
                rows={2}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Saving…" : editTarget ? "Save Changes" : "Create Leave Type"}
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirm Sheet */}
      <Sheet open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Delete Leave Type</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <strong className="text-foreground">
                {deleteTarget?.name} ({deleteTarget?.code})
              </strong>
              ? This action cannot be undone.
            </p>
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 p-3 text-sm text-amber-700 dark:text-amber-400">
              If this leave type has existing applications, deletion will fail. Consider deactivating
              it instead to prevent new applications.
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="flex-1">
                {deleting ? "Deleting…" : "Delete Leave Type"}
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
