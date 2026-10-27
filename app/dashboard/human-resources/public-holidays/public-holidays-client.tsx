"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDaysIcon, CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/page-header";
import { createPublicHoliday, deletePublicHoliday, updatePublicHoliday, type PublicHolidayRow } from "@/server/public-holiday";

const parse = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtDate = (ymd: string) => parse(ymd).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
const weekday = (ymd: string) => parse(ymd).toLocaleDateString("en-MY", { weekday: "long" });
const byDate = (a: PublicHolidayRow, b: PublicHolidayRow) => a.date.localeCompare(b.date);
const dateInput = "h-8 px-2 border border-input rounded-md text-sm bg-background outline-none focus:ring-1 focus:ring-ring";

export function PublicHolidaysClient({
  holidays: initial, canCreate, canUpdate, canDelete,
}: {
  holidays: PublicHolidayRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [holidays, setHolidays] = useState(initial);
  const thisYear = new Date().getFullYear();
  const years = useMemo(
    () => [...new Set([thisYear, ...holidays.map((h) => parseInt(h.date.slice(0, 4), 10))])].sort((a, b) => b - a),
    [holidays, thisYear],
  );
  const [year, setYear] = useState(thisYear);

  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null); // row being saved or deleted
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const shown = holidays.filter((h) => h.date.startsWith(`${year}-`));

  async function add() {
    setAdding(true);
    try {
      const row = await createPublicHoliday({ date: newDate, name: newName });
      setHolidays((p) => [...p, row].sort(byDate));
      setYear(parseInt(row.date.slice(0, 4), 10));
      setNewDate(""); setNewName("");
      toast.success("Holiday added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the holiday");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(h: PublicHolidayRow) {
    setEditId(h.id); setEditDate(h.date); setEditName(h.name); setConfirmDeleteId(null);
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    try {
      const row = await updatePublicHoliday(id, { date: editDate, name: editName });
      setHolidays((p) => p.map((h) => (h.id === id ? row : h)).sort(byDate));
      setYear(parseInt(row.date.slice(0, 4), 10));
      setEditId(null);
      toast.success("Holiday updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the holiday");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await deletePublicHoliday(id);
      setHolidays((p) => p.filter((h) => h.id !== id));
      setConfirmDeleteId(null);
      toast.success("Holiday deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the holiday");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <PageHeader
        title="Public Holidays"
        description="The company's public holiday calendar. A case that falls on one of these dates earns the holiday allowance rate."
      />

      {canCreate && (
        <div className="rounded-xl border border-border p-4 space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <CalendarDaysIcon className="w-3.5 h-3.5" /> Add a holiday
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={dateInput} />
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Holiday name, e.g. Deepavali" className="h-8 text-sm flex-1 min-w-48"
              onKeyDown={(e) => { if (e.key === "Enter" && newDate && newName.trim() && !adding) add(); }} />
            <Button size="sm" className="h-8 gap-1.5" disabled={adding || !newDate || !newName.trim()} onClick={add}>
              {adding ? <Spinner className="size-3.5" /> : <PlusIcon className="w-3.5 h-3.5" />} Add
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">{shown.length} holiday{shown.length === 1 ? "" : "s"} in {year}</span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-border py-12 text-center text-sm text-muted-foreground">
          No public holidays listed for {year}.{canCreate ? " Add one above." : ""}
        </div>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-border/60">
          {shown.map((h) => {
            const editing = editId === h.id;
            const busy = busyId === h.id;
            return (
              <div key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                {editing ? (
                  <>
                    <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className={dateInput} disabled={busy} />
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm flex-1 min-w-40" disabled={busy} />
                    <Button size="sm" className="h-8 gap-1" disabled={busy || !editDate || !editName.trim()} onClick={() => saveEdit(h.id)}>
                      {busy ? <Spinner className="size-3.5" /> : <CheckIcon className="w-3.5 h-3.5" />} Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 gap-1" disabled={busy} onClick={() => setEditId(null)}><XIcon className="w-3.5 h-3.5" /> Cancel</Button>
                  </>
                ) : (
                  <>
                    <div className="w-36 shrink-0">
                      <div className="font-medium tabular-nums">{fmtDate(h.date)}</div>
                      <div className="text-[11px] text-muted-foreground">{weekday(h.date)}</div>
                    </div>
                    <span className="flex-1 min-w-0 truncate">{h.name}</span>
                    {confirmDeleteId === h.id ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Delete this holiday?</span>
                        <Button size="sm" variant="destructive" className="h-7" disabled={busy} onClick={() => remove(h.id)}>
                          {busy && <Spinner className="size-3.5 mr-1" />}Delete
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setConfirmDeleteId(null)}>Keep</Button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        {canUpdate && <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => startEdit(h)}><PencilIcon className="w-3.5 h-3.5" /></Button>}
                        {canDelete && <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => { setConfirmDeleteId(h.id); setEditId(null); }}><Trash2Icon className="w-3.5 h-3.5" /></Button>}
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!canCreate && !canUpdate && !canDelete && (
        <p className="text-xs text-muted-foreground">You can view the calendar. Ask an administrator if you need to change it.</p>
      )}
    </div>
  );
}
