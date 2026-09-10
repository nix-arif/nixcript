"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SettingsIcon, CheckIcon, CalendarDaysIcon, TrashIcon, PlusIcon, InfoIcon } from "lucide-react";
import {
  upsertCategoryAllowanceRate,
  updateAllowanceSettings,
  createPublicHoliday,
  deletePublicHoliday,
  type CategoryAllowanceRateRow,
  type MultiSalesPersonMode,
  type PublicHolidayRow,
} from "@/server/category-allowance-rate";

interface Props {
  rates: CategoryAllowanceRateRow[];
  settings: { multiSalesPersonMode: MultiSalesPersonMode };
  holidays: PublicHolidayRow[];
}

type Draft = {
  salesPersonWeekdayRate: string;
  salesPersonWeekendRate: string;
  salesPersonHolidayRate: string;
  appSpecialistWeekdayRate: string;
  appSpecialistWeekendRate: string;
  appSpecialistHolidayRate: string;
};

const RATE_FIELDS = [
  "salesPersonWeekdayRate", "salesPersonWeekendRate", "salesPersonHolidayRate",
  "appSpecialistWeekdayRate", "appSpecialistWeekendRate", "appSpecialistHolidayRate",
] as const;

const RATE_FIELD_LABELS: Record<(typeof RATE_FIELDS)[number], string> = {
  salesPersonWeekdayRate: "SP Weekday",
  salesPersonWeekendRate: "SP Weekend",
  salesPersonHolidayRate: "SP Holiday",
  appSpecialistWeekdayRate: "AS Weekday",
  appSpecialistWeekendRate: "AS Weekend",
  appSpecialistHolidayRate: "AS Holiday",
};

function toDraft(r: CategoryAllowanceRateRow): Draft {
  return {
    salesPersonWeekdayRate: r.salesPersonWeekdayRate ?? "",
    salesPersonWeekendRate: r.salesPersonWeekendRate ?? "",
    salesPersonHolidayRate: r.salesPersonHolidayRate ?? "",
    appSpecialistWeekdayRate: r.appSpecialistWeekdayRate ?? "",
    appSpecialistWeekendRate: r.appSpecialistWeekendRate ?? "",
    appSpecialistHolidayRate: r.appSpecialistHolidayRate ?? "",
  };
}

const MODE_OPTIONS: { value: MultiSalesPersonMode; label: string; description: string }[] = [
  { value: "full_each", label: "Each gets full rate", description: "Every sales person on the invoice earns the full rate." },
  { value: "split", label: "Split evenly", description: "The rate is divided across however many sales persons are listed." },
  { value: "primary_only", label: "Primary only", description: "Only the primary sales person earns it." },
];

function fmtHolidayDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

