// Shared permission grouping for admin UIs (Access Control, Default
// Permissions) that present ALL_PERMISSIONS as labeled sections rather than
// one flat list.

export const KEY_GROUP: Record<string, string> = {
  "quotation:read": "sales", "quotation:create": "sales", "quotation:update": "sales", "quotation:delete": "sales",
  "sales-order:read": "sales", "sales-order:create": "sales", "sales-order:update": "sales", "sales-order:delete": "sales",
  "sales-order:read:centralized": "sales", "sales-order:update:centralized": "sales",
  "customer-po:read": "sales", "customer-po:create": "sales", "customer-po:update": "sales", "customer-po:delete": "sales",
  "customer-po:read:centralized": "sales", "customer-po:update:centralized": "sales",
  "customer:read": "sales", "customer:create": "sales", "customer:update": "sales", "customer:delete": "sales",

  "purchase-requisition:read": "procurement", "purchase-requisition:create": "procurement",
  "purchase-requisition:update": "procurement", "purchase-requisition:delete": "procurement",
  "purchase-order:read": "procurement", "purchase-order:create": "procurement",
  "purchase-order:update": "procurement", "purchase-order:delete": "procurement",
  "purchase-order:read:centralized": "procurement", "purchase-order:update:centralized": "procurement",
  "goods-receipt:create": "procurement", "goods-receipt:read:centralized": "procurement",
  "packing-list:create": "procurement", "packing-list:inspect": "procurement",
  "packing-list:read:centralized": "procurement", "packing-list:inspect:centralized": "procurement",
  "supplier:read": "procurement", "supplier:create": "procurement", "supplier:update": "procurement", "supplier:delete": "procurement",

  "delivery-order:read": "fulfillment", "delivery-order:create": "fulfillment",
  "delivery-order:update": "fulfillment", "delivery-order:delete": "fulfillment",
  "invoice:read": "fulfillment", "invoice:create": "fulfillment",
  "invoice:update": "fulfillment", "invoice:delete": "fulfillment",
  "account:read": "fulfillment", "account:create": "fulfillment",
  "account:update": "fulfillment", "account:delete": "fulfillment",
  "accounts-receivable:read": "fulfillment", "accounts-receivable:create": "fulfillment",

  "product:read": "products", "product:seed": "products",
  "product:update-price": "products", "product:upload-image": "products",

  "inventory:read": "inventory", "inventory:adjust": "inventory",
  "inventory:manage": "inventory", "inventory:request": "inventory",

  "leave:read:own": "hr", "leave:read:all": "hr", "leave:apply": "hr", "leave:manage": "hr",
  "claim:read:own": "hr", "claim:apply": "hr", "claim:manage": "hr", "claim:read:all": "hr",
  "travel:read:own": "hr", "travel:apply": "hr", "travel:manage": "hr", "travel:read:all": "hr",
  "payslip:read:own": "hr", "payslip:read:all": "hr", "payslip:create": "hr",
  "profile:read": "hr", "profile:update": "hr", "profile:read:all": "hr", "profile:update:all": "hr", "profile:delete:all": "hr",

  "member:read": "org", "member:invite": "org", "member:remove": "org",
  "department:read": "org", "department:create": "org", "department:delete": "org",
  "organization-profile:read": "org", "organization-profile:create": "org",
  "organization-profile:update": "org", "organization-profile:delete": "org",
  "organization-role:create": "org", "organization-role:update": "org", "organization-role:delete": "org",
  "permission:read": "org", "permission:create": "org", "permission:update": "org", "permission:delete": "org",
};

export const GROUP_DEFS: { id: string; label: string }[] = [
  { id: "sales", label: "Sales & CRM" },
  { id: "procurement", label: "Procurement" },
  { id: "fulfillment", label: "Fulfillment & Finance" },
  { id: "products", label: "Products" },
  { id: "inventory", label: "Inventory" },
  { id: "hr", label: "HR & People" },
  { id: "org", label: "Organization & Admin" },
];
