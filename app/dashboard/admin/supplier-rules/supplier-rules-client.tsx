"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  getRestrictedSupplierRules,
  createRestrictedSupplierRule,
  deleteRestrictedSupplierRule,
  type RestrictedSupplierRule,
} from "@/server/supplier-restrictions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PageHeader } from "@/components/page-header";
import {
  PlusIcon,
  TrashIcon,
  ShieldIcon,
  BuildingIcon,
} from "lucide-react";

interface Props {
  initialRules: RestrictedSupplierRule[];
  ownerOrganizations: { id: string; name: string }[];
}

const EMPTY_FORM = {
  supplierName: "",
  designatedOrganizationId: "",
  notes: "",
};

export function SupplierRulesClient({ initialRules, ownerOrganizations }: Props) {
  const [rules, setRules] = useState(initialRules);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  function openCreate() {
    setForm({ ...EMPTY_FORM, designatedOrganizationId: ownerOrganizations[0]?.id ?? "" });
    setOpen(true);
  }

  const f =
    (k: keyof typeof EMPTY_FORM) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value }));

  async function handleSave() {
    if (!form.supplierName.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    if (!form.designatedOrganizationId) {
      toast.error("Choose which organization is allowed to deal with this supplier");
      return;
    }
    setSaving(true);
    try {
      await createRestrictedSupplierRule(form);
      toast.success("Rule created");
      setRules(await getRestrictedSupplierRules());
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove the rule for "${name}"? Every organization will be able to deal with this supplier again.`)) return;
    setDeleting(id);
    try {
      await deleteRestrictedSupplierRule(id);
      setRules(await getRestrictedSupplierRules());
      toast.success("Rule removed");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Supplier Rules"
        description="Restrict a supplier to being dealt with directly by only one of your organizations"
        action={
          ownerOrganizations.length > 0 ? (
            <Button onClick={openCreate} className="gap-2">
              <PlusIcon className="w-4 h-4" /> Add rule
            </Button>
          ) : undefined
        }
      />

      {ownerOrganizations.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <ShieldIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">No other organizations</div>
          <div className="text-xs">
            Supplier rules only apply when you own more than one organization.
          </div>
        </div>
      ) : rules.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <ShieldIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">No rules yet</div>
          <div className="text-xs mb-4">
            Every organization can deal with any supplier directly until you add a rule.
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={openCreate}>
            <PlusIcon className="w-3.5 h-3.5" /> Add rule
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div
              key={r.id}
              className="border border-border rounded-xl bg-background px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/40 shrink-0 mt-0.5">
                <ShieldIcon className="w-3.5 h-3.5 text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{r.supplierName}</span>
                  <span
                    className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800"
                    title="Only this organization can deal with this supplier directly"
                  >
                    <BuildingIcon className="w-3 h-3 shrink-0" />
                    {r.designatedOrganizationName ?? "Unknown organization"}
                  </span>
                </div>
                {r.notes && (
                  <p className="text-[11px] text-muted-foreground mt-1">{r.notes}</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Added {new Date(r.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 text-destructive hover:text-destructive"
                  disabled={deleting === r.id}
                  onClick={() => handleDelete(r.id, r.supplierName)}
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-md max-w-lg! overflow-y-auto px-10">
          <SheetHeader className="mb-5">
            <SheetTitle>Add supplier rule</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                Supplier name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.supplierName}
                onChange={f("supplierName")}
                placeholder="e.g. ABC Medical Sdn Bhd"
              />
              <p className="text-[11px] text-muted-foreground">
                Matches any supplier record with this name (case-insensitive) across all your organizations.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>
                Designated organization <span className="text-destructive">*</span>
              </Label>
              <select
                value={form.designatedOrganizationId}
                onChange={f("designatedOrganizationId")}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {ownerOrganizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Only this organization can deal with this supplier directly. Every other organization is blocked.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={f("notes")}
                placeholder="Internal notes..."
                rows={2}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Add rule"}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
