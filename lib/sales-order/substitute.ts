// A substitute product on a sales order line taken from a quotation or customer PO: another product is
// supplied in its place. The line keeps what was agreed (quantity, unit, price, discount, set, customer PO
// and quotation links) and records the original code (substitutedFromCode), which amendments match it by.

export type SubstituteProduct = {
  id: string;
  productCode: string;
  description: string | null;
  uom: string | null;
  sourcingType: "trading" | "oem" | null;
  designBrandName: string | null;
  designBrandCode: string | null;
  privateLabelCode: string | null;
};

type Line = {
  productCode?: string | null;
  uom?: string | null;
  sourcingType?: "trading" | "oem" | null;
  privateLabelCode?: string | null;
  substitutedFromCode?: string | null;
  _privateLabelSource?: "auto" | "user" | null;
};

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** The product's unit when it isn't the line's agreed one (which the line keeps), so the user can be told. */
export function differingUnit(line: Pick<Line, "uom">, product: Pick<SubstituteProduct, "uom">): string | null {
  return line.uom?.trim() && product.uom?.trim() && !same(line.uom, product.uom) ? product.uom.trim() : null;
}

/** The changes that put `product` on the line, made by `userName`. */
export function substitutePatch(line: Line, product: SubstituteProduct, userName: string) {
  // the first original is the one kept; going back to it removes the record
  const original = line.substitutedFromCode || line.productCode || "";
  const sourcingType = product.sourcingType ?? line.sourcingType ?? null;
  // an Emboss Code typed by someone stays; one that followed the code follows the new product
  const keepEmboss = line._privateLabelSource === "user" && !!line.privateLabelCode?.trim();
  const emboss = sourcingType !== "oem" ? "" : keepEmboss ? line.privateLabelCode! : product.privateLabelCode?.trim() || product.productCode;
  const description = (product.description ?? "").toUpperCase();
  return {
    productId: product.id,
    productCode: product.productCode,
    substitutedFromCode: same(original, product.productCode) ? null : original,
    description,
    uom: line.uom?.trim() || product.uom || "", // the agreed unit; the product's only when the line had none
    sourcingType,
    designBrandName: product.designBrandName ?? "",
    designBrandCode: product.designBrandCode ?? "",
    privateLabelCode: emboss,
    _privateLabelSource: sourcingType !== "oem" ? null : keepEmboss ? ("user" as const) : ("auto" as const),
    _designBrandSource: product.designBrandName ? ("catalog" as const) : null,
    _codeSource: ["so" as const],
    _descriptionSource: ["so" as const, "catalog" as const],
    _dbDescription: description,
    _dbRef: undefined,
    _soEditedBy: userName || "user",
  };
}
