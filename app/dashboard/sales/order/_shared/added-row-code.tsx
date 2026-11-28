"use client";

// The Code cell of a row added on the sales order (Add row): typed in, then looked up in the product
// list when the cell is left — the row gets the product (its id: stock is checked and reserved for it),
// its description (when the row has none yet), UOM, sourcing and design / emboss codes. A code not in
// the product list stays as typed, with no product. Rows from the quotation keep their code fixed.

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { getProductsByCode } from "@/server/inventory";

export type AddedRowProduct = {
  id: string;
  productCode: string;
  description: string | null;
  uom: string | null;
  sourcingType: "trading" | "oem" | null;
  designBrandName: string | null;
  designBrandCode: string | null;
  privateLabelCode: string | null;
};

export function AddedRowCodeInput({ value, onChange, onResolved, dataRow, dataCol, onKeyDown }: {
  value: string;
  onChange: (code: string) => void;
  /** after the lookup: the product, or null when the code isn't in the product list */
  onResolved: (product: AddedRowProduct | null, code: string) => void;
  dataRow?: number;
  dataCol?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [looked, setLooked] = useState(value.trim());

  async function lookUp() {
    const code = value.trim();
    if (!code || code === looked) return;
    setLooked(code);
    setBusy(true);
    try {
      const found = await getProductsByCode([...new Set([code, code.toUpperCase()])]);
      const p = found.find((x) => x.productCode === code) ?? found.find((x) => x.productCode.toUpperCase() === code.toUpperCase());
      if (!p) toast.warning(`${code} is not in the product list: the row keeps it as typed, with no product (no stock check).`, { duration: 7000 });
      onResolved(p ? {
        ...p,
        sourcingType: p.sourcingType === "trading" || p.sourcingType === "oem" ? p.sourcingType : null,
      } : null, code);
    } catch {
      onResolved(null, code); // no permission to read products: keep the code as typed
    } finally {
      setBusy(false);
    }
  }

  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={lookUp}
      onKeyDown={(e) => { if (e.key === "Enter") lookUp(); onKeyDown?.(e); }}
      placeholder="Code"
      data-row={dataRow}
      data-col={dataCol}
      className={`h-7 font-mono text-[11px] md:text-[11px] ${busy ? "opacity-60" : ""}`}
    />
  );
}