export function AllowanceRatesClient({ rates: initialRates, settings, holidays: initialHolidays }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initialRates.map((r) => [r.categoryId, toDraft(r)])));
  const [saved, setSaved] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initialRates.map((r) => [r.categoryId, toDraft(r)])));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [mode, setMode] = useState<MultiSalesPersonMode>(settings.multiSalesPersonMode);
  const [savingMode, setSavingMode] = useState(false);

  const [holidays, setHolidays] = useState(initialHolidays);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [deletingHolidayId, setDeletingHolidayId] = useState<string | null>(null);

  function setField(categoryId: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [categoryId]: { ...prev[categoryId], [field]: value } }));
  }

  function isDirty(categoryId: string): boolean {
    const d = drafts[categoryId];
    const s = saved[categoryId];
    return JSON.stringify(d) !== JSON.stringify(s);
  }

  async function handleSaveRow(categoryId: string) {
    const d = drafts[categoryId];
    setSavingId(categoryId);
    try {
      await upsertCategoryAllowanceRate({
        categoryId,
        salesPersonWeekdayRate: d.salesPersonWeekdayRate.trim() || null,
        salesPersonWeekendRate: d.salesPersonWeekendRate.trim() || null,
        salesPersonHolidayRate: d.salesPersonHolidayRate.trim() || null,
        appSpecialistWeekdayRate: d.appSpecialistWeekdayRate.trim() || null,
        appSpecialistWeekendRate: d.appSpecialistWeekendRate.trim() || null,
        appSpecialistHolidayRate: d.appSpecialistHolidayRate.trim() || null,
      });
      setSaved((prev) => ({ ...prev, [categoryId]: d }));
      toast.success("Rate saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save rate");
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveMode(next: MultiSalesPersonMode) {
    setMode(next);
    setSavingMode(true);
    try {
      await updateAllowanceSettings({ multiSalesPersonMode: next });
      toast.success("Setting saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save setting");
    } finally {
      setSavingMode(false);
    }
  }

  async function handleAddHoliday() {
    if (!newHolidayDate || !newHolidayName.trim()) return;
    setAddingHoliday(true);
    try {
      const row = await createPublicHoliday({ date: newHolidayDate, name: newHolidayName.trim() });
      setHolidays((prev) => [row, ...prev.filter((h) => h.date !== row.date)].sort((a, b) => b.date.localeCompare(a.date)));
      setNewHolidayDate("");
      setNewHolidayName("");
      toast.success("Holiday added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add holiday");
    } finally {
      setAddingHoliday(false);
    }
  }

  async function handleDeleteHoliday(id: string) {
    setDeletingHolidayId(id);
    try {
      await deletePublicHoliday(id);
      setHolidays((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove holiday");
    } finally {
      setDeletingHolidayId(null);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-muted-foreground" />
          Allowance Rates
        </h1>
        <p className="text-sm text-muted-foreground">
          Set the allowance a sales person or application specialist earns per category. Leave a rate blank if that role doesn&apos;t earn for that category. A case on a public holiday always uses the holiday rate, even if it also falls on a weekend.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="border border-border rounded-xl p-4 space-y-2.5">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Multiple sales persons on one invoice
          </h2>
          <div className="grid grid-cols-1 gap-2">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={savingMode}
                onClick={() => handleSaveMode(opt.value)}
                className={`text-left rounded-lg border p-3 text-xs transition-colors disabled:opacity-50 ${
                  mode === opt.value
                    ? "border-foreground bg-muted/50"
                    : "border-border hover:bg-muted/30"
                }`}
              >
                <p className="font-medium mb-0.5">{opt.label}</p>
                <p className="text-muted-foreground">{opt.description}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="border border-border rounded-xl p-4 space-y-2.5">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <CalendarDaysIcon className="w-3.5 h-3.5" /> Public Holidays
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={newHolidayDate}
              onChange={(e) => setNewHolidayDate(e.target.value)}
              className="h-8 px-2 border border-input rounded-md text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
            />
            <Input
              value={newHolidayName}
              onChange={(e) => setNewHolidayName(e.target.value)}
              placeholder="Holiday name"
              className="h-8 text-xs flex-1"
            />
            <Button size="sm" className="h-8 gap-1 text-xs shrink-0" disabled={addingHoliday || !newHolidayDate || !newHolidayName.trim()} onClick={handleAddHoliday}>
              <PlusIcon className="w-3 h-3" /> Add
            </Button>
          </div>
          {holidays.length === 0 ? (
            <p className="text-xs text-muted-foreground">No holidays added yet.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
              {holidays.map((h) => (
                <div key={h.id} className="flex items-center justify-between text-xs rounded-md border border-border/60 px-2 py-1.5">
                  <span className="text-muted-foreground whitespace-nowrap">{fmtHolidayDate(h.date)}</span>
                  <span className="font-medium truncate mx-2">{h.name}</span>
                  <button
                    type="button"
                    disabled={deletingHolidayId === h.id}
                    onClick={() => handleDeleteHoliday(h.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <TrashIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-muted/20 p-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
          <InfoIcon className="w-3.5 h-3.5" /> Legend
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 text-xs">
          <div className="flex items-start gap-1.5">
            <span className="font-mono font-semibold text-foreground shrink-0">SP</span>
            <span className="text-muted-foreground">Sales Person — the invoice&apos;s primary + associate sales persons.</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="font-mono font-semibold text-foreground shrink-0">AS</span>
            <span className="text-muted-foreground">Application Specialist assigned to the invoice.</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="font-mono font-semibold text-foreground shrink-0">Weekday</span>
            <span className="text-muted-foreground">Case date falls Mon–Fri.</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="font-mono font-semibold text-foreground shrink-0">Weekend</span>
            <span className="text-muted-foreground">Case date falls Sat–Sun.</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="font-mono font-semibold text-foreground shrink-0">Holiday</span>
            <span className="text-muted-foreground">Case date is on the Public Holidays list — always wins over weekday/weekend.</span>
          </div>
          <div className="flex items-start gap-1.5 sm:col-span-2 lg:col-span-2">
            <span className="font-mono font-semibold text-foreground shrink-0">Blank</span>
            <span className="text-muted-foreground">That role earns nothing for this category/day type. Fill in only SP, only AS, or both — independently, per category.</span>
          </div>
        </div>
      </section>

      {initialRates.length === 0 ? (
        <div className="rounded-lg border border-border py-14 flex items-center justify-center text-sm text-muted-foreground">
          No categories yet — create categories under Organization → Categories first.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="whitespace-nowrap">Category</TableHead>
                {RATE_FIELDS.map((f) => (
                  <TableHead key={f} className="w-28 whitespace-nowrap">{RATE_FIELD_LABELS[f]}</TableHead>
                ))}
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialRates.map((r) => {
                const d = drafts[r.categoryId];
                const dirty = isDirty(r.categoryId);
                return (
                  <TableRow key={r.categoryId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {r.categoryColor && (
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.categoryColor }} />
                        )}
                        <span className="text-sm font-medium whitespace-nowrap">{r.categoryName}</span>
                      </div>
                    </TableCell>
                    {RATE_FIELDS.map((field) => (
                      <TableCell key={field}>
                        <Input
                          value={d[field]}
                          onChange={(e) => setField(r.categoryId, field, e.target.value)}
                          placeholder="—"
                          className="h-8 text-xs w-24"
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      {dirty && (
                        <Button size="sm" className="h-7 gap-1 text-xs" disabled={savingId === r.categoryId} onClick={() => handleSaveRow(r.categoryId)}>
                          <CheckIcon className="w-3 h-3" />
                          {savingId === r.categoryId ? "Saving…" : "Save"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
