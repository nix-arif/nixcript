export const ALL_PERMISSIONS = [
  { key: "quotation:read", label: "View Quotations" },
  { key: "quotation:create", label: "Create Quotation" },
  { key: "quotation:update", label: "Update Quotation" },
  { key: "quotation:delete", label: "Delete Quotation" },

  { key: "sales-order:read", label: "View Sales Orders" },
  { key: "sales-order:create", label: "Create Sales Order" },
  { key: "sales-order:update", label: "Update Sales Order" },
  { key: "sales-order:delete", label: "Delete Sales Order" },

  { key: "delivery-order:read", label: "View Delivery Orders" },
  { key: "delivery-order:create", label: "Create Delivery Order" },
  { key: "delivery-order:update", label: "Update Delivery Order" },
  { key: "delivery-order:delete", label: "Delete Delivery Order" },

  { key: "invoice:read", label: "View Invoices" },
  { key: "invoice:create", label: "Create Invoice" },
  { key: "invoice:update", label: "Update Invoice" },
  { key: "invoice:delete", label: "Delete Invoice" },

  { key: "organization-role:create", label: "Create Organization Role" },
  { key: "organization-role:update", label: "Update Organization Role" },
  { key: "organization-role:delete", label: "Delete Organization Role" },

  { key: "member:invite", label: "Invite Members" },
  { key: "member:read", label: "View Members" },
  { key: "member:remove", label: "Remove Members" },

  { key: "permission:read", label: "View Permissions" },
  { key: "permission:create", label: "Create Permission" },
  { key: "permission:delete", label: "Delete Permission" },

  { key: "profile:read", label: "View Own Profile" },
  { key: "profile:update", label: "Update Own Profile" },
  { key: "profile:read:all", label: "View All Employee Profiles" },
  { key: "profile:update:all", label: "Update Any Employee Profile" },
  { key: "profile:delete:all", label: "Delete Any Employee Profile" },

  { key: "product:seed", label: "Seed Products" },
  { key: "product:read", label: "View Products" },
] as const;
