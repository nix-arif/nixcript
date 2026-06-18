"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  StarIcon,
  CheckIcon,
  XIcon,
  GripVerticalIcon,
} from "lucide-react";
import {
  createDocumentCategory,
  updateDocumentCategory,
  deleteDocumentCategory,
  toggleDefaultDocumentCategory,
  reorderDocumentCategories,
  type DocumentCategoryRow,
} from "@/server/document-category";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  { label: "Indigo", value: "#6366f1" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Red", value: "#ef4444" },
  { label: "Green", value: "#22c55e" },
  { label: "Purple", value: "#a855f7" },
];

function ColorSwatch({
  color,
  selected,
  onClick,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={color}
      className={cn(
        "w-6 h-6 rounded-full border-2 transition-all",
        selected ? "border-foreground scale-110" : "border-transparent hover:border-muted-foreground",
      )}
      style={{ backgroundColor: color }}
    >
      {selected && <CheckIcon className="w-3 h-3 text-white mx-auto" />}
    </button>
  );
}

interface NewCategoryFormProps {
  onSaved: (cat: DocumentCategoryRow) => void;
  onCancel: () => void;
}

function NewCategoryForm({ onSaved, onCancel }: NewCategoryFormProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0].value);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const cat = await createDocumentCategory({ name, color, isDefault });
      toast.success(`Category "${name}" created`);
      onSaved(cat);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-border rounded-xl p-4 bg-muted/20 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Category</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Name <span className="text-red-500">*</span>
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Government, Private, Capital"
            className="h-8 text-sm"
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Color</label>
          <div className="flex items-center gap-2 h-8">
            {PRESET_COLORS.map((c) => (
              <ColorSwatch
                key={c.value}
                color={c.value}
                selected={color === c.value}
                onClick={() => setColor(c.value)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="new-is-default"
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-3.5 w-3.5 rounded"
        />
        <label htmlFor="new-is-default" className="text-xs text-muted-foreground cursor-pointer">
          Set as default category
        </label>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={saving} className="h-7 text-xs">
          {saving ? "Saving…" : "Create"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface EditRowFormProps {
  category: DocumentCategoryRow;
  onSaved: (cat: DocumentCategoryRow) => void;
  onCancel: () => void;
}

function EditRowForm({ category, onSaved, onCancel }: EditRowFormProps) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color ?? PRESET_COLORS[0].value);
  const [isDefault, setIsDefault] = useState(category.isDefault);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const cat = await updateDocumentCategory({ id: category.id, name, color, isDefault });
      toast.success("Category updated");
      onSaved(cat);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 py-1">
      <div className="space-y-1 min-w-[160px]">
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 text-xs"
          autoFocus
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Color</label>
        <div className="flex items-center gap-1.5 h-7">
          {PRESET_COLORS.map((c) => (
            <ColorSwatch
              key={c.value}
              color={c.value}
              selected={color === c.value}
              onClick={() => setColor(c.value)}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 pb-0.5">
        <input
          id={`edit-default-${category.id}`}
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-3.5 w-3.5 rounded"
        />
        <label htmlFor={`edit-default-${category.id}`} className="text-xs text-muted-foreground cursor-pointer">
          Default
        </label>
      </div>
      <div className="flex items-center gap-1.5 pb-0.5">
        <Button type="submit" size="sm" disabled={saving} className="h-7 text-xs">
          {saving ? "…" : <CheckIcon className="w-3.5 h-3.5" />}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">
          <XIcon className="w-3.5 h-3.5" />
        </Button>
      </div>
    </form>
  );
}

interface Props {
  initialCategories: DocumentCategoryRow[];
}

export function CategoriesClient({ initialCategories }: Props) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  // Drag-and-drop state
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    setCategories(initialCategories);
  }, [initialCategories]);

  function closeForm() {
    setShowNewForm(false);
    setEditingId(null);
  }

  function handleCreated(newCat: DocumentCategoryRow) {
    setCategories((prev) => [...prev, newCat]);
    closeForm();
    router.refresh();
  }

  function handleUpdated(updatedCat: DocumentCategoryRow) {
    setCategories((prev) => prev.map((c) => (c.id === updatedCat.id ? updatedCat : c)));
    closeForm();
    router.refresh();
  }

  async function handleDelete(cat: DocumentCategoryRow) {
    if (!confirm(`Delete category "${cat.name}"? Documents using this category will lose this tag.`)) return;
    setDeletingId(cat.id);
    try {
      await deleteDocumentCategory(cat.id);
      toast.success(`Category "${cat.name}" deleted`);
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleDefault(cat: DocumentCategoryRow) {
    setSettingDefaultId(cat.id);
    try {
      const updated = await toggleDefaultDocumentCategory(cat.id);
      toast.success(updated.isDefault ? `"${cat.name}" marked as default` : `"${cat.name}" unmarked as default`);
      setCategories((prev) => prev.map((c) => (c.id === cat.id ? updated : c)));
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSettingDefaultId(null);
    }
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function handleDragStart(index: number) {
    dragIndexRef.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  async function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (fromIndex === null || fromIndex === dropIndex) return;

    const reordered = [...categories];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(dropIndex, 0, moved);

    setCategories(reordered); // optimistic
    setReordering(true);
    try {
      await reorderDocumentCategories(reordered.map((c) => c.id));
    } catch (err: any) {
      toast.error("Failed to save order");
      setCategories(categories); // rollback
    } finally {
      setReordering(false);
    }
  }

  function handleDragEnd() {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }

  return (
    <div
      className="p-6 space-y-6"
      style={{ background: "var(--color-background-secondary)", minHeight: "100vh" }}
    >
      <PageHeader
        title="Document Categories"
        description="Manage categories for quotations and invoices"
        action={
          !showNewForm ? (
            <Button size="sm" onClick={() => setShowNewForm(true)} className="gap-1.5 text-xs h-8">
              <PlusIcon className="w-3.5 h-3.5" />
              New Category
            </Button>
          ) : undefined
        }
      />

      {showNewForm && (
        <NewCategoryForm onSaved={handleCreated} onCancel={closeForm} />
      )}

      <section className="bg-background border border-border/50 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Categories ({categories.length})
          </h2>
          {reordering && (
            <span className="text-[10px] text-muted-foreground">Saving order…</span>
          )}
        </div>

        {categories.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No categories yet. Click <span className="font-semibold">New Category</span> to create one.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {categories.map((cat, index) => (
              <div
                key={cat.id}
                draggable={editingId !== cat.id}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "px-4 py-3 transition-colors",
                  dragOverIndex === index && dragIndexRef.current !== index
                    ? "bg-muted/60 border-t-2 border-primary"
                    : "",
                )}
              >
                {editingId === cat.id ? (
                  <EditRowForm
                    category={cat}
                    onSaved={handleUpdated}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="flex items-center gap-3">
                    {/* Drag handle */}
                    <span className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0">
                      <GripVerticalIcon className="w-4 h-4" />
                    </span>
                    {/* Color dot */}
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color ?? "#6366f1" }}
                    />
                    {/* Name */}
                    <span className="text-sm font-medium flex-1">{cat.name}</span>
                    {/* Default badge */}
                    {cat.isDefault && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                        Default
                      </span>
                    )}
                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title={cat.isDefault ? "Unmark as default" : "Mark as default"}
                        disabled={settingDefaultId === cat.id}
                        onClick={() => handleToggleDefault(cat)}
                        className={cn(
                          "p-1.5 rounded-md transition-colors",
                          cat.isDefault
                            ? "text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                            : "text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20",
                        )}
                      >
                        <StarIcon className={cn("w-3.5 h-3.5", cat.isDefault && "fill-current")} />
                      </button>
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => setEditingId(cat.id)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <PencilIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        disabled={deletingId === cat.id}
                        onClick={() => handleDelete(cat)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
