"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EyeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { applyPdfSettingsToAll, savePayslipPdfSettings } from "@/server/payslip-pdf-settings";
import type { PayslipPdfSettings } from "@/lib/payroll/pdf-settings";
import { generatePayslipPdf, samplePayslipData } from "../payslips/generate-payslip-pdf";

type BoolKey = Exclude<keyof PayslipPdfSettings, "footerNote">;

const GROUPS: { title: string; hint: string; items: { key: BoolKey; label: string; hint: string }[] }[] = [
  {
    title: "Year to date (YTD)",
    hint: "Running totals from January up to and including this month. Published payslips and the one being printed are counted.",
    items: [
      { key: "ytdEarnings", label: "YTD on earnings", hint: "Shown under Gross pay in the Earnings column" },
      { key: "ytdDeductions", label: "YTD on employee deductions", hint: "Shown under EPF, SOCSO, EIS, PCB / LHDN and Total deductions" },
      { key: "ytdEmployer", label: "YTD on employer contributions", hint: "Shown under the employer EPF, SOCSO and EIS" },
      { key: "ytdSummary", label: "YTD net pay and gross pay", hint: "Bottom block beside the net pay. Also adds YTD taxable income to the tax summary" },
    ],
  },
  {
    title: "Sections",
    hint: "",
    items: [
      { key: "showTaxSummary", label: "Tax summary (taxable income)", hint: "Gross income, the part that is not taxable, and the taxable income PCB is based on (before tax relief)" },
      { key: "showEmployer", label: "Employer contributions", hint: "EPF, SOCSO and EIS paid by the company (not deducted)" },
      { key: "showEmployeeIds", label: "Employee IDs", hint: "IC, EPF, SOCSO and tax numbers" },
      { key: "showBank", label: "Bank details", hint: "Where the salary is paid to" },
    ],
  },
];

export function PdfPanel({ initial, siblingOrgs }: { initial: PayslipPdfSettings; siblingOrgs: { id: string; name: string }[] }) {
  const hasSiblings = siblingOrgs.length > 0;
  const [applying, setApplying] = useState(false);
  const applyNow = async () => {
    const names = siblingOrgs.map((o) => o.name).join(", ");
    if (!confirm(`Replace the payslip PDF settings of ${names} with the saved settings here?`)) return;
    setApplying(true);
    try {
      const n = await applyPdfSettingsToAll();
      toast.success(`Applied to ${n} other organization${n === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply");
    } finally {
      setApplying(false);
    }
  };

  const [saved, setSaved] = useState(initial);
  const [cfg, setCfg] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  const save = async () => {
    setSaving(true);
    try {
      const s = await savePayslipPdfSettings(cfg);
      setSaved(s);
      setCfg(s);
      toast.success("Payslip PDF settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const preview = async () => {
    setPreviewing(true);
    try {
      await generatePayslipPdf(samplePayslipData(cfg), { output: "open" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the preview");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-w-xl">
          Choose what appears on the payslip PDF that HR and employees download. The preview uses sample
          data and your unsaved choices.
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={preview} disabled={previewing}>
          {previewing ? <Spinner className="size-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />} Preview PDF
        </Button>
      </div>

      {hasSiblings && (
        <div className="rounded-xl border border-border p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Apply to all group of companies</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Replace the payslip PDF settings of {siblingOrgs.map((o) => o.name).join(", ")} (same owner) with the saved settings here.
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5" disabled={applying || dirty} onClick={applyNow} title={dirty ? "Save your changes first" : undefined}>
            {applying && <Spinner className="size-3.5" />} Apply to all
          </Button>
        </div>
      )}

      {GROUPS.map((g) => (
        <section key={g.title} className="rounded-xl border border-border">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">{g.title}</h3>
            {g.hint && <p className="text-xs text-muted-foreground mt-0.5">{g.hint}</p>}
          </div>
          {g.items.map((it) => (
            <label key={it.key} className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border last:border-0 cursor-pointer">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{it.label}</span>
                <span className="block text-xs text-muted-foreground">{it.hint}</span>
              </span>
              <Switch checked={cfg[it.key]} onCheckedChange={(v) => setCfg({ ...cfg, [it.key]: v })} />
            </label>
          ))}
        </section>
      ))}

      <section className="rounded-xl border border-border px-4 py-3 space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Footer note</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Optional line printed at the bottom of every page, e.g. a confidentiality notice.</p>
        </div>
        <textarea
          value={cfg.footerNote}
          maxLength={200}
          rows={2}
          onChange={(e) => setCfg({ ...cfg, footerNote: e.target.value })}
          placeholder="This payslip is private and confidential."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="text-right text-[11px] text-muted-foreground">{cfg.footerNote.length}/200</div>
      </section>

      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
        {dirty && <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>}
        <Button variant="outline" disabled={!dirty || saving} onClick={() => setCfg(saved)}>Discard</Button>
        <Button disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</Button>
      </div>
    </div>
  );
}
