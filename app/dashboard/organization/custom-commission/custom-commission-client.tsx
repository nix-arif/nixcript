"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  InfoIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCommissionTypes,
  createCommissionType,
  updateCommissionType,
  deleteCommissionType,
  createCommissionRole,
  updateCommissionRole,
  deleteCommissionRole,
  getRateMatrix,
  saveCategoryRates,
  saveMemberRates,
  deleteMemberRates,
  getCommissionUsage,
  type CommissionTypeRow,
  type CommissionSource,
  type MultiMode,
  type DayType,
  type OrgMemberOption,
  type RateMatrix,
} from "@/server/commission";

const DAY_TYPES: { key: DayType; label: string }[] = [
  { key: "weekday", label: "Weekday" },
  { key: "weekend", label: "Weekend" },
  { key: "holiday", label: "Holiday" },
];
const SOURCE_LABEL: Record<CommissionSource, string> = {
  sales_person: "Sales person on the invoice",
  application_specialist: "Application specialist on the invoice",
};
const MODES: { value: MultiMode; label: string; hint: string }[] = [
  { value: "full_each", label: "Each gets the full rate", hint: "Every sales person listed earns the full rate." },
  { value: "split", label: "Split evenly", hint: "The rate is divided across the sales persons listed." },
  { value: "primary_only", label: "Primary only", hint: "Only the primary sales person earns it." },
];
const MODE_SHORT: Record<MultiMode, string> = {
  full_each: "each gets the full rate",
  split: "split evenly",
  primary_only: "primary only",
};

type Drafts = Record<string, string>; // `${roleId}|${dayType}` -> rate text
const cellKey = (roleId: string, day: DayType) => `${roleId}|${day}`;
const fmtRate = (v: string | undefined) => (v === undefined ? "" : String(Number(v)));

