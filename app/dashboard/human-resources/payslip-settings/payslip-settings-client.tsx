"use client";

import { useState } from "react";
import { toast } from "sonner";
import { InfoIcon, LockIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SalaryStructurePanel } from "./salary-structure-panel";
import { PdfPanel } from "./pdf-panel";
import { ReliefPanel } from "./relief-panel";
import type { getTaxReliefTypes } from "@/server/tax-relief";
import type { PayslipPdfSettings } from "@/lib/payroll/pdf-settings";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getPayItems,
  createPayItem,
  updatePayItem,
  deletePayItem,
  applyPayItemsToAll,
} from "@/server/payroll";

type Item = Awaited<ReturnType<typeof getPayItems>>[number];
type Kind = "earning" | "deduction";
type StatKey = "inEpf" | "inSocso" | "inEis" | "inPcb";
type Flags = Record<StatKey, boolean>;

const STAT_FLAGS: { key: StatKey; label: string; hint: string }[] = [
  { key: "inEpf", label: "EPF", hint: "Added to the EPF contribution base" },
  { key: "inSocso", label: "SOCSO", hint: "Added to the SOCSO wage base" },
  { key: "inEis", label: "EIS", hint: "Added to the EIS wage base" },
  { key: "inPcb", label: "PCB", hint: "Counted as taxable income for PCB" },
];

const flagsOf = (it: Flags): Flags => ({ inEpf: it.inEpf, inSocso: it.inSocso, inEis: it.inEis, inPcb: it.inPcb });

const rm = (v: string | null) =>
  Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Draft = {
  id: string | null;
  kind: Kind;
  name: string;
  calcType: "fixed" | "per_unit" | "invoice_allowance";
  unitLabel: string;
  rate: string;
  flags: Flags;
  recurring: boolean;
  commissionTypeId: string;
  locked: boolean; // statutory item (EPF/SOCSO/EIS/PCB): name and auto/manual only
  systemKey: string | null;
  statutoryMode: "auto" | "manual";
};

const DEFAULT_STATUTORY_NAME: Record<string, string> = {
  epf: "EPF",
  socso: "SOCSO",
  eis: "EIS",
  pcb: "PCB / LHDN",
};

