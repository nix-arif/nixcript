"use client";

// Item groups — the users decide which groups exist ("Laser fibres",
// "Haemostatic", "Machines"…), their order and colour, and which products
// belong to each — a product can be in several groups and is then listed
// under each heading in the stock lists.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, FolderIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { addProductsToGroup, deleteItemGroup, removeProductFromGroup, reorderItemGroups, saveItemGroup, searchProductsForGroup, type getItemGroupPage } from "@/server/item-group";

type Data = Awaited<ReturnType<typeof getItemGroupPage>>;
type Group = Data["groups"][number];

const COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#e11d48", "#0891b2", "#db2777", "#4b5563"];

export function ItemGroupsClient({ data }: { data: Data }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [find, setFind] = useState("");
  const [onlyUngrouped, setOnlyUngrouped] = useState(false);
  const shownStock = data.stocked.filter((p) => (!onlyUngrouped || !p.groupIds.length)
    && (!find.trim() || `${p.productCode} ${p.description ?? ""}`.toLowerCase().includes(find.trim().toLowerCase())));
  const can = data.canManage;

  async function run<T extends { ok: boolean }>(fn: () => Promise<T>, done?: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) { toast.error((res as unknown as { title: string }).title); return false; }
      if (done) toast.success(done);
      router.refresh();
      return true;
    } finally { setBusy(false); }
  }

  async function add() {
    if (await run(() => saveItemGroup({ name: newName, color: newColor }), `Group "${newName.trim()}" added`)) {
      setNewName("");
      setNewColor(COLORS[(data.groups.length + 1) % COLORS.length]);
    }
  }
  const move = (i: number, d: -1 | 1) => {
    const ids = data.groups.map((g) => g.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    run(() => reorderItemGroups(ids));
  };
  const addTo = (ids: string[], groupId: string, name: string) =>
    run(() => addProductsToGroup(ids, groupId), `${ids.length} product${ids.length > 1 ? "s" : ""} added to "${name}"`).then((ok) => ok && setPicked(new Set()));
  // Other groups a product is in, for the "also in" hint
  const groupsOf = (productId: string) => data.groups.filter((g) => g.products.some((p) => p.id === productId));

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-4">
      <PageHeader title="Item groups"
        description="Make your own groups — e.g. Laser fibres, Haemostatic, Machines — and put products in them. A product can be in several groups. Stock Overview and Field Stock list items under these headings, in this order (a product under each of its groups); products in no group show under “Other”." />

      {can && (
        <section className="border border-border rounded-xl p-4 flex flex-wrap items-center gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) add(); }}
            placeholder='New group name, e.g. "Laser fibres"' className="h-9 flex-1 min-w-56 text-sm" />
          <ColorPick value={newColor} onChange={setNewColor} />
          <Button size="sm" className="gap-1.5" disabled={busy || !newName.trim()} onClick={add}><PlusIcon className="w-4 h-4" /> Add group</Button>
        </section>
      )}

      {data.groups.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl py-12 text-center text-sm text-muted-foreground">
          No groups yet. {can ? "Add your first group above, then put products in it." : "Ask someone who manages inventory to set them up."}
        </div>
      ) : data.groups.map((g, i) => (
        <GroupCard key={g.id} group={g} first={i === 0} last={i === data.groups.length - 1} can={can} busy={busy}
          onMove={(d) => move(i, d)} run={run} alsoIn={(pid) => groupsOf(pid).filter((x) => x.id !== g.id).map((x) => x.name)} allGroups={data.groups} />
      ))}

      {data.stocked.length > 0 && (
        <section className="border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Products you hold</span>
            <span className="text-xs text-muted-foreground">
              {can && data.groups.length ? "click a group to put the product in it or take it out — a product can be in several" : "the groups each product is in"}
            </span>
            <div className="w-full flex flex-wrap items-center gap-2 mt-1">
              <div className="relative flex-1 min-w-48">
                <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find product…" className="h-8 pl-8 text-xs bg-background" />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={onlyUngrouped} onChange={(e) => setOnlyUngrouped(e.target.checked)} /> only those in no group ({data.stocked.filter((p) => !p.groupIds.length).length})
              </label>
              {can && picked.size > 0 && data.groups.length > 0 && (
                <select className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-xs" value=""
                  onChange={(e) => { const g = data.groups.find((x) => x.id === e.target.value); if (g) addTo([...picked], g.id, g.name); }}>
                  <option value="">Add {picked.size} selected to…</option>
                  {data.groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="divide-y divide-border/60">
            {shownStock.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing matches.</p>}
            {shownStock.map((p) => (
              <div key={p.id} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                {can && data.groups.length > 0 && (
                  <input type="checkbox" checked={picked.has(p.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                )}
                <span className="font-mono text-xs font-medium w-32 shrink-0">{p.productCode}</span>
                <span className="flex-1 min-w-40 truncate text-xs text-muted-foreground">{p.description}</span>
                <span className="flex flex-wrap gap-1">
                  {data.groups.map((g) => {
                    const on = p.groupIds.includes(g.id);
                    if (!can && !on) return null;
                    return (
                      <button key={g.id} type="button" disabled={!can || busy}
                        onClick={() => run(() => (on ? removeProductFromGroup(p.id, g.id) : addProductsToGroup([p.id], g.id)),
                          on ? `${p.productCode} taken out of "${g.name}"` : `${p.productCode} added to "${g.name}"`)}
                        title={on ? `In "${g.name}" — click to take it out` : `Click to add to "${g.name}"`}
                        className={cn("rounded-full border px-2 py-0.5 text-[11px] transition-colors", on ? "text-white" : "bg-background text-muted-foreground hover:text-foreground")}
                        style={on ? { background: g.color ?? "#4b5563", borderColor: g.color ?? "#4b5563" } : { borderColor: (g.color ?? "#4b5563") + "66" }}>
                        {on ? "✓ " : "+ "}{g.name}
                      </button>
                    );
                  })}
                  {!p.groupIds.length && <span className="text-[11px] text-muted-foreground">Other</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ColorPick({ value, onChange }: { value: string | null; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1">
      {COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c}
          className={cn("w-5 h-5 rounded-full border-2", value === c ? "border-foreground" : "border-transparent")} style={{ background: c }} />
      ))}
    </div>
  );
}

function GroupCard({ group, first, last, can, busy, onMove, run, alsoIn, allGroups }: {
  group: Group; first: boolean; last: boolean; can: boolean; busy: boolean; onMove: (d: -1 | 1) => void;
  alsoIn: (productId: string) => string[]; allGroups: Group[];
  run: <T extends { ok: boolean }>(fn: () => Promise<T>, done?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<{ name: string; color: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <section className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-8 w-56 text-sm" autoFocus />
            <ColorPick value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={async () => { if (await run(() => saveItemGroup({ id: group.id, ...editing }), "Group saved")) setEditing(null); }}>Save</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(null)}>Cancel</Button>
          </>
        ) : (
          <>
            <FolderIcon className="w-4 h-4" style={{ color: group.color ?? undefined }} />
            <span className="text-sm font-semibold">{group.name}</span>
            <span className="text-xs text-muted-foreground">{group.products.length} product{group.products.length !== 1 ? "s" : ""}</span>
            {can && (
              <span className="ml-auto flex items-center gap-0.5">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={first || busy} onClick={() => onMove(-1)} title="Move up"><ArrowUpIcon className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={last || busy} onClick={() => onMove(1)} title="Move down"><ArrowDownIcon className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing({ name: group.name, color: group.color })} title="Rename"><PencilIcon className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" disabled={busy} title="Delete group"
                  onClick={() => { if (confirm(`Delete group "${group.name}"? Its ${group.products.length} product(s) go back to “Other”.`)) run(() => deleteItemGroup(group.id), "Group deleted"); }}>
                  <TrashIcon className="w-3.5 h-3.5" />
                </Button>
              </span>
            )}
          </>
        )}
      </div>
      <div className="p-3 flex flex-col gap-2">
        {group.products.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {group.products.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-background pl-2 pr-1 py-0.5"
                title={[p.description, alsoIn(p.id).length ? `Also in: ${alsoIn(p.id).join(", ")}` : null].filter(Boolean).join(" · ") || undefined}>
                <span className="font-mono">{p.productCode}</span>
                {alsoIn(p.id).length > 0 && <span className="text-[10px] text-muted-foreground">+{alsoIn(p.id).length}</span>}
                {can && (
                  <button type="button" disabled={busy} onClick={() => run(() => removeProductFromGroup(p.id, group.id), `${p.productCode} taken out of "${group.name}"`)}
                    className="text-muted-foreground hover:text-destructive" title="Take out of this group"><XIcon className="w-3 h-3" /></button>
                )}
              </span>
            ))}
          </div>
        ) : <p className="text-xs text-muted-foreground">No products in this group yet.</p>}
        {can && (adding
          ? <AddProducts group={group} allGroups={allGroups} run={run} onClose={() => setAdding(false)} />
          : <Button size="sm" variant="outline" className="self-start h-7 text-xs gap-1" onClick={() => setAdding(true)}><PlusIcon className="w-3 h-3" /> Add products</Button>)}
      </div>
    </section>
  );
}

function AddProducts({ group, allGroups, run, onClose }: { group: Group; allGroups: Group[]; run: <T extends { ok: boolean }>(fn: () => Promise<T>, done?: string) => Promise<boolean>; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ q: string; rows: Awaited<ReturnType<typeof searchProductsForGroup>> } | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => { const rows = await searchProductsForGroup(q); if (!cancelled) setAnswer({ q, rows }); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  const rows = q.trim().length >= 2 && answer?.q === q ? answer.rows : [];
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product code or description…" className="h-8 pl-8 text-xs bg-background" autoFocus />
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Done</Button>
      </div>
      {rows.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-background divide-y divide-border/50">
          {rows.map((r) => {
            const here = r.groupIds.includes(group.id);
            const others = allGroups.filter((g) => g.id !== group.id && r.groupIds.includes(g.id)).map((g) => g.name);
            return (
              <button key={r.id} type="button" disabled={here}
                onClick={() => run(() => addProductsToGroup([r.id], group.id), `${r.productCode} added to "${group.name}"`).then(() => setAnswer((a) => a && { ...a, rows: a.rows.map((x) => (x.id === r.id ? { ...x, groupIds: [...x.groupIds, group.id] } : x)) }))}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/40 disabled:opacity-60 flex items-center gap-2">
                <span className="font-mono font-medium w-32 shrink-0">{r.productCode}</span>
                <span className="flex-1 min-w-0 truncate text-muted-foreground">{r.description}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{here ? "in this group" : others.length ? `add (also in ${others.join(", ")})` : "add"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
