export const MOVEMENT_TYPE = {
  OPENING:       "OPENING",
  STOCK_IN:      "STOCK_IN",
  STOCK_OUT:     "STOCK_OUT",
  ADJUSTMENT:    "ADJUSTMENT",
  RETURN:        "RETURN",
  TRANSFER:      "TRANSFER",
  CONSIGN_OUT:   "CONSIGN_OUT",    // stock sent to customer on consignment
  CONSIGN_RETURN:"CONSIGN_RETURN", // consignment stock returned to warehouse
  FIELD_OUT:     "FIELD_OUT",      // warehouse → field rep's holding
  FIELD_RETURN:  "FIELD_RETURN",   // field rep → warehouse
  CASE_USE:      "CASE_USE",       // rep field stock consumed during a case
  LOAN_OUT:      "LOAN_OUT",       // rental machine sent out for a case
  LOAN_RETURN:   "LOAN_RETURN",    // rental machine returned from a case
  // Consignment module (lib/consignment/labels.ts) — stock stays on the owner's books
  CONSIGN_SEND:   "CONSIGN_SEND",   // owner warehouse → consignment location
  CONSIGN_USE:    "CONSIGN_USE",    // consumed at a consignment location (ownership passes)
  CONSIGN_BACK:   "CONSIGN_BACK",   // consignment location → owner warehouse
  CONSIGN_ADJUST: "CONSIGN_ADJUST", // count correction at a consignment location
  CONSIGN_REVERSE:"CONSIGN_REVERSE",
  CONSIGN_MOVE:   "CONSIGN_MOVE",   // agent moves consigned stock between its own locations (warehouse ⇄ specialist), still the owner's// a consumption undone (Case DO deleted/returned) — stock back at the location
} as const;

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING:        "Opening Balance",
  STOCK_IN:       "Stock In",
  STOCK_OUT:      "Stock Out",
  ADJUSTMENT:     "Adjustment",
  RETURN:         "Return",
  TRANSFER:       "Transfer",
  CONSIGN_OUT:    "Consignment Out",
  CONSIGN_RETURN: "Consignment Return",
  FIELD_OUT:      "Field Transfer Out",
  FIELD_RETURN:   "Field Return",
  CASE_USE:       "Case Usage",
  LOAN_OUT:       "Loan Out",
  LOAN_RETURN:    "Loan Return",
  CONSIGN_SEND:   "Consignment Sent",
  CONSIGN_USE:    "Consignment Used",
  CONSIGN_BACK:   "Consignment Returned",
  CONSIGN_ADJUST: "Consignment Adjustment",
  CONSIGN_REVERSE: "Consignment Use Reversed",
  CONSIGN_MOVE:   "Consignment Moved",
};

export const REF_TYPE = {
  MANUAL:               "MANUAL",
  PURCHASE_ORDER:       "PURCHASE_ORDER",
  PURCHASE_REQUISITION: "PURCHASE_REQUISITION",
  SALES_ORDER:          "SALES_ORDER",
  DELIVERY_ORDER:       "DELIVERY_ORDER",
  CONSIGNMENT:          "CONSIGNMENT",
  FIELD_TRANSFER:       "FIELD_TRANSFER",
  CASE:                 "CASE",
} as const;

export const fieldWarehouseLabel = (repId: string) => `Field:${repId}`;

// Consignment ownership is encoded in the warehouse label itself, the same
// trick fieldWarehouseLabel already uses — no schema change, and every
// existing stockLevel/stockMovement consumer keeps working unmodified for
// normal (non-consigned) stock since it's just another label string.
// "Consigned:<sourceOrgId>" = at this org's own main warehouse, still owned
// by sourceOrgId. "Field:<repId>:Consigned:<sourceOrgId>" = with that rep,
// still owned by sourceOrgId.
export const consignedWarehouseLabel = (sourceOrgId: string) => `Consigned:${sourceOrgId}`;
export const consignedFieldWarehouseLabel = (repId: string, sourceOrgId: string) => `Field:${repId}:Consigned:${sourceOrgId}`;
// True for both the plain field label and its consigned variant.
export const isFieldWarehouseLabel = (label: string) => label.startsWith("Field:");

// Status of a single physical unit in the asset_unit ledger (opt-in per
// product via product.requiresSerialTracking).
export const ASSET_UNIT_STATUS = {
  IN_STOCK:  "IN_STOCK",   // sitting in a physical warehouse (Default/Demo)
  WITH_REP:  "WITH_REP",   // transferred to a rep's field-stock holding
  ON_LOAN:   "ON_LOAN",    // loaned out during a case, at a customer site
  SOLD:      "SOLD",       // sold outright, terminal
  IN_REPAIR: "IN_REPAIR",
  DISPOSED:  "DISPOSED",   // terminal
  CONSIGNED: "CONSIGNED",  // placed at an agent's warehouse or a customer site, still the owner's (consignment module)
} as const;

// Fixed when a unit enters inventory (registration, or later Goods
// Receipt) — NOT chosen by whoever creates the Case DO. The DO reads this
// off the unit to decide CASE_USE (SALE) vs LOAN_OUT (RENTAL).
// What a serialized unit IS — fixed when it is registered:
//   SALE  — stock to sell; used up / sold on a Case DO
//   ASSET — a company asset (machine / equipment): never sold through a case,
//           it is lent out and comes back, and stays the organisation's
// Why an asset is out (rental / loan / demo) is NOT a property of the unit —
// it is chosen each time it goes out (LOAN_PURPOSE, on the Case DO / usage).
export const INTENDED_USE = {
  SALE:  "SALE",
  ASSET: "ASSET",
} as const;

export const INTENDED_USE_LABELS: Record<string, string> = {
  SALE:  "For sale",
  ASSET: "Company asset",
};

// Older units were registered as RENTAL / LOAN / DEMO — all company assets now
export const LENDABLE_USES = ["ASSET", "RENTAL", "LOAN", "DEMO"] as const;
export const isLendable = (use: string | null | undefined) => !!use && use !== "SALE";
export const unitUseLabel = (use: string | null | undefined) => (isLendable(use) ? INTENDED_USE_LABELS.ASSET : INTENDED_USE_LABELS.SALE);

// Why a company asset is out on a given occasion
export const LOAN_PURPOSE = {
  RENTAL: "RENTAL", // hired out — usually charged a usage fee
  LOAN:   "LOAN",   // lent, e.g. while the customer's own machine is repaired
  DEMO:   "DEMO",   // demonstration / trial
} as const;
export const LOAN_PURPOSE_LABELS: Record<string, string> = { RENTAL: "Rental", LOAN: "Loan", DEMO: "Demo" };

export const ASSET_UNIT_STATUS_LABELS: Record<string, string> = {
  IN_STOCK:  "In Stock",
  WITH_REP:  "With Rep",
  ON_LOAN:   "On Loan (Case)",
  SOLD:      "Sold",
  IN_REPAIR: "In Repair",
  DISPOSED:  "Disposed",
};
