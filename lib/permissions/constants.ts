// lib/permissions/constants.ts

// ── All permission keys ────────────────────────────────────────────────────

export const ALL_PERMISSIONS = [
  // Quotation
  { key: "quotation:read",   label: "View Quotations" },
  { key: "quotation:create", label: "Create Quotation" },
  { key: "quotation:update", label: "Update Quotation" },
  { key: "quotation:delete", label: "Delete Quotation" },

  // Sales Order
  { key: "sales-order:read",   label: "View Sales Orders" },
  { key: "sales-order:create", label: "Create Sales Order" },
  { key: "sales-order:update", label: "Update Sales Order" },
  { key: "sales-order:delete", label: "Delete Sales Order" },
  { key: "sales-order:read:centralized", label: "View All Sales Orders Across Owner's Organizations" },
  { key: "sales-order:update:centralized", label: "Edit Sales Orders Across Owner's Organizations" },

  // Customer PO
  { key: "customer-po:read",   label: "View Customer POs" },
  { key: "customer-po:create", label: "Create Customer PO" },
  { key: "customer-po:update", label: "Update Customer PO" },
  { key: "customer-po:delete", label: "Delete Customer PO" },
  { key: "customer-po:read:centralized", label: "View All Customer POs Across Owner's Organizations" },
  { key: "customer-po:update:centralized", label: "Edit Customer POs Across Owner's Organizations" },

  // Delivery Order
  { key: "delivery-order:read",   label: "View Delivery Orders" },
  { key: "delivery-order:create", label: "Create Delivery Order (incl. Case DO & case templates)" },
  { key: "delivery-order:update", label: "Update Delivery Order (record actual items, deliver, returns)" },
  { key: "delivery-order:delete", label: "Delete Draft Delivery Order" },
  // Case DO internal copy: every item actually deducted, MDA problems and what
  // the customer copy shows instead — an internal stock record, not for customers
  { key: "delivery-order:internal-copy", label: "Download Case DO Internal Copy" },
  // Cancel (void) a Case DO: it stays on record as Cancelled with the reason,
  // and its stock comes back through reversing movements
  { key: "delivery-order:cancel", label: "Cancel Delivery Order" },
  { key: "delivery-order:stock-override", label: "Record Case DO usage without enough stock (Stock Rules override)" },

  // Invoice
  { key: "invoice:read",   label: "View Invoices" },
  { key: "invoice:create", label: "Create Invoice" },
  { key: "invoice:update", label: "Update Invoice" },
  { key: "invoice:delete", label: "Delete Invoice" },

  // Supplier
  { key: "supplier:read",   label: "View Suppliers" },
  { key: "supplier:create", label: "Create Supplier" },
  { key: "supplier:update", label: "Update Supplier" },
  { key: "supplier:delete", label: "Delete Supplier" },

  // Purchase Requisition
  { key: "purchase-requisition:read",    label: "View Purchase Requisitions" },
  { key: "purchase-requisition:create",  label: "Create Purchase Requisition" },
  { key: "purchase-requisition:update",  label: "Update Purchase Requisition" },
  { key: "purchase-requisition:delete",  label: "Delete Purchase Requisition" },

  // Purchase Order
  { key: "purchase-order:read",   label: "View Purchase Orders" },
  { key: "purchase-order:create", label: "Create Purchase Order" },
  { key: "purchase-order:update", label: "Update Purchase Order" },
  { key: "purchase-order:delete", label: "Delete Purchase Order" },
  { key: "purchase-order:read:centralized",   label: "View All Supplier POs Across Owner's Organizations" },
  { key: "purchase-order:update:centralized", label: "Edit Supplier POs Across Owner's Organizations" },

  // Goods Receipt
  { key: "goods-receipt:create", label: "Record Goods Receipt" },
  { key: "goods-receipt:read:centralized", label: "View All Goods Receipts Across Owner's Organizations" },

  // Packing List
  { key: "packing-list:create",  label: "Create Packing List" },
  { key: "packing-list:inspect", label: "Inspect Packing List / Record Condition" },
  { key: "packing-list:read:centralized", label: "View All Packing Lists Across Owner's Organizations" },
  { key: "packing-list:inspect:centralized", label: "Inspect Packing Lists Across Owner's Organizations" },

  // Ledger / Chart of Accounts
  { key: "account:read",   label: "View Ledger & Chart of Accounts" },
  { key: "account:create", label: "Create Journal Entry / Account" },
  { key: "account:update", label: "Update Journal Entry / Account" },
  { key: "account:delete", label: "Delete Journal Entry / Account" },

  // Accounts Receivable (scoped — customer balances/receipts only, not the full ledger)
  { key: "accounts-receivable:read",   label: "View Accounts Receivable (Customer Balances & Receipts)" },
  { key: "accounts-receivable:create", label: "Record Customer Receipt (Accounts Receivable)" },

  // Customer
  { key: "customer:read",   label: "View Customers" },
  { key: "customer:create", label: "Create Customer" },
  { key: "customer:update", label: "Edit Customer" },
  { key: "customer:delete", label: "Delete Customer" },

  // Product
  { key: "product:read",         label: "View Products" },
  { key: "product:seed",         label: "Seed Products" },
  { key: "product:update-price", label: "Update Product Selling Prices" },
  { key: "product:upload-image", label: "Upload Product Images" },

  // Member management
  { key: "member:read",   label: "View Members" },
  { key: "member:invite", label: "Invite Members" },
  { key: "member:remove", label: "Remove Members" },

  // Department management
  { key: "department:read",   label: "View Departments" },
  { key: "department:create", label: "Create Department" },
  { key: "department:delete", label: "Delete Department" },

  // Profile
  { key: "profile:read",       label: "View Own Profile" },
  { key: "profile:update",     label: "Update Own Profile" },
  { key: "profile:read:all",   label: "View All Employee Profiles" },
  { key: "profile:update:all", label: "Update Any Employee Profile" },
  { key: "profile:delete:all", label: "Delete Any Employee Profile" },

  // Payslip
  { key: "payslip:read:own", label: "View Own Payslip" },
  { key: "payslip:read:all", label: "View All Payslips" },
  { key: "payslip:create",   label: "Create Payslip" },

  // Organization profile
  { key: "organization-profile:read",   label: "View Organization Profile" },
  { key: "organization-profile:create", label: "Setup Organization Profile" },
  { key: "organization-profile:update", label: "Update Organization Profile" },
  { key: "organization-profile:delete", label: "Delete Organization Profile" },

  // Document settings (PDF template/branding + document numbering)
  { key: "document-settings:update", label: "Update Document Settings" },

  // Organization roles (custom role management)
  { key: "organization-role:create", label: "Create Organization Role" },
  { key: "organization-role:update", label: "Update Organization Role" },
  { key: "organization-role:delete", label: "Delete Organization Role" },

  // Permission management (admin-only)
  { key: "permission:read",   label: "View Permissions" },
  { key: "permission:create", label: "Create Permission" },
  { key: "permission:update", label: "Update Permissions" },
  { key: "permission:delete", label: "Delete Permission" },

  // Inventory
  { key: "inventory:read",    label: "View Inventory (stock, field stock, movements, lots & serial numbers)" },
  { key: "inventory:adjust",  label: "Submit Stock Movement (New Movement / Adjust quantity)" },
  { key: "inventory:manage",  label: "Manage Inventory (lots & serial numbers, item groups, stock settings, Stock Rules)" },
  { key: "inventory:request", label: "Request Stock Allocation" },
  { key: "inventory:create",  label: "Transfer Stock to Rep (Field Stock)" },

  // Consignment (agent + customer, one module)
  { key: "consignment:read",   label: "View Consignments" },
  { key: "consignment:manage", label: "Send / Return Consignment Stock & Settings" },
  { key: "consignment:adjust", label: "Post Consignment Count Adjustments" },
  { key: "consignment:settle", label: "Settle Consignment (Intercompany / Customer Billing)" },

  // Leave management
  { key: "leave:read:own", label: "View Own Leave Applications" },
  { key: "leave:read:all", label: "View All Employees' Leave Applications" },
  { key: "leave:apply",    label: "Submit Leave Application" },
  { key: "leave:manage",   label: "Manage Leave Types & Entitlements" },
  { key: "leave:summary",  label: "View Leave Summary (all members)" },

  // Claim management
  { key: "claim:read:own", label: "View Own Claims" },
  { key: "claim:apply",    label: "Submit Claim Application" },
  { key: "claim:manage",   label: "Manage Claim Types" },
  { key: "claim:read:all", label: "View All Employees' Claims" },

  // Allowance management (category-based sales person / app specialist allowance)
  { key: "allowance:read:own", label: "View Own Allowance Statement" },
  { key: "allowance:read:all", label: "View All Employees' Allowance Statements" },
  { key: "allowance:manage",   label: "Manage Category Allowance Rates" },

  // Travel form (pre-trip authorization)
  { key: "travel:read:own", label: "View Own Travel Forms" },
  { key: "travel:apply",    label: "Submit Travel Form" },
  { key: "travel:manage",   label: "Manage Travel Forms" },
  { key: "travel:read:all", label: "View All Employees' Travel Forms" },
] as const;

