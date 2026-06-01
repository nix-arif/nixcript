export const MOVEMENT_TYPE = {
  OPENING:    "OPENING",
  STOCK_IN:   "STOCK_IN",
  STOCK_OUT:  "STOCK_OUT",
  ADJUSTMENT: "ADJUSTMENT",
  RETURN:     "RETURN",
} as const;

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING:    "Opening Balance",
  STOCK_IN:   "Stock In",
  STOCK_OUT:  "Stock Out",
  ADJUSTMENT: "Adjustment",
  RETURN:     "Return",
};

export const REF_TYPE = {
  MANUAL:         "MANUAL",
  PURCHASE_ORDER: "PURCHASE_ORDER",
  SALES_ORDER:    "SALES_ORDER",
  DELIVERY_ORDER: "DELIVERY_ORDER",
} as const;
