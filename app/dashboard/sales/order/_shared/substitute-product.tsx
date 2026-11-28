"use client";

// "Substitute" under the code of a quotation / customer PO row: type the code of the product supplied in
// its place. Only a code in the product list is accepted (its stock is checked and reserved).

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { getProductsByCode } from "@/server/inventory";
import { differingUnit, type SubstituteProduct } from "@/lib/sales-order/substitute";

export function SubstituteProductAction({ rowNo, currentCode, currentUom, substitutedFromCode, onSubstitute }: {
  rowNo: number;
  currentCode: string;
  /** the agreed unit, which the row keeps */
  currentUom?: string | null;
  substitutedFromCode?: string | null;
  onSubstitute: (product: SubstituteProduct) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply(typed: string) {
    const wanted = typed.trim();
    if (!wanted || busy) return;
    if (wanted.toLowerCase() === currentCode.trim().toLowerCase()) { toast.error(`Row ${rowNo} already has ${currentCode}.`); return; }
    setBusy(true);
    try {
      const found = await getProductsByCode([...new Set([wanted, wanted.toUpperCase()])]);
      const p = found.find((x) => x.productCode === wanted) ?? found.find((x) => x.productCode.toUpperCase() === wanted.toUpperCase());
      if (!p) { toast.error(`${wanted} is not in the product list. A substitute must be a listed product.`); return; }
      onSubstitute({ ...p, sourcingType: p.sourcingType === "trading" || p.sourcingType === "oem" ? p.sourcingType : null });
      toast.success(`Row ${rowNo}: ${p.productCode} in place of ${substitutedFromCode || currentCode}. Quantity, unit and price are unchanged.`);
      const unit = differingUnit({ uom: currentUom }, p);
      if (unit) toast.warning(`Row ${rowNo}: ${p.productCode} is listed per "${unit}", but the row keeps the agreed unit "${currentUom}". Check that the quantity and price still hold.`, { duration: 12000 });
      setOpen(false);
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't look up the product");
    } finally {
      setBusy(false);
    }
  }

  const link = "text-[0.625rem] underline underline-offset-2 text-muted-foreground hover:text-foreground disabled:opacity-50";
  return (
    <div className="mt-0.5 flex flex-col items-start gap-0.5">
      {substitutedFromCode && (
        <span className="text-[0.625rem] rounded border border-amber-300 bg-amber-50 px-1 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          in place of {substitutedFromCode}
        </span>
      )}
      {open ? (
        <div className="flex flex-col gap-0.5">
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void apply(code); }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="New code"
            aria-label={`Substitute product code for row ${rowNo}`}
            className="h-7 w-24 font-mono text-[11px] md:text-[11px]"
          />
          <div className="flex gap-2">
            <button type="button" className={link} disabled={busy || !code.trim()} onClick={() => void apply(code)}>{busy ? "Checking…" : "Apply"}</button>
            <button type="button" className={link} onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" className={link} aria-label={`Substitute the product on row ${rowNo}`} onClick={() => setOpen(true)}>Substitute</button>
          {substitutedFromCode && (
            <button type="button" className={link} disabled={busy} onClick={() => void apply(substitutedFromCode)}>Undo</button>
          )}
        </div>
      )}
    </div>
  );
}
