"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, TrashIcon, LockIcon, RefreshCwIcon } from "lucide-react";
import { createDepartment, deleteDepartment, type Department } from "@/server/departments";
import { resyncOrgPermissions } from "@/server/members";

export function DepartmentsClient({ departments }: { departments: Department[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [adding, setAdding]   = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await createDepartment(name);
      toast.success(`Department "${name}" created.`);
      setNewName("");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(dept: Department) {
    if (!confirm(`Delete department "${dept.name}"? Members in this dept will lose their dept assignment.`)) return;
    setDeletingId(dept.id);
    try {
      await deleteDepartment(dept.id);
      toast.success(`Department "${dept.name}" deleted.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleResync() {
    if (!confirm("Recalculate permissions for all department members based on current role definitions? This will overwrite any manually set permissions.")) return;
    setSyncing(true);
    try {
      const count = await resyncOrgPermissions();
      toast.success(`Permissions resynced for ${count} member${count !== 1 ? "s" : ""}.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const defaults = departments.filter((d) => d.isDefault);
  const custom   = departments.filter((d) => !d.isDefault);

  return (
    <div className="p-6 space-y-6" style={{ background: "var(--color-background-secondary)", minHeight: "100vh" }}>
      <PageHeader
        title="Departments"
        description="Default departments are permanent. Add custom departments as needed."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={handleResync}
            disabled={syncing}
            className="gap-1.5 text-xs"
          >
            <RefreshCwIcon className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Resync permissions"}
          </Button>
        }
      />

      {/* Resync info banner */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
        <span className="font-semibold">Permission roles:</span> Each department has two roles —{" "}
        <span className="font-mono">manager</span> (full write access) and{" "}
        <span className="font-mono">member</span> (create + update). Use <em>Resync permissions</em> after
        role definitions change to update all existing members.
      </div>

      {/* Default departments */}
      <section className="bg-background border border-border/50 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
          <LockIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Default departments ({defaults.length})
          </h2>
        </div>
        <div className="divide-y divide-border/60">
          {defaults.map((dept) => (
            <div key={dept.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <span className="text-sm font-medium capitalize">{dept.name.replace(/-/g, " ")}</span>
                {DEPT_DESCRIPTIONS[dept.name] && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{DEPT_DESCRIPTIONS[dept.name]}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">default</span>
            </div>
          ))}
        </div>
      </section>

      {/* Custom departments */}
      {custom.length > 0 && (
        <section className="bg-background border border-border/50 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Custom departments ({custom.length})
            </h2>
          </div>
          <div className="divide-y divide-border/60">
            {custom.map((dept) => (
              <div key={dept.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium capitalize">{dept.name.replace(/-/g, " ")}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:bg-destructive/10"
                  disabled={deletingId === dept.id}
                  onClick={() => handleDelete(dept)}
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Add department */}
      <section className="bg-background border border-border/50 rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Add custom department
        </h2>
        <div className="flex gap-2 max-w-sm">
          <Input
            placeholder="e.g. operations"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="h-9 text-sm"
          />
          <Button size="sm" disabled={!newName.trim() || adding} onClick={handleAdd} className="gap-1.5">
            <PlusIcon className="w-3.5 h-3.5" />
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
      </section>
    </div>
  );
}

const DEPT_DESCRIPTIONS: Record<string, string> = {
  management:        "Full access across all modules. Suitable for directors and senior management.",
  sales:             "Quotations, sales orders, customer POs, and customer management.",
  accounting:        "Invoices, payslips, and financial read access.",
  "human-resources": "Staff profiles, payroll, leave, and claims management.",
  engineering:       "Product catalog and technical quotation review.",
  logistic:          "Delivery orders, stock reservation, inventory adjustments, and purchase orders.",
  marketing:         "Customer records, quotation read, and product catalog.",
  regulatory:        "Read-only access across all commercial documents.",
};