const blankDraft = (kind: Kind): Draft => ({
  id: null,
  kind,
  name: "",
  calcType: "fixed",
  unitLabel: "",
  rate: "",
  flags: { inEpf: true, inSocso: true, inEis: true, inPcb: true },
  recurring: true,
  commissionTypeId: "",
  locked: false,
  systemKey: null,
  statutoryMode: "auto",
});

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "amber" | "blue" | "green" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground border-border",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
    blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800",
    green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800",
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PayslipSettingsClient({
  initialItems,
  commissionTypes,
  structures,
  initialTab,
  pdfSettings,
  reliefTypes,
  siblingOrgs,
}: {
  initialItems: Item[];
  commissionTypes: { id: string; name: string; isActive: boolean }[];
  structures: React.ComponentProps<typeof SalaryStructurePanel>["initialRows"];
  initialTab: "items" | "structure" | "pdf" | "relief";
  reliefTypes: Awaited<ReturnType<typeof getTaxReliefTypes>>;
  siblingOrgs: { id: string; name: string }[];
  pdfSettings: PayslipPdfSettings;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  const [items, setItems] = useState(initialItems);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = async () => setItems(await getPayItems());
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<Awaited<ReturnType<typeof applyPayItemsToAll>> | null>(null);
  // Step 1: check what would happen, without changing anything
  const review = async () => {
    setApplying(true);
    try {
      setApplyResult(await applyPayItemsToAll({ dryRun: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check");
    } finally {
      setApplying(false);
    }
  };
  // Step 2: really apply (after the user has seen the review)
  const applyAll = async (force = false) => {
    setApplyResult(null);
    setApplying(true);
    try {
      const r = await applyPayItemsToAll({ force });
      if (r.skipped.length || r.forced.length) setApplyResult(r);
      else toast.success(`Applied to ${r.orgs} organization${r.orgs === 1 ? "" : "s"}: ${r.created} added, ${r.updated} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply");
    } finally {
      setApplying(false);
    }
  };

  const earnings = items.filter((i) => i.kind === "earning");
  const statutory = items.filter((i) => i.kind === "deduction" && i.systemKey);
  const deductions = items.filter((i) => i.kind === "deduction" && !i.systemKey);

  const openEdit = (it: Item) => {
    setConfirmDelete(false);
    setDraft({
      id: it.id,
      kind: it.kind as Kind,
      name: it.name,
      calcType: it.calcType === "per_unit" ? "per_unit" : it.calcType === "invoice_allowance" ? "invoice_allowance" : "fixed",
      unitLabel: it.unitLabel ?? "",
      rate: it.rate ?? "",
      flags: flagsOf(it),
      recurring: it.recurring,
      commissionTypeId: it.commissionTypeId ?? "",
      locked: !!it.systemKey,
      systemKey: it.systemKey,
      statutoryMode: it.calcType === "manual" ? "manual" : "auto",
    });
  };
  const openAdd = (kind: Kind) => {
    setConfirmDelete(false);
    setDraft(blankDraft(kind));
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Enter a name");
    if (draft.kind === "earning" && draft.calcType === "invoice_allowance" && !draft.commissionTypeId)
      return toast.error("Choose which commission type this item pays out");
    if (draft.calcType === "per_unit" && draft.kind === "earning" && !(Number(draft.rate) >= 0 && draft.rate.trim() !== ""))
      return toast.error("Enter a rate per unit");
    setSaving(true);
    try {
      const isEarning = draft.kind === "earning";
      const perUnit = isEarning && draft.calcType === "per_unit";
      const fields = {
        name: draft.name,
        inEpf: isEarning && draft.flags.inEpf,
        inSocso: isEarning && draft.flags.inSocso,
        inEis: isEarning && draft.flags.inEis,
        inPcb: isEarning && draft.flags.inPcb,
        recurring: isEarning && draft.calcType !== "fixed" ? false : draft.recurring,
        calcType: (isEarning ? draft.calcType : "fixed") as "fixed" | "per_unit" | "invoice_allowance",
        unitLabel: perUnit ? draft.unitLabel : null,
        rate: perUnit ? draft.rate : null,
        commissionTypeId: isEarning && draft.calcType === "invoice_allowance" ? draft.commissionTypeId : null,
      };
      if (draft.id) {
        await updatePayItem(draft.id, draft.locked ? { name: draft.name, calcType: draft.statutoryMode } : fields);
      } else {
        await createPayItem({ ...fields, kind: draft.kind });
      }
      await reload();
      setDraft(null);
      toast.success(draft.id ? "Saved" : "Added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    if (!confirmDelete) return setConfirmDelete(true);
    await run(() => deletePayItem(draft.id!));
    setDraft(null);
  };

  const meta = (it: Item) => {
    if (it.systemKey)
      return it.calcType === "manual"
        ? "Entered manually on each payslip"
        : "Calculated automatically from the basic salary and earnings";
    if (it.kind === "deduction") return it.recurring ? "Fixed amount · set per employee" : "Entered each month";
    if (it.calcType === "invoice_allowance")
      return `Pays out “${commissionTypes.find((t) => t.id === it.commissionTypeId)?.name ?? "—"}” earnings · from Custom Commission`;
    if (it.calcType === "per_unit")
      return `RM ${rm(it.rate)} per ${it.unitLabel || "unit"} · entered each month`;
    return it.recurring ? "Fixed amount · set per employee" : "Entered each month";
  };

  const row = (it: Item) => (
    <div
      key={it.id}
      className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 ${it.isActive ? "" : "opacity-60"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{it.name}</span>
          {it.systemKey && (
            <Pill tone={it.calcType === "manual" ? "blue" : "muted"}>
              <LockIcon className="inline w-2.5 h-2.5 mr-0.5 -mt-px" />
              {it.calcType === "manual" ? "Manual" : "Auto"}
            </Pill>
          )}
          {it.kind === "earning" &&
            (STAT_FLAGS.some((f) => it[f.key]) ? (
              <Pill tone="amber">{STAT_FLAGS.filter((f) => it[f.key]).map((f) => f.label).join(" · ")}</Pill>
            ) : (
              <Pill>Not counted</Pill>
            ))}
          {it.calcType === "per_unit" && <Pill tone="green">Qty × rate</Pill>}
          {it.calcType === "invoice_allowance" && <Pill tone="green">Commission</Pill>}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{meta(it)}</div>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        {it.isActive ? "On" : "Off"}
        <Switch
          size="sm"
          checked={it.isActive}
          onCheckedChange={(v) => void run(() => updatePayItem(it.id, { isActive: v }))}
          aria-label={`${it.name} active`}
        />
      </label>
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => openEdit(it)} aria-label={`Edit ${it.name}`}>
        <PencilIcon className="w-3.5 h-3.5" />
      </Button>
    </div>
  );

  const section = (
    title: string,
    desc: string,
    list: Item[],
    addKind?: Kind,
    emptyText?: string,
  ) => (
    <section className="border border-border rounded-lg overflow-hidden mb-6">
      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
        </div>
        {addKind && (
          <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => openAdd(addKind)}>
            <PlusIcon className="w-3.5 h-3.5" /> Add
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{emptyText ?? "Nothing here yet."}</p>
      ) : (
        list.map(row)
      )}
    </section>
  );

  const isEarning = draft?.kind === "earning";

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Payslip Settings"
        description="What appears on a payslip, and each employee's salary"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="items">Pay items</TabsTrigger>
          <TabsTrigger value="structure">Salary structure</TabsTrigger>
          <TabsTrigger value="relief">Tax relief</TabsTrigger>
          <TabsTrigger value="pdf">Payslip PDF</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="max-w-3xl">
      {siblingOrgs.length > 0 && (
        <div className="rounded-xl border border-border p-4 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Apply to all group of companies</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Copy these pay items to {siblingOrgs.map((o) => o.name).join(", ")} (same owner). Items are matched by name.
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 shrink-0" disabled={applying} onClick={review}>
            {applying ? "Checking…" : "Apply to all"}
          </Button>
        </div>
      )}
      <div className="flex gap-2.5 p-3 mb-6 rounded-lg border border-border bg-muted/20 text-xs text-muted-foreground">
        <InfoIcon className="w-4 h-4 shrink-0 mt-px" />
        <p>
          A payslip is <span className="font-medium text-foreground">basic salary</span> plus the
          earnings below, minus deductions. Only <em>On</em> items appear when
          creating a payslip. Fixed items can be set once per employee under the Salary
          structure tab; the rest are entered each month. Changes don&apos;t alter
          payslips that already exist.
        </p>
      </div>

      {section(
        "Earnings",
        "Allowances, bonus, overtime and anything else paid on top of basic salary",
        earnings,
        "earning",
        "No earnings yet. Add one, e.g. Car allowance.",
      )}
      {section(
        "Statutory deductions",
        "Calculated automatically. You can rename them or switch them off",
        statutory,
      )}
      {section(
        "Other deductions",
        "Cash advance, loan repayment and similar",
        deductions,
        "deduction",
        "No other deductions yet.",
      )}
        </TabsContent>

        <TabsContent value="relief">
          <ReliefPanel initial={reliefTypes} />
        </TabsContent>

        <TabsContent value="pdf">
          <PdfPanel initial={pdfSettings} siblingOrgs={siblingOrgs} />
        </TabsContent>

        <TabsContent value="structure">
          <SalaryStructurePanel initialRows={structures} payItems={items} reliefTypes={reliefTypes} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!applyResult} onOpenChange={(o) => !o && setApplyResult(null)}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {applyResult?.dryRun
                ? "Review before applying"
                : applyResult?.skipped.length
                  ? `Applied, but ${applyResult.skipped.length} item${applyResult.skipped.length === 1 ? "" : "s"} could not be copied`
                  : "Applied, with changes to note"}
            </DialogTitle>
            <DialogDescription>
              {applyResult?.dryRun ? (
                <>
                  Nothing has been changed yet. Applying will add {applyResult.created} and update {applyResult.updated} item
                  {applyResult.created + applyResult.updated === 1 ? "" : "s"} across {applyResult.orgs} organization
                  {applyResult.orgs === 1 ? "" : "s"}.
                  {applyResult.skipped.length
                    ? ` ${applyResult.skipped.length} item${applyResult.skipped.length === 1 ? "" : "s"} cannot be copied as they are. Fix them first (steps below), or apply without them, or use Apply anyway.`
                    : ""}
                </>
              ) : (
                <>
                  {applyResult?.created} added and {applyResult?.updated} updated across {applyResult?.orgs} organization
                  {applyResult?.orgs === 1 ? "" : "s"}.
                  {applyResult?.skipped.length ? " The items below were left out. Follow the steps under each one, then press Apply to all again, or use Apply anyway." : ""}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {applyResult?.skipped.map((s, i) => (
              <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-900/10 dark:border-amber-800 p-3 text-sm">
                <div className="font-medium">
                  {s.item} <span className="font-normal text-muted-foreground">· {s.org}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>
                <p className="text-xs mt-2">
                  <span className="font-semibold">What to do: </span>
                  {s.fix}
                </p>
              </div>
            ))}
          </div>
          {!!applyResult?.forced.length && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Copied with changes</div>
              {applyResult.forced.map((f, i) => (
                <div key={i} className="rounded-lg border border-border p-3 text-xs">
                  <span className="font-medium text-sm">{f.item}</span> <span className="text-muted-foreground">· {f.org}</span>
                  <p className="text-muted-foreground mt-1">{f.note}</p>
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {applyResult?.dryRun && (
              <Button variant="ghost" onClick={() => setApplyResult(null)}>
                Cancel
              </Button>
            )}
            {!!applyResult?.skipped.some((s) => /commission/i.test(s.reason)) && (
              <Button variant="outline" disabled={applying} onClick={() => applyAll(true)}>
                Apply anyway
              </Button>
            )}
            {applyResult?.dryRun ? (
              <Button disabled={applying} onClick={() => applyAll(false)}>
                {applyResult.skipped.length ? `Apply without ${applyResult.skipped.length} item${applyResult.skipped.length === 1 ? "" : "s"}` : "Apply"}
              </Button>
            ) : (
              <Button onClick={() => setApplyResult(null)}>Got it</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent
          className={`gap-0 p-0 flex flex-col overflow-hidden
            h-dvh w-screen max-w-none rounded-none top-0 left-0 translate-x-0 translate-y-0
            sm:h-auto sm:max-h-[90vh] sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl
            sm:w-[calc(100vw-4rem)] ${isEarning && !draft?.locked ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
        >
          <DialogHeader className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 border-b border-border">
            <DialogTitle>
              {draft?.locked ? "Statutory deduction" : `${draft?.id ? "Edit" : "Add"} ${isEarning ? "earning" : "deduction"}`}
            </DialogTitle>
            <DialogDescription>
              {draft?.locked
                ? "Choose whether this is calculated for you or typed on each payslip."
                : isEarning
                  ? "Something paid on top of basic salary. Choose how the amount is set and which statutory deductions it affects."
                  : "A deduction taken from net pay, such as a cash advance or loan repayment."}
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className={`flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 grid gap-6 content-start ${isEarning && !draft.locked ? "md:grid-cols-2 md:gap-x-8" : ""}`}>
            <div className="space-y-6 min-w-0">
              <Field label="Name">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter" && !saving) save(); }}
                  placeholder={isEarning ? "e.g. Car allowance" : "e.g. Cash advance"}
                  className="h-9 text-sm"
                  autoFocus
                />
              </Field>

              {draft.locked && (
                <Field label="Amount">
                  <div className="space-y-2">
                    <Choice
                      checked={draft.statutoryMode === "auto"}
                      onSelect={() => setDraft({ ...draft, statutoryMode: "auto" })}
                      title="Auto-calculate"
                      badge="Default"
                      hint="Worked out from the basic salary and the earnings that count toward it, using the statutory rates."
                    />
                    <Choice
                      checked={draft.statutoryMode === "manual"}
                      onSelect={() => setDraft({ ...draft, statutoryMode: "manual" })}
                      title="Enter manually"
                      hint={
                        draft.systemKey === "pcb"
                          ? "Type the PCB amount on each payslip (or in the Excel import)."
                          : "Type the employee and employer amounts on each payslip (or in the Excel import)."
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    To leave this deduction off payslips entirely, use the On/Off switch on the list.
                  </p>
                </Field>
              )}

              {!draft.locked && isEarning && (
                      <Field label="How is the amount set?">
                        <div className="space-y-2">
                          <Choice
                            checked={draft.calcType === "fixed"}
                            onSelect={() => setDraft({ ...draft, calcType: "fixed" })}
                            title="Fixed amount"
                            hint="You type the amount for each employee."
                          />
                          <Choice
                            checked={draft.calcType === "per_unit"}
                            onSelect={() => setDraft({ ...draft, calcType: "per_unit" })}
                            title="Quantity × rate"
                            hint="For example 12 hours × RM20 overtime."
                          />
                          <Choice
                            checked={draft.calcType === "invoice_allowance"}
                            onSelect={() => setDraft({ ...draft, calcType: "invoice_allowance" })}
                            title="Commission"
                            hint="Pulled from the employee's pending earnings in Custom Commission."
                          />
                        </div>

                        {draft.calcType === "invoice_allowance" && (
                          <div className="mt-3 rounded-lg bg-muted/40 p-3 space-y-2">
                            {commissionTypes.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No commission types yet. Create one under Organization → Custom Commission first.
                              </p>
                            ) : (
                              <>
                                <select
                                  value={draft.commissionTypeId}
                                  onChange={(e) => setDraft({ ...draft, commissionTypeId: e.target.value })}
                                  className="h-9 w-full text-sm border border-input rounded-md px-2 bg-background"
                                >
                                  <option value="">Select commission type…</option>
                                  {commissionTypes.map((t) => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                  ))}
                                </select>
                                <p className="text-[11px] text-muted-foreground">
                                  The payslip lists the pending earnings of this type; untick any before saving. They are
                                  marked paid when the period is published. A type can be paid out by one item only.
                                </p>
                              </>
                            )}
                          </div>
                        )}

                        {draft.calcType === "per_unit" && (
                          <div className="mt-3 rounded-lg bg-muted/40 p-3 grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Unit</label>
                              <Input
                                value={draft.unitLabel}
                                onChange={(e) => setDraft({ ...draft, unitLabel: e.target.value })}
                                placeholder="case, day, hour"
                                className="h-9 text-sm bg-background"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Default rate (RM)</label>
                              <Input
                                value={draft.rate}
                                onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                                type="number"
                                min="0"
                                placeholder="20"
                                className="h-9 text-sm bg-background"
                              />
                            </div>
                          </div>
                        )}
                      </Field>
              )}
            </div>

            <div className="space-y-6 min-w-0 empty:hidden">
              {!draft.locked && isEarning && (
                      <Field
                        label="Counts toward"
                        aside={
                          <span className="flex gap-1">
                            <button type="button" className="text-[11px] text-primary hover:underline"
                              onClick={() => setDraft({ ...draft, flags: { inEpf: true, inSocso: true, inEis: true, inPcb: true } })}>
                              Select all
                            </button>
                            <span className="text-[11px] text-muted-foreground">·</span>
                            <button type="button" className="text-[11px] text-primary hover:underline"
                              onClick={() => setDraft({ ...draft, flags: { inEpf: false, inSocso: false, inEis: false, inPcb: false } })}>
                              None
                            </button>
                          </span>
                        }
                      >
                        <div className="grid grid-cols-4 gap-2">
                          {STAT_FLAGS.map((f) => {
                            const on = draft.flags[f.key];
                            return (
                              <button
                                key={f.key}
                                type="button"
                                role="checkbox"
                                aria-checked={on}
                                onClick={() => setDraft({ ...draft, flags: { ...draft.flags, [f.key]: !on } })}
                                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 transition-colors ${
                                  on ? "border-primary bg-primary/5 text-foreground" : "border-input text-muted-foreground hover:bg-muted/40"
                                }`}
                              >
                                <span className={`flex size-4 items-center justify-center rounded border text-[10px] ${on ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                                  {on ? "✓" : ""}
                                </span>
                                <span className="text-sm font-medium">{f.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2.5">
                          {STAT_FLAGS.every((f) => !draft.flags[f.key])
                            ? "Won't change any statutory deduction. Good for reimbursements."
                            : `Added to the base for ${STAT_FLAGS.filter((f) => draft.flags[f.key]).map((f) => f.label).join(", ")}.`}
                        </p>
                      </Field>
              )}

              {!draft.locked && !(isEarning && draft.calcType !== "fixed") && (
                    <Field label="Frequency">
                      <label className="flex items-center justify-between gap-4 rounded-lg border border-input px-3 py-2.5 cursor-pointer">
                        <span>
                          <span className="block text-sm font-medium">Same every month</span>
                          <span className="block text-[11px] text-muted-foreground">
                            Set once per employee in the Salary structure tab and filled in automatically. Turn off to
                            enter it each month.
                          </span>
                        </span>
                        <Switch checked={draft.recurring} onCheckedChange={(v) => setDraft({ ...draft, recurring: v })} />
                      </label>
                    </Field>
              )}
            </div>
            </div>
          )}

          <DialogFooter className="px-4 py-3 sm:px-6 sm:py-4 border-t border-border flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {draft?.id && draft.locked && draft.systemKey ? (
              <Button
                variant="ghost"
                className="gap-1.5"
                onClick={async () => {
                  if (!draft.id || !draft.systemKey) return;
                  const id = draft.id;
                  const key = draft.systemKey;
                  try {
                    await updatePayItem(id, { name: DEFAULT_STATUTORY_NAME[key], calcType: "auto", isActive: true });
                    await reload();
                    setDraft(null);
                    toast.success("Restored to default");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not reset");
                  }
                }}
              >
                Use default
              </Button>
            ) : draft?.id && !draft.locked ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive gap-1.5"
                onClick={remove}
              >
                <TrashIcon className="w-3.5 h-3.5" />
                {confirmDelete ? "Click again to delete" : "Delete"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
              <Button variant="outline" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || !draft?.name.trim()}>
                {saving ? "Saving…" : draft?.id ? "Save changes" : "Add"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Choice({
  checked, onSelect, title, hint, badge,
}: { checked: boolean; onSelect: () => void; title: string; hint: string; badge?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        checked ? "border-primary bg-primary/5" : "border-input hover:bg-muted/40"
      }`}
    >
      <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${checked ? "border-primary" : "border-input"}`}>
        {checked && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {badge && <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{badge}</span>}
        </span>
        <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>
      </span>
    </button>
  );
}
