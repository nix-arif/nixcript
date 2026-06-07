export const MOVEMENT_TYPE = {
  OPENING:       "OPENING",
  STOCK_IN:      "STOCK_IN",
  STOCK_OUT:     "STOCK_OUT",
  ADJUSTMENT:    "ADJUSTMENT",
  RETURN:        "RETURN",
  TRANSFER:      "TRANSFER",
  CONSIGN_OUT:   "CONSIGN_OUT",   // stock sent to customer on consignment
  CONSIGN_RETURN:"CONSIGN_RETURN",// consignment stock returned to warehouse
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
};

export const REF_TYPE = {
  MANUAL:         "MANUAL",
  PURCHASE_ORDER: "PURCHASE_ORDER",
  SALES_ORDER:    "SALES_ORDER",
  DELIVERY_ORDER: "DELIVERY_ORDER",
  CONSIGNMENT:    "CONSIGNMENT",
} as const;
