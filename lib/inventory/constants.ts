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
