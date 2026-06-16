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

  // Customer PO
  { key: "customer-po:read",   label: "View Customer POs" },
  { key: "customer-po:create", label: "Create Customer PO" },
  { key: "customer-po:update", label: "Update Customer PO" },
  { key: "customer-po:delete", label: "Delete Customer PO" },

  // Delivery Order
  { key: "delivery-order:read",   label: "View Delivery Orders" },
  { key: "delivery-order:create", label: "Create Delivery Order" },
  { key: "delivery-order:update", label: "Update Delivery Order" },
  { key: "delivery-order:delete", label: "Delete Delivery Order" },

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
  { key: "purchase-requisition:approve", label: "Approve Purchase Requisitions" },

  // Purchase Order
  { key: "purchase-order:read",   label: "View Purchase Orders" },
  { key: "purchase-order:create", label: "Create Purchase Order" },
  { key: "purchase-order:update", label: "Update Purchase Order" },
  { key: "purchase-order:delete", label: "Delete Purchase Order" },

  // Goods Receipt
  { key: "goods-receipt:create", label: "Record Goods Receipt" },

  // Ledger / Chart of Accounts
  { key: "account:read",   label: "View Ledger & Chart of Accounts" },
  { key: "account:create", label: "Create Journal Entry / Account" },
  { key: "account:update", label: "Update Journal Entry / Account" },
  { key: "account:delete", label: "Delete Journal Entry / Account" },

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

  // Organization roles (custom role management)
  { key: "organization-role:create", label: "Create Organization Role" },
  { key: "organization-role:update", label: "Update Organization Role" },
  { key: "organization-role:delete", label: "Delete Organization Role" },

  // Permission management (admin-only)
  { key: "permission:read",   label: "View Permissions" },
  { key: "permission:create", label: "Create Permission" },
  { key: "permission:delete", label: "Delete Permission" },

  // Inventory
  { key: "inventory:read",    label: "View Inventory" },
  { key: "inventory:adjust",  label: "Submit Stock Movement" },
  { key: "inventory:manage",  label: "Manage Inventory Settings" },
  { key: "inventory:request", label: "Request Stock Allocation" },

  // Leave management
  { key: "leave:read:own", label: "View Own Leave Applications" },
  { key: "leave:read:all", label: "View All Employees' Leave Applications" },
  { key: "leave:apply",    label: "Submit Leave Application" },
  { key: "leave:manage",   label: "Manage Leave Types & Entitlements" },

  // Claim management
  { key: "claim:read:own", label: "View Own Claims" },
  { key: "claim:apply",    label: "Submit Claim Application" },
  { key: "claim:manage",   label: "Manage Claim Types" },
] as const;

// Approval-only keys (managed exclusively via Org Approvals, not in ALL_PERMISSIONS)
export const APPROVAL_ONLY_KEYS = [
  "leave:approve",
  "claim:approve",
  "payslip:approve",
  "payslip:publish",
  "sales-order:approve",
  "purchase-order:approve",
  "inventory:approve",
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
      "delivery-order:read", "delivery-order:create", "delivery-order:update", "delivery-order:delete",
      "invoice:read", "invoice:create", "invoice:update", "invoice:delete",
      "supplier:read", "supplier:create", "supplier:update", "supplier:delete",
      "purchase-order:read", "purchase-order:create", "purchase-order:update", "purchase-order:delete",
      "purchase-requisition:read", "purchase-requisition:create", "purchase-requisition:update", "purchase-requisition:delete",
      "goods-receipt:create",
      "customer:read", "customer:create", "customer:update", "customer:delete",
      "product:read", "product:update-price", "product:upload-image",
      "member:read", "member:invite", "member:remove",
      "department:read", "department:create",
      "profile:read", "profile:update", "profile:read:all",
      "payslip:read:own", "payslip:read:all",
      "organization-profile:read", "organization-profile:create", "organization-profile:update",
      "organization-role:create", "organization-role:update", "organization-role:delete",
      "account:read", "account:create", "account:update", "account:delete",
      "claim:read:own", "claim:apply", "claim:approve",
      "leave:read:own", "leave:apply",
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
    ],
  },

  accounting: {
    manager: [
      "invoice:read", "invoice:create", "invoice:update", "invoice:delete",
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
    ],
    member: [
      "invoice:read", "invoice:create",
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
    ],
  },

  "human-resources": {
    manager: [
      "member:read", "member:invite", "member:remove",
      "department:read", "department:create",
      "profile:read", "profile:update", "profile:read:all", "profile:update:all", "profile:delete:all",
      "payslip:read:own", "payslip:read:all", "payslip:create", "payslip:approve", "payslip:publish",
      "organization-profile:read",
      "claim:read:own", "claim:apply", "claim:approve", "claim:manage",
      "leave:read:own", "leave:apply", "leave:approve", "leave:manage", "leave:read:all",
    ],
    member: [
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
    ],
  },

  engineering: {
    manager: [
      "product:read", "product:seed", "product:update-price", "product:upload-image",
      "quotation:read",
      "sales-order:read",
      "delivery-order:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
    ],
    member: [
      "product:read",
      "quotation:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
    ],
  },

  logistic: {
    manager: [
      "delivery-order:read", "delivery-order:create", "delivery-order:update", "delivery-order:delete",
      "purchase-order:read", "purchase-order:create", "purchase-order:update", "purchase-order:delete",
      "purchase-requisition:read", "purchase-requisition:create", "purchase-requisition:update", "purchase-requisition:delete",
      "goods-receipt:create",
      "supplier:read", "supplier:create", "supplier:update", "supplier:delete",
      "inventory:read", "inventory:adjust", "inventory:manage",
      "sales-order:read",
      "invoice:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
    ],
    member: [
      "delivery-order:read", "delivery-order:create", "delivery-order:update",
      "purchase-order:read",
      "purchase-requisition:read",
      "goods-receipt:create",
      "supplier:read",
      "inventory:read", "inventory:adjust",
      "sales-order:read",
      "invoice:read",
      "member:read",
      "department:read",
      "profile:read", "profile:update",
      "payslip:read:own",
      "claim:read:own", "claim:apply",
      "leave:read:own", "leave:apply",
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

export const PERMISSION_BUNDLES: PermissionBundle[] = [
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
    description: "Create and manage delivery orders. Requires sales order and customer read.",
    permissions: ["delivery-order:read", "delivery-order:create", "delivery-order:update", "sales-order:read", "customer:read"],
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
    id: "purchase-requisition-approver",
    label: "Purchase Requisition Approver",
    description: "Approve or return purchase requisitions for revision.",
    permissions: [
      "purchase-requisition:approve",
      "purchase-requisition:read",
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
    description: "Record goods receipts against confirmed purchase orders. View-only access to POs.",
    permissions: ["goods-receipt:create", "purchase-order:read", "supplier:read", "product:read"],
  },
  {
    id: "inventory-staff",
    label: "Inventory Staff",
    description: "View inventory and submit stock movements. Requires product read.",
    permissions: ["inventory:read", "inventory:adjust", "product:read"],
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
];