export function CustomCommissionClient({
  initialTypes,
  members,
}: {
  initialTypes: CommissionTypeRow[];
  members: OrgMemberOption[];
}) {
  const [types, setTypes] = useState(initialTypes);
  const [selectedId, setSelectedId] = useState<string | null>(initialTypes[0]?.id ?? null);
  const [tab, setTab] = useState("roles");
  const [matrix, setMatrix] = useState<RateMatrix | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Drafts>>({}); // categoryId -> cell drafts
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const [typeDialog, setTypeDialog] = useState<{ mode: "new" | "rename"; name: string } | null>(null);
  const [deleteTypeOpen, setDeleteTypeOpen] = useState<{ usage: number } | null>(null);
  const [roleDraft, setRoleDraft] = useState<
    { id: string | null; name: string; source: CommissionSource; multiMode: MultiMode } | null
  >(null);
  const [roleConfirmDelete, setRoleConfirmDelete] = useState(false);
  const [special, setSpecial] = useState<{ userId: string; categoryId: string; cells: Drafts; isNew: boolean } | null>(null);

  const selected = types.find((t) => t.id === selectedId) ?? null;
  const activeRoles = useMemo(() => selected?.roles.filter((r) => r.isActive) ?? [], [selected]);

  const reloadTypes = useCallback(async () => setTypes(await getCommissionTypes()), []);
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    }
  };

  const loadMatrix = useCallback(async (typeId: string) => {
    try {
      const m = await getRateMatrix(typeId);
      setMatrix(m);
      const d: Record<string, Drafts> = {};
      for (const c of m.categories) d[c.id] = {};
      for (const r of m.rates) d[r.categoryId][cellKey(r.roleId, r.dayType)] = fmtRate(r.rate);
      setDrafts(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load rates");
    }
  }, []);

  useEffect(() => {
    setMatrix(null);
    if (selectedId) void loadMatrix(selectedId);
  }, [selectedId, loadMatrix]);

  // ── unsaved rate edits ──
  const savedValue = (categoryId: string, key: string) => {
    const [roleId, day] = key.split("|");
    return fmtRate(matrix?.rates.find((r) => r.categoryId === categoryId && r.roleId === roleId && r.dayType === day)?.rate);
  };
  const cellDirty = (categoryId: string, key: string) =>
    (drafts[categoryId]?.[key] ?? "") !== savedValue(categoryId, key);
  const dirtyCategories = useMemo(
    () =>
      (matrix?.categories ?? []).filter((c) =>
        activeRoles.some((r) => DAY_TYPES.some(({ key }) => cellDirty(c.id, cellKey(r.id, key)))),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matrix, drafts, activeRoles],
  );
  const hasUnsaved = dirtyCategories.length > 0;

  const discard = () => selectedId && void loadMatrix(selectedId);

  const saveAll = async () => {
    if (!selected) return;
    setSaving(true);
    const ok = await guard(async () => {
      for (const c of dirtyCategories)
        await saveCategoryRates(
          selected.id,
          c.id,
          activeRoles.flatMap((r) =>
            DAY_TYPES.map(({ key }) => ({
              roleId: r.id,
              dayType: key,
              rate: drafts[c.id]?.[cellKey(r.id, key)] ?? "",
            })),
          ),
        );
      await loadMatrix(selected.id);
    });
    if (ok) toast.success("Rates saved");
    setSaving(false);
  };

  const selectType = (id: string) => {
    if (id === selectedId) return;
    if (hasUnsaved && !window.confirm("You have unsaved rate changes. Discard them?")) return;
    setSelectedId(id);
  };

  // ── types ──
  const submitTypeDialog = async () => {
    if (!typeDialog) return;
    const ok = await guard(async () => {
      if (typeDialog.mode === "new") {
        const id = await createCommissionType(typeDialog.name);
        await reloadTypes();
        setSelectedId(id);
        setTab("roles");
      } else if (selected) {
        await updateCommissionType(selected.id, { name: typeDialog.name });
        await reloadTypes();
      }
    });
    if (ok) setTypeDialog(null);
  };

  const openDelete = async () => {
    if (!selected) return;
    await guard(async () => setDeleteTypeOpen({ usage: await getCommissionUsage(selected.id) }));
  };
  const confirmDelete = async () => {
    if (!selected) return;
    const ok = await guard(async () => {
      await deleteCommissionType(selected.id);
      const next = await getCommissionTypes();
      setTypes(next);
      setSelectedId(next[0]?.id ?? null);
    });
    if (ok) setDeleteTypeOpen(null);
  };

  // ── roles ──
  const saveRole = async () => {
    if (!roleDraft || !selected) return;
    const ok = await guard(async () => {
      const body = { name: roleDraft.name, source: roleDraft.source, multiMode: roleDraft.multiMode };
      if (roleDraft.id) await updateCommissionRole(roleDraft.id, body);
      else await createCommissionRole(selected.id, body);
      await reloadTypes();
      await loadMatrix(selected.id);
    });
    if (ok) setRoleDraft(null);
  };
  const removeRole = async () => {
    if (!roleDraft?.id || !selected) return;
    if (!roleConfirmDelete) return setRoleConfirmDelete(true);
    const ok = await guard(async () => {
      await deleteCommissionRole(roleDraft.id!);
      await reloadTypes();
      await loadMatrix(selected.id);
    });
    if (ok) setRoleDraft(null);
  };

  // ── special rates ──
  const memberGroups = useMemo(() => {
    const g = new Map<string, { userId: string; userName: string; categoryId: string; cells: Drafts }>();
    for (const r of matrix?.memberRates ?? []) {
      const k = `${r.userId}|${r.categoryId}`;
      const e = g.get(k) ?? { userId: r.userId, userName: r.userName, categoryId: r.categoryId, cells: {} };
      e.cells[cellKey(r.roleId, r.dayType)] = fmtRate(r.rate);
      g.set(k, e);
    }
    return [...g.values()];
  }, [matrix]);
  const filteredGroups = memberGroups.filter((g) => g.userName.toLowerCase().includes(search.trim().toLowerCase()));
  const catName = (id: string) => matrix?.categories.find((c) => c.id === id)?.name ?? "—";

  const saveSpecial = async () => {
    if (!special || !selected) return;
    if (!special.userId || !special.categoryId) return toast.error("Choose a person and a category");
    const ok = await guard(async () => {
      await saveMemberRates(
        selected.id,
        special.userId,
        special.categoryId,
        activeRoles.flatMap((r) =>
          DAY_TYPES.map(({ key }) => ({ roleId: r.id, dayType: key, rate: special.cells[cellKey(r.id, key)] ?? "" })),
        ),
      );
      await loadMatrix(selected.id);
    });
    if (ok) {
      setSpecial(null);
      toast.success("Special rate saved");
    }
  };

  const rateInput = (value: string, onChange: (v: string) => void, opts: { placeholder?: string; changed?: boolean } = {}) => (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={opts.placeholder ?? "—"}
      type="number"
      min="0"
      step="0.01"
      className={`h-8 w-[4.5rem] text-right text-xs border rounded-md px-1.5 bg-background transition-colors ${
        opts.changed ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20" : "border-input"
      }`}
    />
  );

  const inactive = selected && !selected.isActive;

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Custom Commission"
        description="The kinds of commission your people earn, who earns each, and the rate per category"
      />

      {types.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 text-center">
          <UsersIcon className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <h2 className="text-sm font-semibold">No commission types yet</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-md mx-auto">
            Start with a type such as “Case commission”. Then add the roles that earn it and set a rate for each
            category.
          </p>
          <Button className="gap-1.5" onClick={() => setTypeDialog({ mode: "new", name: "" })}>
            <PlusIcon className="w-4 h-4" /> Create commission type
          </Button>
        </div>
      ) : (
        <>
          {/* Commission types */}
          <Tabs value={selectedId ?? undefined} onValueChange={selectType} className="gap-0">
            <TabsList>
              {types.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className={t.isActive ? "" : "opacity-60"}>
                  {t.name}
                  {!t.isActive && <span className="text-[10px] font-normal">(off)</span>}
                </TabsTrigger>
              ))}
              <button
                type="button"
                onClick={() => setTypeDialog({ mode: "new", name: "" })}
                className="ml-1 inline-flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50"
              >
                <PlusIcon className="w-3.5 h-3.5" /> New type
              </button>
            </TabsList>
          </Tabs>

          {selected && (
            <div className="mt-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-base font-semibold">{selected.name}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Earned per invoice. Reaches payslips through a Payslip Settings item that uses this type.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {selected.isActive ? "Active" : "Off"}
                    <Switch
                      size="sm"
                      checked={selected.isActive}
                      onCheckedChange={(v) =>
                        void guard(async () => {
                          await updateCommissionType(selected.id, { isActive: v });
                          await reloadTypes();
                        })
                      }
                    />
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Type actions">
                        <MoreHorizontalIcon className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setTypeDialog({ mode: "rename", name: selected.name })}>
                        <PencilIcon className="w-3.5 h-3.5" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void openDelete()}>
                        <TrashIcon className="w-3.5 h-3.5" /> Delete type
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {inactive && (
                <p className="mb-4 text-xs rounded-md border border-border bg-muted/30 px-3 py-2 text-muted-foreground">
                  This type is off, so new invoices won&apos;t generate earnings for it.
                </p>
              )}

              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="roles">
                    Roles
                    <span className="text-xs text-muted-foreground font-normal">{selected.roles.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="rates">
                    Rates
                    {hasUnsaved && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-label="Unsaved changes" />}
                  </TabsTrigger>
                  <TabsTrigger value="special">
                    Special rates
                    <span className="text-xs text-muted-foreground font-normal">{memberGroups.length}</span>
                  </TabsTrigger>
                </TabsList>

                {/* ── Roles ── */}
                <TabsContent value="roles" className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground max-w-xl">
                      A role says who earns this commission. Each role is paid to a person on the invoice and has its
                      own rates.
                    </p>
                    <Button
                      size="sm"
                      className="gap-1 shrink-0"
                      onClick={() => {
                        setRoleConfirmDelete(false);
                        setRoleDraft({ id: null, name: "", source: "sales_person", multiMode: "full_each" });
                      }}
                    >
                      <PlusIcon className="w-3.5 h-3.5" /> Add role
                    </Button>
                  </div>
                  {selected.roles.length === 0 ? (
                    <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
                      No roles yet. Add one, e.g. “Sales Person”, to start setting rates.
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg overflow-hidden">
                      {selected.roles.map((r) => (
                        <div
                          key={r.id}
                          className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 ${r.isActive ? "" : "opacity-60"}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{r.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {SOURCE_LABEL[r.source]}
                              {r.source === "sales_person" && ` · ${MODE_SHORT[r.multiMode]}`}
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            {r.isActive ? "On" : "Off"}
                            <Switch
                              size="sm"
                              checked={r.isActive}
                              onCheckedChange={(v) =>
                                void guard(async () => {
                                  await updateCommissionRole(r.id, { isActive: v });
                                  await reloadTypes();
                                })
                              }
                              aria-label={`${r.name} active`}
                            />
                          </label>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Edit ${r.name}`}
                            onClick={() => {
                              setRoleConfirmDelete(false);
                              setRoleDraft({ id: r.id, name: r.name, source: r.source, multiMode: r.multiMode });
                            }}
                          >
                            <PencilIcon className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* ── Rates ── */}
                <TabsContent value="rates" className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Rate in RM per case. Leave a cell blank if the role earns nothing for that category and day type.
                    A case on a public holiday always uses the holiday rate, even on a weekend.
                  </p>
                  {activeRoles.length === 0 ? (
                    <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
                      Add an active role first.{" "}
                      <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setTab("roles")}>
                        Go to Roles
                      </button>
                    </div>
                  ) : !matrix ? (
                    <p className="text-sm text-muted-foreground py-6">Loading…</p>
                  ) : matrix.categories.length === 0 ? (
                    <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
                      No categories yet. Add document categories under Organization → Categories.
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg overflow-auto max-h-[60vh]">
                      <table className="w-full text-sm border-separate border-spacing-0">
                        <thead className="sticky top-0 z-20 bg-background">
                          <tr className="text-xs text-muted-foreground">
                            <th
                              rowSpan={2}
                              className="sticky left-0 z-30 bg-background text-left font-medium px-4 py-2 align-bottom border-b border-border min-w-40"
                            >
                              Category
                            </th>
                            {activeRoles.map((r) => (
                              <th key={r.id} colSpan={3} className="text-center font-medium px-2 py-2 border-l border-border">
                                {r.name}
                              </th>
                            ))}
                          </tr>
                          <tr className="text-[10px] text-muted-foreground">
                            {activeRoles.flatMap((r) =>
                              DAY_TYPES.map(({ key, label }, i) => (
                                <th
                                  key={`${r.id}${key}`}
                                  className={`font-normal px-1 py-1 border-b border-border ${i === 0 ? "border-l" : ""}`}
                                >
                                  {label}
                                </th>
                              )),
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {matrix.categories.map((c) => {
                            const rowDirty = dirtyCategories.some((d) => d.id === c.id);
                            return (
                              <tr key={c.id} className={rowDirty ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}>
                                <td className="sticky left-0 z-10 bg-background px-4 py-1.5 font-medium border-b border-border">
                                  {c.name}
                                </td>
                                {activeRoles.flatMap((r) =>
                                  DAY_TYPES.map(({ key }, i) => {
                                    const k = cellKey(r.id, key);
                                    return (
                                      <td
                                        key={k}
                                        className={`px-1 py-1.5 text-center border-b border-border ${i === 0 ? "border-l" : ""}`}
                                      >
                                        {rateInput(
                                          drafts[c.id]?.[k] ?? "",
                                          (v) => setDrafts((d) => ({ ...d, [c.id]: { ...d[c.id], [k]: v } })),
                                          { changed: cellDirty(c.id, k) },
                                        )}
                                      </td>
                                    );
                                  }),
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {hasUnsaved && (
                    <div className="sticky bottom-3 z-30 flex items-center justify-between gap-3 rounded-lg border border-border bg-background/95 backdrop-blur px-4 py-2.5 shadow-md">
                      <span className="text-sm">
                        {dirtyCategories.length} categor{dirtyCategories.length === 1 ? "y" : "ies"} with unsaved
                        changes
                      </span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={discard} disabled={saving}>
                          Discard
                        </Button>
                        <Button size="sm" onClick={saveAll} disabled={saving}>
                          {saving ? "Saving…" : "Save changes"}
                        </Button>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* ── Special rates ── */}
                <TabsContent value="special" className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground max-w-xl">
                      For a person paid differently from the default for a category. Their rate replaces the default; a
                      blank cell falls back to it.
                    </p>
                    <Button
                      size="sm"
                      className="gap-1 shrink-0"
                      disabled={activeRoles.length === 0}
                      onClick={() => setSpecial({ userId: "", categoryId: "", cells: {}, isNew: true })}
                    >
                      <PlusIcon className="w-3.5 h-3.5" /> Add special rate
                    </Button>
                  </div>
                  {memberGroups.length > 4 && (
                    <div className="relative max-w-xs">
                      <SearchIcon className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search person"
                        className="h-9 pl-8 text-sm"
                      />
                    </div>
                  )}
                  {memberGroups.length === 0 ? (
                    <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
                      No special rates. Everyone earns the default rates.
                    </div>
                  ) : filteredGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No one matches “{search}”.</p>
                  ) : (
                    <div className="border border-border rounded-lg overflow-hidden">
                      {filteredGroups.map((g) => (
                        <div key={`${g.userId}|${g.categoryId}`} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">
                              {g.userName}{" "}
                              <span className="text-muted-foreground font-normal">· {catName(g.categoryId)}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {activeRoles
                                .map((r) => {
                                  const parts = DAY_TYPES.filter(({ key }) => g.cells[cellKey(r.id, key)] !== undefined).map(
                                    ({ key, label }) => `${label} ${g.cells[cellKey(r.id, key)]}`,
                                  );
                                  return parts.length ? `${r.name}: ${parts.join(", ")}` : null;
                                })
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Edit"
                            onClick={() => setSpecial({ userId: g.userId, categoryId: g.categoryId, cells: { ...g.cells }, isNew: false })}
                          >
                            <PencilIcon className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Remove"
                            onClick={() =>
                              void guard(async () => {
                                await deleteMemberRates(selected.id, g.userId, g.categoryId);
                                await loadMatrix(selected.id);
                              })
                            }
                          >
                            <TrashIcon className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </>
      )}

      <div className="flex gap-2.5 p-3 mt-8 rounded-lg border border-border bg-muted/20 text-xs text-muted-foreground">
        <InfoIcon className="w-4 h-4 shrink-0 mt-px" />
        <p>
          Earnings are generated when an invoice is created or edited, from its category, people and case date.
          Changing rates affects invoices saved afterwards; earnings already paid, or already on a payslip, are left
          alone.
        </p>
      </div>

      {/* New / rename type */}
      <Dialog open={!!typeDialog} onOpenChange={(o) => !o && setTypeDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{typeDialog?.mode === "new" ? "New commission type" : "Rename commission type"}</DialogTitle>
          </DialogHeader>
          <Input
            value={typeDialog?.name ?? ""}
            onChange={(e) => typeDialog && setTypeDialog({ ...typeDialog, name: e.target.value })}
            placeholder="e.g. Case commission, Installation bonus"
            className="h-9 text-sm"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && void submitTypeDialog()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTypeDialog(null)}>Cancel</Button>
            <Button onClick={submitTypeDialog}>{typeDialog?.mode === "new" ? "Create" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete type */}
      <Dialog open={!!deleteTypeOpen} onOpenChange={(o) => !o && setDeleteTypeOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{selected?.name}”?</DialogTitle>
            <DialogDescription>
              Its roles, rates and special rates are removed.{" "}
              {deleteTypeOpen && deleteTypeOpen.usage > 0
                ? `${deleteTypeOpen.usage} past earning${deleteTypeOpen.usage !== 1 ? "s" : ""} keep their rows and amounts.`
                : "No earnings have been generated for it yet."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTypeOpen(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete type</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role */}
      <Dialog open={!!roleDraft} onOpenChange={(o) => !o && setRoleDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{roleDraft?.id ? "Edit role" : "Add role"}</DialogTitle>
          </DialogHeader>
          {roleDraft && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Role name</label>
                <Input
                  value={roleDraft.name}
                  onChange={(e) => setRoleDraft({ ...roleDraft, name: e.target.value })}
                  placeholder="e.g. Sales Person, Technician"
                  className="h-9 text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Paid to</label>
                <div className="space-y-1.5">
                  {(Object.keys(SOURCE_LABEL) as CommissionSource[]).map((s) => (
                    <label
                      key={s}
                      className={`flex items-center gap-2.5 rounded-md border px-3 py-2 cursor-pointer text-sm ${
                        roleDraft.source === s ? "border-primary bg-primary/5" : "border-input hover:bg-muted/40"
                      }`}
                    >
                      <input type="radio" name="source" checked={roleDraft.source === s} onChange={() => setRoleDraft({ ...roleDraft, source: s })} />
                      {SOURCE_LABEL[s]}
                    </label>
                  ))}
                </div>
              </div>
              {roleDraft.source === "sales_person" && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    When several sales persons are on one invoice
                  </label>
                  <div className="space-y-1.5">
                    {MODES.map((m) => (
                      <label
                        key={m.value}
                        className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer ${
                          roleDraft.multiMode === m.value ? "border-primary bg-primary/5" : "border-input hover:bg-muted/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name="mode"
                          className="mt-0.5"
                          checked={roleDraft.multiMode === m.value}
                          onChange={() => setRoleDraft({ ...roleDraft, multiMode: m.value })}
                        />
                        <span>
                          <span className="block text-sm font-medium">{m.label}</span>
                          <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="sm:justify-between">
            {roleDraft?.id ? (
              <Button variant="ghost" className="text-destructive hover:text-destructive gap-1.5" onClick={removeRole}>
                <TrashIcon className="w-3.5 h-3.5" />
                {roleConfirmDelete ? "Click again to delete" : "Delete"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRoleDraft(null)}>Cancel</Button>
              <Button onClick={saveRole}>Save</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Special rate */}
      <Dialog open={!!special} onOpenChange={(o) => !o && setSpecial(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{special?.isNew ? "Add special rate" : "Edit special rate"}</DialogTitle>
          </DialogHeader>
          {special && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Person</label>
                  <select
                    value={special.userId}
                    disabled={!special.isNew}
                    onChange={(e) => setSpecial({ ...special, userId: e.target.value })}
                    className="h-9 w-full text-sm border border-input rounded-md px-2 bg-background disabled:opacity-60"
                  >
                    <option value="">Select…</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Category</label>
                  <select
                    value={special.categoryId}
                    disabled={!special.isNew}
                    onChange={(e) => setSpecial({ ...special, categoryId: e.target.value })}
                    className="h-9 w-full text-sm border border-input rounded-md px-2 bg-background disabled:opacity-60"
                  >
                    <option value="">Select…</option>
                    {matrix?.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30 text-muted-foreground">
                      <th className="text-left font-medium px-3 py-1.5">Role</th>
                      {DAY_TYPES.map((d) => (
                        <th key={d.key} className="font-medium px-2 py-1.5">{d.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeRoles.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-3 py-1.5">{r.name}</td>
                        {DAY_TYPES.map(({ key }) => (
                          <td key={key} className="px-1 py-1.5 text-center">
                            {rateInput(
                              special.cells[cellKey(r.id, key)] ?? "",
                              (v) => setSpecial({ ...special, cells: { ...special.cells, [cellKey(r.id, key)]: v } }),
                              { placeholder: "default" },
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpecial(null)}>Cancel</Button>
            <Button onClick={saveSpecial}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
