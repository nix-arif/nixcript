// What stops a Submit on a sourcing business: used by the checks and by the item tables' markers.

type SourcingRow = {
  rowNo: number;
  description?: string | null; productCode?: string | null; sourcingType?: string | null;
  designBrandName?: string | null; designBrandCode?: string | null; privateLabelCode?: string | null;
};

export const needsSourcing = (i: SourcingRow) => !!(i.description || i.productCode) && !i.sourcingType;
export const missingOemDetails = (i: SourcingRow) =>
  i.sourcingType === "oem" && (!i.designBrandName?.trim() || !i.designBrandCode?.trim() || !i.privateLabelCode?.trim());

/** Every row that stops the Submit, with one message naming them all; null when none does. */
export function sourcingProblems<T extends SourcingRow>(items: T[]): { rows: T[]; message: string } | null {
  const noSourcing = items.filter(needsSourcing);
  const noOemDetails = items.filter(missingOemDetails);
  if (noSourcing.length + noOemDetails.length === 0) return null;
  const named = (list: T[]) => `row${list.length > 1 ? "s" : ""} ${list.map((i) => i.rowNo).sort((x, y) => x - y).join(", ")}`;
  return {
    rows: [...noSourcing, ...noOemDetails],
    message: [
      noSourcing.length > 0 && `Please select Trading or OEM sourcing for ${named(noSourcing)}.`,
      noOemDetails.length > 0 && `Please fill in Design Brand, Design Code and Emboss Code for ${named(noOemDetails)}.`,
    ].filter(Boolean).join(" "),
  };
}
