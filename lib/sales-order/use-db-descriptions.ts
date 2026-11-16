"use client";

// Keeps the description of each sales order item in step with the product database.
//
// The reference product is found by Design Code for an OEM item (the design code is the product code of
// the catalogue product the item is made like), otherwise by the item's own Code. The database description
// is stored on the item as `_dbDescription` so the user can revert to it. Typing a design code or switching
// Trading/OEM changes the reference, and the description follows as long as the user has not customised it.
import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getProductsByCode } from "@/server/inventory";

import { mergeDbDescriptions, refOf, type DbDescItem } from "@/lib/sales-order/db-description";

export { refOf };
export type { DbDescItem };

export function useDbDescriptions<T extends DbDescItem>(
  items: T[],
  setItems: Dispatch<SetStateAction<T[]>>,
  opts: { showSourcing: boolean; /** create page: take the database description on load. edit page: only keep it for reverting. */ syncOnLoad: boolean },
) {
  const { showSourcing, syncOnLoad } = opts;
  useEffect(() => {
    const todo = items.filter((i) => {
      const r = refOf(i, showSourcing);
      return r && i._dbRef !== r;
    });
    if (todo.length === 0) return;
    let cancelled = false;
    // a short wait, so typing a design code does not look up every keystroke
    const t = setTimeout(async () => {
      const codes = [...new Set(todo.map((i) => refOf(i, showSourcing)))];
      const products = await getProductsByCode(codes).catch(() => [] as { productCode: string; description: string | null }[]);
      if (cancelled) return;
      const byCode = new Map(products.map((p) => [p.productCode.trim().toLowerCase(), (p.description ?? "").trim()]));
      setItems((prev) => mergeDbDescriptions(prev, codes, byCode, { showSourcing, syncOnLoad }));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [items, setItems, showSourcing, syncOnLoad]);
}
