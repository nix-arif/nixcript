"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, TrashIcon, LockIcon } from "lucide-react";
import { createDepartment, deleteDepartment, type Department } from "@/server/departments";

export function DepartmentsClient({ departments }: { departments: Department[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [adding, setAdding]   = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const defaults = departments.filter((d) => d.isDefault);
  const custom   = departments.filter((d) => !d.isDefault);

  return (
    <div className="p-6 space-y-6" style={{ background: "var(--color-background-secondary)", minHeight: "100vh" }}>
      <PageHeader
        title="Departments"
        description="Default departments are permanent. Add custom departments as needed."
      />

      {/* Add department */}
      <section className="bg-background border border-border/50 rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Add department
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
              <span className="text-sm font-medium capitalize">{dept.name.replace(/-/g, " ")}</span>
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
    </div>
  );
}
