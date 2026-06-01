export const CLAIM_FORM = {
  LOCAL: "LOCAL",
  OVERSEAS: "OVERSEAS",
  ENTERTAINMENT_FORM: "ENTERTAINMENT_FORM",
} as const;

export type ClaimFormType = (typeof CLAIM_FORM)[keyof typeof CLAIM_FORM];

export const LINE_CATEGORY = {
  // 1.1 Travel — mileage
  TRAVEL: "TRAVEL",
  // 1.1 Travel — associated items (stored as sibling line items per trip)
  TRAVEL_DAILY_ALLOWANCE:  "TRAVEL_DAILY_ALLOWANCE",
  TRAVEL_ACCOMMODATION:    "TRAVEL_ACCOMMODATION",
  TRAVEL_CASE_ALLOWANCE:   "TRAVEL_CASE_ALLOWANCE",
  TRAVEL_ENTERTAINMENT:    "TRAVEL_ENTERTAINMENT",
  // 1.2 Misc
  TOLL: "TOLL",
  PARKING: "PARKING",
  MOBILE: "MOBILE",
  // 1.3 In-base entertainment
  IN_BASE_ENT: "IN_BASE_ENT",
  // 1.4 Other
  OTHER_LOCAL: "OTHER_LOCAL",
  // 1.5 Outstation hotel
  OUTSTATION_HOTEL: "OUTSTATION_HOTEL",
  // 2.x Overseas
  OVERSEAS_MYR: "OVERSEAS_MYR",
  OVERSEAS_FX: "OVERSEAS_FX",
  OVERSEAS_OTHER: "OVERSEAS_OTHER",
} as const;

export const TRAVEL_MODE = {
  OWN_VEHICLE: "OWN_VEHICLE",
  FLIGHT:      "FLIGHT",
  CAR_POOL:    "CAR_POOL",
  COMPANY_CAR: "COMPANY_CAR",
} as const;

export const TRAVEL_MODE_LABELS: Record<string, string> = {
  OWN_VEHICLE: "Own Vehicle",
  FLIGHT:      "Flight",
  CAR_POOL:    "Car Pool",
  COMPANY_CAR: "Company Car",
};

export type LineCategoryType = (typeof LINE_CATEGORY)[keyof typeof LINE_CATEGORY];