// Approval-only keys (managed exclusively via Org Approvals, not in ALL_PERMISSIONS)
export const APPROVAL_ONLY_KEYS = [
  "leave:approve",
  "claim:check",
  "claim:approve",
  "travel:approve",
  "payslip:approve",
  "payslip:publish",
  "sales-order:approve",
  "purchase-requisition:approve",
  "purchase-order:approve",
  "inventory:approve",
  "packing-list:approve",
  "packing-list:approve:centralized",
] as const;

export type ApprovalOnlyKey = (typeof APPROVAL_ONLY_KEYS)[number];
export type PermissionKey = (typeof ALL_PERMISSIONS)[number]["key"] | ApprovalOnlyKey;

// ── Default departments ────────────────────────────────────────────────────

export const DEFAULT_DEPARTMENTS = [
  "management",
  "accounting",
  "regulatory",
  "human-resources",
  "sales",
  "marketing",
  "engineering",
  "logistic",
] as const;

export type DepartmentName = (typeof DEFAULT_DEPARTMENTS)[number];

// ── Stakeholder (view-only across everything) ──────────────────────────────

export const STAKEHOLDER_PERMISSIONS: PermissionKey[] = [
  "quotation:read",
  "sales-order:read",
  "customer-po:read",
  "delivery-order:read",
  "invoice:read",
  "supplier:read",
  "purchase-order:read",
  "purchase-requisition:read",
  "account:read",
  "customer:read",
  "product:read",
  "member:read",
  "department:read",
  "profile:read",
  "payslip:read:own",
  "organization-profile:read",
  "inventory:read",
  "consignment:read",
];

