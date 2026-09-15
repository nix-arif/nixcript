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

// Status of a single physical unit in the asset_unit ledger (opt-in per
// product via product.requiresSerialTracking).
export const ASSET_UNIT_STATUS = {
  IN_STOCK:  "IN_STOCK",   // sitting in a physical warehouse (Default/Demo)
  WITH_REP:  "WITH_REP",   // transferred to a rep's field-stock holding
  ON_LOAN:   "ON_LOAN",    // loaned out during a case, at a customer site
  SOLD:      "SOLD",       // sold outright, terminal
  IN_REPAIR: "IN_REPAIR",
  DISPOSED:  "DISPOSED",   // terminal
} as const;

export const ASSET_UNIT_STATUS_LABELS: Record<string, string> = {
  IN_STOCK:  "In Stock",
  WITH_REP:  "With Rep",
  ON_LOAN:   "On Loan (Case)",
  SOLD:      "Sold",
  IN_REPAIR: "In Repair",
  DISPOSED:  "Disposed",
};
