"use client";

// A document's categories (customer PO, sales order, PR, supplier PO). They come down from the
// quotation; changing them here also changes the documents made from this one that still carry
// the old ones (server/document-category-chain.ts).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2Icon, PencilIcon, TagIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  getDocumentCategoryState,
  setDocumentCategories,
  type CategoryDocKind,
  type CategoryOption,
} from "@/server/document-category-chain";

const DOWNSTREAM: Record<CategoryDocKind, string> = {
  cpo: "its sales order, PRs and supplier POs",
  so: "its PRs and supplier POs",
  pr: "its supplier POs",
  po: "the sibling company's sales order for it",
};

export function CategoryChip({ option, selected = true, onClick }: { option: CategoryOption; selected?: boolean; onClick?: () => void }) {
  const hex = option.color ?? "#6366f1";
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border-2 px-2.5 py-1 text-xs font-semibold select-none",
        selected ? "text-white shadow-sm" : "bg-background text-foreground/70 hover:text-foreground",
      )}
      style={selected ? { backgroundColor: hex, borderColor: hex } : { borderColor: hex + "55" }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: selected ? "rgba(255,255,255,0.8)" : hex }} />
      {option.name}
      {onClick && selected && <span className="ml-0.5 opacity-80">✓</span>}
    </Tag>
  );
}

export function DocumentCategoriesCard({ kind, docId }: { kind: CategoryDocKind; docId: string }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof getDocumentCategoryState>> | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    getDocumentCategoryState(kind, docId).then((s) => { if (live) setState(s); }).catch(() => {});
    return () => { live = false; };
  }, [kind, docId]);

  if (!state || (state.options.length === 0 && state.selected.length === 0)) return null;
  const editing = draft !== null;
  const shown = state.options.filter((o) => state.selected.includes(o.id));

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await setDocumentCategories(kind, docId, draft);
      setState((s) => (s ? { ...s, selected: next } : s));
      setDraft(null);
      toast.success(`Categories saved. ${DOWNSTREAM[kind][0].toUpperCase()}${DOWNSTREAM[kind].slice(1)} follow, unless changed there.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the categories");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-2 rounded-xl border border-border p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <TagIcon className="h-4 w-4 text-muted-foreground" /> Categories
        {state.canEdit && !editing && (
          <button type="button" onClick={() => setDraft(state.selected)}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted">
            <PencilIcon className="h-3 w-3" /> Change
          </button>
        )}
      </h2>
      {editing ? (
        <>
          <div className="flex flex-wrap gap-2">
            {state.options.map((o) => {
              const on = draft.includes(o.id);
              return <CategoryChip key={o.id} option={o} selected={on} onClick={() => setDraft((d) => (d ?? []).includes(o.id) ? (d ?? []).filter((x) => x !== o.id) : [...(d ?? []), o.id])} />;
            })}
          </div>
          <p className="text-xs text-muted-foreground">Also changes {DOWNSTREAM[kind]} that still have the old categories. DOs and invoices already made keep theirs.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
          </div>
        </>
      ) : shown.length > 0 ? (
        <div className="flex flex-wrap gap-2">{shown.map((o) => <CategoryChip key={o.id} option={o} />)}</div>
      ) : (
        <p className="text-xs italic text-muted-foreground">None{state.canEdit ? ": use Change to pick them." : "."}</p>
      )}
    </section>
  );
}
