"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { PlusIcon, PencilIcon, TrashIcon, RefreshCwIcon } from "lucide-react";

/* =========================
   ENTITLEMENT RULES DISPLAY
========================= */

function formatEntitlementRules(
  rules: Array<{ minYears: number; maxYears: number | null; days: number }>,
): string {
  if (rules.length === 0) return "—";
  if (rules.length === 1 && rules[0].maxYears === null && rules[0].minYears === 0) {
    return `${rules[0].days} days (fixed)`;
  }
  return rules
    .map((r) => {
      if (r.maxYears === null) return `${r.days}d (${r.minYears}+yr)`;
      return `${r.days}d (<${r.maxYears}yr)`;
    })
    .join(" / ");
}

/* =========================
   ENTITLEMENT RULE EDITOR
========================= */

interface EntitlementRule {
  minYears: number;
  maxYears: number | null;
  days: number;
}

function EntitlementRuleEditor({
  rules,
  onChange,
}: {
  rules: EntitlementRule[];
  onChange: (rules: EntitlementRule[]) => void;
}) {
  function addRule() {
    onChange([...rules, { minYears: 0, maxYears: null, days: 0 }]);
  }
  function removeRule(idx: number) {
    onChange(rules.filter((_, i) => i !== idx));
  }
  function updateRule(idx: number, field: keyof EntitlementRule, value: string) {
    const updated = rules.map((r, i) => {
      if (i !== idx) return r;
      if (field === "maxYears") {
        return { ...r, maxYears: value === "" ? null : parseInt(value, 10) };
      }
      return { ...r, [field]: field === "minYears" || field === "days" ? parseInt(value, 10) || 0 : value };
    });
    onChange(updated);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Entitlement Rules</Label>
        <Button type="button" variant="outline" size="sm" onClick={addRule} className="gap-1 text-xs">
          <PlusIcon className="h-3 w-3" />
          Add Rule
        </Button>
      </div>
      {rules.length === 0 && (
        <p className="text-xs text-gray-400">No rules defined. Add at least one rule.</p>
      )}
      {rules.map((rule, idx) => (
        <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
          <div className="flex-1 grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs text-gray-500">Min Years</Label>
              <input
                type="number"
                min={0}
                value={rule.minYears}
                onChange={(e) => updateRule(idx, "minYears", e.target.value)}
                className="w-full border border-input rounded px-2 py-1 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Max Years (blank=∞)</Label>
              <input
                type="number"
                min={0}
                value={rule.maxYears ?? ""}
                onChange={(e) => updateRule(idx, "maxYears", e.target.value)}
                placeholder="∞"
                className="w-full border border-input rounded px-2 py-1 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Days</Label>
              <input
                type="number"
                min={0}
                value={rule.days}
                onChange={(e) => updateRule(idx, "days", e.target.value)}
                className="w-full border border-input rounded px-2 py-1 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-red-400 hover:text-red-600 mt-3"
            onClick={() => removeRule(idx)}
          >
            <TrashIcon className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

/* =========================
   LEAVE TYPE FORM
========================= */

interface LeaveTypeFormData {
  name: string;
  code: string;
  isPaid: boolean;
  requiresDocument: boolean;
  allowHalfDay: boolean;
  maxDaysPerApplication: string;
  carryForwardEnabled: boolean;
  maxCarryForward: string;
  entitlementRules: EntitlementRule[];
  sortOrder: string;
  description: string;
}

const defaultFormData: LeaveTypeFormData = {
  name: "",
  code: "",
  isPaid: true,
  requiresDocument: false,
  allowHalfDay: true,
  maxDaysPerApplication: "",
  carryForwardEnabled: false,
  maxCarryForward: "",
  entitlementRules: [{ minYears: 0, maxYears: null, days: 0 }],
  sortOrder: "0",
  description: "",
};

function leaveTypeToFormData(lt: LeaveTypeRow): LeaveTypeFormData {
  return {
    name: lt.name,
    code: lt.code,
    isPaid: lt.isPaid,
    requiresDocument: lt.requiresDocument,
    allowHalfDay: lt.allowHalfDay,
    maxDaysPerApplication: lt.maxDaysPerApplication?.toString() ?? "",
    carryForwardEnabled: lt.carryForwardEnabled,
    maxCarryForward: lt.maxCarryForward?.toString() ?? "",
    entitlementRules: (lt.entitlementRules ?? []) as EntitlementRule[],
    sortOrder: lt.sortOrder.toString(),
    description: lt.description ?? "",
  };
}

/* =========================
   MAIN COMPONENT
========================= */

interface Props {
  types: LeaveTypeRow[];
  permissions: string[];
}

export function LeaveTypesClient({ types, permissions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Create/Edit dialog
  const [editTarget, setEditTarget] = useState<LeaveTypeRow | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [formData, setFormData] = useState<LeaveTypeFormData>(defaultFormData);
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<LeaveTypeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Seed
  const [seeding, setSeeding] = useState(false);

  function openCreate() {
    setFormData(defaultFormData);
    setEditTarget(null);
    setShowCreateDialog(true);
  }

  function openEdit(lt: LeaveTypeRow) {
    setFormData(leaveTypeToFormData(lt));
    setEditTarget(lt);
    setShowCreateDialog(true);
  }

  async function handleSave() {
    if (!formData.name.trim() || !formData.code.trim()) {
      toast.error("Name and code are required");
      return;
    }
    if (formData.entitlementRules.length === 0) {
      toast.error("At least one entitlement rule is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        isPaid: formData.isPaid,
        requiresDocument: formData.requiresDocument,
        allowHalfDay: formData.allowHalfDay,
        maxDaysPerApplication: formData.maxDaysPerApplication
          ? parseInt(formData.maxDaysPerApplication, 10)
          : undefined,
        carryForwardEnabled: formData.carryForwardEnabled,
        maxCarryForward: formData.maxCarryForward
          ? parseInt(formData.maxCarryForward, 10)
          : undefined,
        entitlementRules: formData.entitlementRules,
        sortOrder: parseInt(formData.sortOrder, 10) || 0,
        description: formData.description.trim() || undefined,
      };

      if (editTarget) {
        await updateLeaveType(editTarget.id, payload);
        toast.success("Leave type updated");
      } else {
        await createLeaveType(payload);
        toast.success("Leave type created");
      }

      setShowCreateDialog(false);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(lt: LeaveTypeRow) {
    try {
      await updateLeaveType(lt.id, { isActive: !lt.isActive });
      toast.success(`Leave type ${lt.isActive ? "deactivated" : "activated"}`);
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
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

  const dialogOpen = showCreateDialog;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Types</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure leave types and entitlement rules for your organization
          </p>
        </div>
        <div className="flex gap-2">
          {types.length === 0 && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleSeed}
              disabled={seeding}
            >
              <RefreshCwIcon className={`h-4 w-4 ${seeding ? "animate-spin" : ""}`} />
              {seeding ? "Seeding..." : "Seed Malaysia Defaults"}
            </Button>
          )}
          <Button className="gap-2" onClick={openCreate}>
            <PlusIcon className="h-4 w-4" />
            New Leave Type
          </Button>
        </div>
      </div>

      {types.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-gray-500">No leave types configured yet.</p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={handleSeed} disabled={seeding} className="gap-2">
                <RefreshCwIcon className={`h-4 w-4 ${seeding ? "animate-spin" : ""}`} />
                {seeding ? "Seeding..." : "Seed Malaysia Defaults"}
              </Button>
              <Button onClick={openCreate} className="gap-2">
                <PlusIcon className="h-4 w-4" />
                Create Custom Type
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Entitlement</TableHead>
                  <TableHead>MC Required</TableHead>
                  <TableHead>Half-day</TableHead>
                  <TableHead>Carry Fwd</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((lt) => (
                  <TableRow key={lt.id} className={!lt.isActive ? "opacity-60" : ""}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {lt.code}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium text-sm">{lt.name}</div>
                        {lt.description && (
                          <div className="text-xs text-gray-400 truncate max-w-48" title={lt.description}>
                            {lt.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${lt.isPaid ? "text-blue-700 border-blue-200 bg-blue-50" : "text-gray-500"}`}
                      >
                        {lt.isPaid ? "Paid" : "Unpaid"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {formatEntitlementRules(
                        lt.entitlementRules as Array<{
                          minYears: number;
                          maxYears: number | null;
                          days: number;
                        }>,
                      )}
                    </TableCell>
                    <TableCell>
                      {lt.requiresDocument ? (
                        <Badge
                          variant="outline"
                          className="text-xs text-amber-700 border-amber-200 bg-amber-50"
                        >
                          Required
                        </Badge>
                      ) : (
                        <span className="text-xs text-gray-400">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs ${lt.allowHalfDay ? "text-green-600" : "text-gray-400"}`}>
                        {lt.allowHalfDay ? "Yes" : "No"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {lt.carryForwardEnabled ? (
                        <span className="text-xs text-blue-600">
                          {lt.maxCarryForward !== null ? `Max ${lt.maxCarryForward}d` : "Unlimited"}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${lt.isActive ? "text-green-700 border-green-200 bg-green-50" : "text-gray-500 border-gray-200"}`}
                      >
                        {lt.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => openEdit(lt)}
                        >
                          <PencilIcon className="h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`text-xs ${lt.isActive ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50" : "text-green-600 hover:text-green-700 hover:bg-green-50"}`}
                          onClick={() => handleToggleActive(lt)}
                        >
                          {lt.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleteTarget(lt)}
                        >
                          <TrashIcon className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) setShowCreateDialog(false);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Leave Type" : "New Leave Type"}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? "Update the leave type configuration."
                : "Create a new leave type for your organization."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name + Code */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ltName">
                  Name <span className="text-red-500">*</span>
                </Label>
                <input
                  id="ltName"
                  value={formData.name}
                  onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Annual Leave"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ltCode">
                  Code <span className="text-red-500">*</span>
                </Label>
                <input
                  id="ltCode"
                  value={formData.code}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                  placeholder="AL"
                  maxLength={10}
                  required
                  disabled={!!editTarget}
                />
                {editTarget && (
                  <p className="text-xs text-gray-400">Code cannot be changed after creation.</p>
                )}
              </div>
            </div>

            {/* Toggles row 1 */}
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ltIsPaid"
                  checked={formData.isPaid}
                  onChange={(e) => setFormData((f) => ({ ...f, isPaid: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="ltIsPaid" className="cursor-pointer">
                  Paid Leave
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ltRequiresDoc"
                  checked={formData.requiresDocument}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, requiresDocument: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="ltRequiresDoc" className="cursor-pointer">
                  Requires MC/Doc
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ltAllowHalfDay"
                  checked={formData.allowHalfDay}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, allowHalfDay: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="ltAllowHalfDay" className="cursor-pointer">
                  Allow Half-day
                </Label>
              </div>
            </div>

            {/* Max days + carry forward */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ltMaxDays">Max Days Per Application</Label>
                <input
                  id="ltMaxDays"
                  type="number"
                  min={1}
                  value={formData.maxDaysPerApplication}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, maxDaysPerApplication: e.target.value }))
                  }
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Leave blank for no limit"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ltSortOrder">Sort Order</Label>
                <input
                  id="ltSortOrder"
                  type="number"
                  min={0}
                  value={formData.sortOrder}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, sortOrder: e.target.value }))
                  }
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {/* Carry Forward */}
            <div className="space-y-3 p-3 border rounded-md">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ltCarryFwd"
                  checked={formData.carryForwardEnabled}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, carryForwardEnabled: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="ltCarryFwd" className="cursor-pointer">
                  Enable Carry Forward
                </Label>
              </div>
              {formData.carryForwardEnabled && (
                <div className="space-y-2 pl-6">
                  <Label htmlFor="ltMaxCarryFwd">Max Carry Forward Days</Label>
                  <input
                    id="ltMaxCarryFwd"
                    type="number"
                    min={0}
                    value={formData.maxCarryForward}
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, maxCarryForward: e.target.value }))
                    }
                    className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Leave blank for unlimited"
                  />
                </div>
              )}
            </div>

            {/* Entitlement Rules */}
            <EntitlementRuleEditor
              rules={formData.entitlementRules}
              onChange={(rules) => setFormData((f) => ({ ...f, entitlementRules: rules }))}
            />

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="ltDescription">Description</Label>
              <Textarea
                id="ltDescription"
                value={formData.description}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Optional description..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editTarget ? "Save Changes" : "Create Leave Type"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Leave Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>
                {deleteTarget?.name} ({deleteTarget?.code})
              </strong>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-700">
            If this leave type has existing applications, you will not be able to delete it.
            Deactivate it instead to prevent new applications.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete Leave Type"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
