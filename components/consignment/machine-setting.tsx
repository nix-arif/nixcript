"use client";

import { Input } from "@/components/ui/input";

export type MachineMethod = "free" | "per_case" | "share_of_fee" | "monthly_rental" | "hospital_fee";
export interface MachineSettingValue { machineMethod: MachineMethod; machineFee: string; machineSharePct: string; machineCommission?: boolean }

/**
 * How the owner charges for its machines (rental units) placed with a
 * consignee. A machine is never sold through consignment — it is used on
 * cases and stays the owner's — so it is charged per case, as a share of
 * the usage fee, by the month, or not at all.
 */
export function MachineSetting({ kind, owner, consignee, value, onChange, disabled, name }: {
  kind: "agent" | "dealer" | "sales_agent"; owner: string; consignee: string;
  value: MachineSettingValue; onChange: (v: MachineSettingValue) => void; disabled?: boolean; name: string;
}) {
  const options: [MachineMethod, string, string][] = kind === "sales_agent"
    ? [
        ["free", "No charge", "Machines are lent for cases free of charge."],
        ["hospital_fee", "Invoice the hospital per case", `When ${consignee} records a case, ${owner} invoices the hospital the usage fee entered for it.`],
      ]
    : [
        ["free", "No charge", `${consignee} uses ${owner}'s machines on cases for free.`],
        ["per_case", "Fixed fee per case", `${owner} charges ${consignee} a set amount every time a machine is used on a case.`],
        ["share_of_fee", "Share of the usage fee", `${owner} takes a % of the usage fee ${consignee} charged the hospital. No fee charged → nothing to share.`],
        ["monthly_rental", "Monthly rental", `${owner} charges a set amount per machine for every month ${consignee} holds it, however often it is used.`],
      ];
  const set = (patch: Partial<MachineSettingValue>) => onChange({ ...value, ...patch });
  return (
    <div>
      <div className="text-xs font-medium mb-1.5">Machines (rental units)</div>
      <p className="text-[11px] text-muted-foreground mb-2">Machines are lent for cases and come back — never sold through consignment. How {owner} charges for them:</p>
      <div className="space-y-1.5">
        {options.map(([v, label, hint]) => (
          <label key={v} className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name={name} checked={value.machineMethod === v} onChange={() => set({ machineMethod: v })} disabled={disabled} className="mt-1" />
            <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
          </label>
        ))}
      </div>
      {(value.machineMethod === "per_case" || value.machineMethod === "monthly_rental") && (
        <label className="flex items-center gap-2 text-sm mt-2">RM
          <Input type="number" min="0" step="0.01" value={value.machineFee} onChange={(e) => set({ machineFee: e.target.value })} disabled={disabled} className="h-8 w-28 text-sm bg-background" />
          {value.machineMethod === "per_case" ? "per case" : "per machine per month"}
        </label>
      )}
      {value.machineMethod === "share_of_fee" && (
        <label className="flex items-center gap-2 text-sm mt-2">Share
          <Input type="number" min="0" max="100" step="0.5" value={value.machineSharePct} onChange={(e) => set({ machineSharePct: e.target.value })} disabled={disabled} className="h-8 w-24 text-sm bg-background" />
          % of the usage fee to {owner}
        </label>
      )}
      {value.machineMethod === "hospital_fee" && (
        <label className="flex items-center gap-2 text-sm mt-2">
          <input type="checkbox" checked={value.machineCommission ?? true} onChange={(e) => set({ machineCommission: e.target.checked })} disabled={disabled} />
          Pay {consignee} commission on machine usage fees too
        </label>
      )}
    </div>
  );
}