// ── Department-based role permissions ──────────────────────────────────────
//   Each department has a "manager" set and a "member" set.
//   Owner bypasses this entirely (returns "*").

export const DEPT_ROLE_PERMISSIONS: Record<
  string,
  { manager: PermissionKey[]; member: PermissionKey[] }
> = {
  management: {
    manager: [
      "quotation:read", "quotation:create", "quotation:update", "quotation:delete",
      "sales-order:read", "sales-order:create", "sales-order:update", "sales-order:delete",
      "sales-order:approve",
      "customer-po:read", "customer-po:create", "customer-po:update", "customer-po:delete",
      "delivery-order:read", "delivery-order:create", "delivery-order:update", "delivery-order:delete", "delivery-order:internal-copy", "delivery-order:cancel",
      "invoice:read", "invoice:create", "invoice:update", "invoice:delete",
      "supplier:read", "supplier:create", "supplier:update", "supplier:delete",
      "purchase-order:read", "purchase-order:create", "purchase-order:update", "purchase-order:delete",
      "purchase-requisition:read", "purchase-requisition:create", "purchase-requisition:update", "purchase-requisition:delete",
      "goods-receipt:create",
      "packing-list:create", "packing-list:inspect",
      "consignment:read", "consignment:manage", "consignment:adjust", "consignment:settle",
      "inventory:read", "inventory:adjust", "inventory:create", "inventory:manage",
      "accounts-receivable:read",
      "customer:read", "customer:create", "customer:update", "customer:delete",
      "product:read", "product:update-price", "product:upload-image",
      "member:read", "member:invite", "member:remove",
      "department:read", "department:create",
      "profile:read", "profile:update", "profile:read:all",
      "payslip:read:own", "payslip:read:all",
      "organization-profile:read", "organization-profile:create", "organization-profile:update",
      "document-settings:update",
      "organization-role:create", "organization-role:update", "organization-role:delete",
      "account:read", "account:create", "account:update", "account:delete",
      "claim:read:own", "claim:apply", "claim:approve",
      "leave:read:own", "leave:apply", "leave:read:all", "leave:summary",
      "travel:read:own", "travel:apply",
    ],
    member: [
      "quotation:read", "quotation:create", "quotation:update",
      "sales-order:read", "sales-order:create",
      "customer-po:read",
      "delivery-order:read",
      "invoice:read",
      "supplier:read",
      "purchase-order:read",
      "purchase-requisition:read",
      "inventory:read",
      "account:read",
      "customer:read",
      "product:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "organization-profile:read",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
  },

  sales: {
    manager: [
      "quotation:read", "quotation:create", "quotation:update", "quotation:delete",
      "sales-order:read", "sales-order:create", "sales-order:update", "sales-order:delete",
      "sales-order:approve",
      "customer-po:read", "customer-po:create", "customer-po:update", "customer-po:delete",
      "delivery-order:read",
      "invoice:read",
      "customer:read", "customer:create", "customer:update", "customer:delete",
      "product:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
    member: [
      "quotation:read", "quotation:create", "quotation:update",
      "sales-order:read", "sales-order:create",
      "customer-po:read",
      "delivery-order:read",
      "invoice:read",
      "customer:read",
      "product:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
  },

  accounting: {
    manager: [
      "invoice:read", "invoice:create", "invoice:update", "invoice:delete",
      "accounts-receivable:read", "accounts-receivable:create",
      "consignment:read", "consignment:settle",
      "payslip:read:own", "payslip:read:all", "payslip:create", "payslip:approve", "payslip:publish",
      "account:read", "account:create", "account:update", "account:delete",
      "sales-order:read",
      "delivery-order:read",
      "customer:read",
      "supplier:read",
      "purchase-order:read",
      "purchase-requisition:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "organization-profile:read",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
    member: [
      "invoice:read", "invoice:create",
      "accounts-receivable:read", "accounts-receivable:create",
      "payslip:read:own",
      "account:read", "account:create",
      "sales-order:read",
      "delivery-order:read",
      "customer:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
  },

  "human-resources": {
    manager: [
      "member:read", "member:invite", "member:remove",
      "department:read", "department:create",
      "profile:read", "profile:update", "profile:read:all", "profile:update:all", "profile:delete:all",
      "payslip:read:own", "payslip:read:all", "payslip:create", "payslip:approve", "payslip:publish",
      "organization-profile:read",
      "claim:read:own", "claim:apply", "claim:check", "claim:approve", "claim:manage", "claim:read:all",
      "leave:read:own", "leave:apply", "leave:approve", "leave:manage", "leave:read:all", "leave:summary",
      "travel:read:own", "travel:apply", "travel:approve", "travel:manage", "travel:read:all",
      "allowance:read:own", "allowance:read:all", "allowance:manage",
    ],
    member: [
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
      "allowance:read:own",
    ],
  },

  engineering: {
    manager: [
      "product:read", "product:seed", "product:update-price", "product:upload-image",
      "quotation:read",
      "sales-order:read",
      "delivery-order:read",
      "purchase-order:read",
      "packing-list:inspect",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
    member: [
      "product:read",
      "quotation:read",
      "purchase-order:read",
      "packing-list:inspect",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
  },

  logistic: {
    manager: [
      "delivery-order:read", "delivery-order:create", "delivery-order:update", "delivery-order:delete", "delivery-order:internal-copy", "delivery-order:cancel",
      "purchase-order:read", "purchase-order:create", "purchase-order:update", "purchase-order:delete",
      "purchase-requisition:read", "purchase-requisition:create", "purchase-requisition:update", "purchase-requisition:delete",
      "goods-receipt:create",
      "packing-list:create",
      "supplier:read", "supplier:create", "supplier:update", "supplier:delete",
      "inventory:read", "inventory:adjust", "inventory:manage", "inventory:create", "inventory:request",
      "consignment:read", "consignment:manage", "consignment:adjust",
      "customer:read",
      "product:read",
      "sales-order:read",
      "invoice:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
    member: [
      "delivery-order:read", "delivery-order:create", "delivery-order:update", "delivery-order:internal-copy",
      "purchase-order:read",
      "purchase-requisition:read",
      "goods-receipt:create",
      "packing-list:create",
      "supplier:read",
      "inventory:read", "inventory:adjust", "inventory:create", "inventory:request",
      "consignment:read",
      "customer:read",
      "product:read",
      "sales-order:read",
      "invoice:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
  },

  marketing: {
    manager: [
      "customer:read", "customer:create", "customer:update", "customer:delete",
      "quotation:read",
      "sales-order:read",
      "product:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
    member: [
      "customer:read",
      "quotation:read",
      "product:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
  },

  regulatory: {
    manager: [
      "quotation:read",
      "sales-order:read",
      "invoice:read",
      "delivery-order:read",
      "customer:read",
      "organization-profile:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
    member: [
      "quotation:read",
      "sales-order:read",
      "invoice:read",
      "delivery-order:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
      "travel:read:own", "travel:apply",
    ],
  },
};

// Kept for backward compat — resolves permissions for flat (non-dept) roles.
export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  stakeholder: STAKEHOLDER_PERMISSIONS,
};

// ── Permission bundles (bulk-grant presets) ────────────────────────────────
//   Granting one capability often requires read access to related resources.
//   These bundles encode those dependencies so admins can apply them in one click.

export type PermissionBundle = {
  id: string;
  label: string;
  description: string;
  permissions: PermissionKey[];
};

// Baseline self-service access every regular employee should have —
// matches the tail already duplicated across every DEPT_ROLE_PERMISSIONS[...].member array.
export const BASIC_PERMISSIONS: PermissionKey[] = [
  "member:read",
  "department:read",
  "profile:read",
  "profile:update",
  "payslip:read:own",
  "claim:read:own",
  "claim:apply",
  "leave:read:own",
  "leave:apply",
  "travel:read:own",
  "travel:apply",
];

export const PERMISSION_BUNDLES: PermissionBundle[] = [
  {
    id: "basic-employee-access",
    label: "Basic Employee Access",
    description: "Baseline self-service access every employee should have: view own profile/payslip, apply for leave, and submit claims.",
    permissions: BASIC_PERMISSIONS,
  },
  {
    id: "quotation-creator",
    label: "Quotation Creator",
    description: "Create and view quotations. Requires reading customers and products.",
    permissions: ["quotation:read", "quotation:create", "customer:read", "product:read"],
  },
  {
    id: "quotation-manager",
    label: "Quotation Manager",
    description: "Full quotation management including updates and deletion.",
    permissions: ["quotation:read", "quotation:create", "quotation:update", "quotation:delete", "customer:read", "product:read"],
  },
  {
    id: "sales-order-creator",
    label: "Sales Order Creator",
    description: "Create sales orders from quotations. Requires reading quotations, customers, and products.",
    permissions: ["sales-order:read", "sales-order:create", "quotation:read", "customer:read", "product:read"],
  },
  {
    id: "sales-order-manager",
    label: "Sales Order Manager",
    description: "Full sales order management. Includes quotation, customer, and product read access.",
    permissions: [
      "sales-order:read", "sales-order:create", "sales-order:update", "sales-order:delete",
      "quotation:read", "customer:read", "product:read",
    ],
  },
  {
    id: "customer-po-handler",
    label: "Customer PO Handler",
    description: "Create and manage customer purchase orders. Requires sales order and customer read.",
    permissions: ["customer-po:read", "customer-po:create", "customer-po:update", "sales-order:read", "customer:read"],
  },
  {
    id: "delivery-order-handler",
    label: "Delivery Order Handler",
    description: "Create delivery orders (incl. Case DOs from case templates), record the actual items used, deliver and record returns. Requires sales order, customer, product and stock read.",
    permissions: ["delivery-order:read", "delivery-order:create", "delivery-order:update", "sales-order:read", "customer:read", "product:read", "inventory:read"],
  },
  {
    id: "delivery-order-manager",
    label: "Delivery Order Manager",
    description: "Everything a DO handler does, plus the Case DO internal copy, cancelling a delivered or Case DO, and deleting drafts. The Stock Rules override is granted separately.",
    permissions: [
      "delivery-order:read", "delivery-order:create", "delivery-order:update", "delivery-order:delete",
      "delivery-order:internal-copy", "delivery-order:cancel",
      "sales-order:read", "invoice:read", "customer:read", "product:read", "inventory:read",
    ],
  },
  {
    id: "application-specialist",
    label: "Application Specialist (Case DO)",
    description: "For specialists who carry field stock: create Case DOs from the doctor's template, record what was used after the case, see their field stock and request stock. Add “Download Case DO Internal Copy” if they keep the internal record.",
    permissions: ["delivery-order:read", "delivery-order:create", "delivery-order:update", "inventory:read", "inventory:request", "customer:read", "product:read"],
  },
  {
    id: "invoice-creator",
    label: "Invoice Creator",
    description: "Create and manage invoices. Requires sales order, delivery order, and customer read.",
    permissions: ["invoice:read", "invoice:create", "invoice:update", "customer:read", "sales-order:read", "delivery-order:read"],
  },
  {
    id: "purchase-requisition-creator",
    label: "Purchase Requisition Creator",
    description: "Raise and manage purchase requisitions linked to sales orders. Requires sales order and product read.",
    permissions: [
      "purchase-requisition:read", "purchase-requisition:create", "purchase-requisition:update",
      "sales-order:read", "product:read", "supplier:read",
    ],
  },
  {
    id: "purchase-order-creator",
    label: "Purchase Order Creator",
    description: "Create and manage purchase orders. Requires supplier and product read.",
    permissions: ["purchase-order:read", "purchase-order:create", "purchase-order:update", "supplier:read", "product:read"],
  },
  {
    id: "warehouse-receiving",
    label: "Warehouse / Receiving Staff",
    description: "Record goods receipts and create packing lists against confirmed purchase orders. View-only access to POs.",
    permissions: ["goods-receipt:create", "packing-list:create", "purchase-order:read", "supplier:read", "product:read"],
  },
  {
    id: "quality-inspection",
    label: "Quality Inspection Staff",
    description: "Inspect packing lists against delivered goods and record condition (good/damaged) and follow-up action. View-only access to POs.",
    permissions: ["packing-list:inspect", "purchase-order:read", "product:read"],
  },
  {
    id: "inventory-staff",
    label: "Inventory Staff",
    description: "View inventory, submit stock movements (approved by an inventory approver), transfer stock to field reps and request stock. Requires product read.",
    permissions: ["inventory:read", "inventory:adjust", "inventory:create", "inventory:request", "product:read"],
  },
  {
    id: "inventory-manager",
    label: "Inventory Manager",
    description: "Inventory staff plus: lot numbers & expiry, serial numbers, item groups, stock settings and Stock Rules (incl. reconciling shortfalls). Approving stock movements is granted in Admin → Approvals.",
    permissions: ["inventory:read", "inventory:adjust", "inventory:create", "inventory:request", "inventory:manage", "product:read", "delivery-order:read"],
  },
  {
    id: "consignment-officer",
    label: "Consignment Officer",
    description: "Send and return consignment stock, record count adjustments and set consignment terms. Requires inventory, product and customer read.",
    permissions: ["consignment:read", "consignment:manage", "consignment:adjust", "inventory:read", "product:read", "customer:read"],
  },
  {
    id: "consignment-settlement",
    label: "Consignment Settlement (Finance)",
    description: "Settle consignment usage: intercompany invoice + PO, dealer / sales-agent and hospital invoices.",
    permissions: ["consignment:read", "consignment:settle", "invoice:read", "invoice:create", "purchase-order:read", "customer:read"],
  },
  {
    id: "sales-staff",
    label: "Sales Staff",
    description: "Full sales workflow: quotations, sales orders, customer POs, and related reads.",
    permissions: [
      "quotation:read", "quotation:create", "quotation:update",
      "sales-order:read", "sales-order:create",
      "customer-po:read",
      "delivery-order:read",
      "invoice:read",
      "customer:read",
      "product:read",
    ],
  },
  {
    id: "customer-manager",
    label: "Customer Manager",
    description: "Create and manage customer records.",
    permissions: ["customer:read", "customer:create", "customer:update"],
  },
  {
    id: "supplier-manager",
    label: "Supplier Manager",
    description: "Create and manage supplier records.",
    permissions: ["supplier:read", "supplier:create", "supplier:update"],
  },
  {
    id: "product-data-manager",
    label: "Product Data Manager",
    description: "Update product selling prices and upload product images. Requires product read.",
    permissions: ["product:read", "product:update-price", "product:upload-image"],
  },
  {
    id: "account-manager",
    label: "Account / Ledger Manager",
    description: "Full ledger management: create, post, edit, and delete journal entries and chart of accounts.",
    permissions: ["account:read", "account:create", "account:update", "account:delete"],
  },
  {
    id: "ar-clerk",
    label: "Accounts Receivable Clerk",
    description: "Record customer receipts and monitor who owes the business money — without access to the full ledger, chart of accounts, or other stakeholders' balances.",
    permissions: ["accounts-receivable:read", "accounts-receivable:create"],
  },
  {
    id: "claim-staff",
    label: "Claim Staff",
    description: "Submit expense claims and view own claim history.",
    permissions: ["claim:read:own", "claim:apply"],
  },
  {
    id: "claim-manager",
    label: "Claim Manager",
    description: "Submit claims and manage claim types. Checker/approver access is granted separately via Admin → Approvals.",
    permissions: ["claim:read:own", "claim:apply", "claim:manage"],
  },
  {
    id: "leave-administrator",
    label: "Leave Administrator",
    description: "Set up leave types, entitlements and policy, see every member's leave (report and summary). Approving leave is granted in Admin → Approvals.",
    permissions: ["leave:read:own", "leave:apply", "leave:manage", "leave:read:all", "leave:summary"],
  },
  {
    id: "document-settings-admin",
    label: "Document & Organization Settings",
    description: "Maintain the organization profile (incl. warehouses and banking) and document settings (PDF layout, numbering, DO notes).",
    permissions: ["organization-profile:read", "organization-profile:update", "document-settings:update"],
  },
  {
    id: "allowance-manager",
    label: "Allowance Manager",
    description: "Configure category allowance rates and view/pay every employee's allowance statement — without full HR-manager rights.",
    permissions: ["allowance:read:own", "allowance:read:all", "allowance:manage"],
  },
];
