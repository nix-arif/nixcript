import {
  LayoutDashboardIcon,
  FileTextIcon,
  ShoppingCartIcon,
  TruckIcon,
  ReceiptIcon,
  UsersIcon,
  ShieldIcon,
  WrenchIcon,
  UserIcon,
  PackageOpen,
  WarehouseIcon,
  HardHat,
  FolderOpenIcon,
  BuildingIcon,
  BuildingIcon as ProcurementIcon,
  BookOpenIcon,
} from "lucide-react";
import React from "react";

export type NavSubItem = {
  title: string;
  url: string;
  permission?: string;
};

export type NavGroup = {
  title: string;
  url: string;
  icon: React.ReactNode;
  isActive?: boolean;
  items: NavSubItem[];
};

export const navConfig: NavGroup[] = [
  {
    title: "Overview",
    url: "/dashboard",
    icon: React.createElement(LayoutDashboardIcon),
    items: [
      { title: "Home",     url: "/dashboard"           },
      { title: "Workflow", url: "/dashboard/workflow", permission: "sales-order:read" },
    ],
  },
  {
    title: "Sales",
    url: "#",
    icon: React.createElement(ShoppingCartIcon),
    items: [
      { title: "Customers",    url: "/dashboard/sales/customer",      permission: "customer:read"    },
      { title: "Quotations",   url: "/dashboard/sales/quotation",     permission: "quotation:read"   },
      { title: "Customer POs", url: "/dashboard/sales/customer-po",   permission: "customer-po:read" },
      { title: "Sales Orders", url: "/dashboard/sales/order",         permission: "sales-order:read" },
      { title: "Consignment",  url: "/dashboard/sales/consignment",   permission: "sales-order:read" },
      { title: "Activity Log", url: "/dashboard/sales/activity",      permission: "customer:read"    },
    ],
  },
  {
    title: "Procurement",
    url: "#",
    icon: React.createElement(ProcurementIcon),
    items: [
      { title: "Suppliers",            url: "/dashboard/procurement/supplier",        permission: "supplier:read"       },
      { title: "Purchase Requisition", url: "/dashboard/procurement/requisition",   permission: "purchase-requisition:read" },
      { title: "Purchase Orders",      url: "/dashboard/procurement/purchase-order", permission: "purchase-order:read" },
      { title: "Goods Receipts",       url: "/dashboard/procurement/goods-receipt",  permission: "purchase-order:read" },
    ],
  },
  {
    title: "Fulfillment",
    url: "#",
    icon: React.createElement(TruckIcon),
    items: [
      { title: "Delivery Orders",     url: "/dashboard/fulfillment/delivery", permission: "delivery-order:read" },
      { title: "Invoices",            url: "/dashboard/fulfillment/invoice",  permission: "invoice:read"         },
      { title: "Statement of Account", url: "/dashboard/fulfillment/soa",     permission: "invoice:read"         },
    ],
  },
  {
    title: "Ledger",
    url: "#",
    icon: React.createElement(BookOpenIcon),
    items: [
      { title: "Journal Entries",   url: "/dashboard/ledger/entries",       permission: "account:read" },
      { title: "Chart of Accounts", url: "/dashboard/ledger/accounts",      permission: "account:read" },
      { title: "Trial Balance",     url: "/dashboard/ledger/trial-balance",  permission: "account:read" },
      { title: "Subsidiary Ledger", url: "/dashboard/ledger/subsidiary-ledger", permission: "account:read" },
    ],
  },
  {
    title: "Product",
    url: "#",
    icon: React.createElement(PackageOpen),
    items: [
      { title: "Product Search",          url: "/dashboard/products/search",                    permission: "product:read" },
      { title: "Product Glossary",        url: "/dashboard/products/glossary",                  permission: "product:read" },
      { title: "Catalogue",               url: "/dashboard/products/catalogue",                 permission: "product:read" },
      { title: "MDA Certificate Generator", url: "/dashboard/products/mda-certificate-generator", permission: "product:read" },
      { title: "Items Price Check",       url: "/dashboard/products/items-price",               permission: "product:read" },
      { title: "Update Selling Price",    url: "/dashboard/products/update-price",              permission: "product:update-price" },
      { title: "Upload Product Images",   url: "/dashboard/products/upload-images",             permission: "product:upload-image" },
      { title: "Picture Reference",       url: "/dashboard/products/picture-ref",               permission: "product:read" },
    ],
  },
  {
    title: "Inventory",
    url: "#",
    icon: React.createElement(WarehouseIcon),
    items: [
      { title: "Stock Overview",    url: "/dashboard/inventory",                      permission: "inventory:read"    },
      { title: "Field Stock",       url: "/dashboard/inventory/field-stock",          permission: "inventory:read"    },
      { title: "Transfer to Rep",   url: "/dashboard/inventory/field-stock/transfer", permission: "inventory:create"  },
      { title: "Pending Approvals", url: "/dashboard/inventory/approvals",            permission: "inventory:approve" },
      { title: "Movement History",  url: "/dashboard/inventory/movements",            permission: "inventory:read"    },
    ],
  },
  {
    title: "Organization",
    url: "#",
    icon: React.createElement(UsersIcon),
    items: [
      { title: "Members",              url: "/dashboard/organization/members",              permission: "member:read"               },
      { title: "Departments",          url: "/dashboard/organization/departments",          permission: "department:read"           },
      { title: "Roles",                url: "/dashboard/organization/roles",                permission: "organization-role:update"  },
      { title: "Organization Profile", url: "/dashboard/organization/organization-profile", permission: "organization-profile:read" },
      { title: "Document Settings",    url: "/dashboard/organization/document-settings",    permission: "organization-profile:update" },
      { title: "Categories",           url: "/dashboard/organization/categories",           permission: "organization-profile:read" },
      { title: "Admin Invoices",       url: "/dashboard/organization/invoices",             permission: "organization-profile:update" },
    ],
  },
  {
    title: "Projects",
    url: "#",
    icon: React.createElement(FolderOpenIcon),
    items: [
      { title: "Government",   url: "/dashboard/project/government",   permission: "quotation:create" },
      { title: "Warrant 2026", url: "/dashboard/project/warrant-2026"                                 },
    ],
  },
  {
    title: "Human Resources",
    url: "#",
    icon: React.createElement(HardHat),
    items: [
      { title: "Payroll",        url: "/dashboard/human-resources/payroll",              permission: "payslip:read:all" },
      { title: "My Payslips",    url: "/dashboard/human-resources/payslips",             permission: "payslip:read:own" },
      { title: "My Leave",       url: "/dashboard/human-resources/leave",                permission: "leave:read:own"   },
      { title: "Leave Approvals",url: "/dashboard/human-resources/leave/approvals",      permission: "leave:approve"    },
      { title: "Leave Types",    url: "/dashboard/human-resources/leave/types",          permission: "leave:manage"     },
      { title: "Leave Balances", url: "/dashboard/human-resources/leave/balances",       permission: "leave:manage"     },
      { title: "Leave Report",   url: "/dashboard/human-resources/leave/report",         permission: "leave:read:all"   },
      { title: "My Claims",      url: "/dashboard/human-resources/claim",               permission: "claim:read:own"   },
      { title: "Claim Checker",  url: "/dashboard/human-resources/claim/checker",        permission: "claim:check"      },
      { title: "Claim Approvals",url: "/dashboard/human-resources/claim/approvals",      permission: "claim:approve"    },
      { title: "Claim Types",    url: "/dashboard/human-resources/claim/types",          permission: "claim:manage"     },
      { title: "All Claims",     url: "/dashboard/human-resources/claim/all",            permission: "claim:read:all"   },
      { title: "My Travel Forms",  url: "/dashboard/human-resources/travel",             permission: "travel:read:own"  },
      { title: "Travel Approvals", url: "/dashboard/human-resources/travel/approvals",   permission: "travel:approve"   },
      { title: "All Travel Forms", url: "/dashboard/human-resources/travel/all",         permission: "travel:read:all"  },
    ],
  },
  {
    title: "Admin",
    url: "#",
    icon: React.createElement(ShieldIcon),
    items: [
      { title: "Access Control",       url: "/dashboard/admin/permissions",        permission: "permission:read" },
      { title: "Default Permissions",  url: "/dashboard/admin/default-permissions", permission: "permission:read" },
      { title: "Approvals",            url: "/dashboard/admin/approvals",          permission: "permission:read" },
      { title: "Member Approvals",     url: "/dashboard/admin/member-approvals",   permission: "permission:read" },
    ],
  },
  {
    title: "Profile",
    url: "/dashboard/profile",
    icon: React.createElement(UserIcon),
    items: [
      { title: "My Profile", url: "/dashboard/profile/my-profile" },
    ],
  },
  {
    title: "Tools",
    url: "#",
    icon: React.createElement(WrenchIcon),
    items: [
      { title: "Certificate Matcher", url: "/dashboard/tools/certificate-matcher", permission: "permission:read" },
      { title: "Seed Products",       url: "/dashboard/tools/seed-products",       permission: "product:seed"   },
      { title: "PDF Compressor",      url: "/dashboard/tools/pdf-compress",        permission: "permission:read" },
    ],
  },
];

export function filterNav(nav: NavGroup[], userPermissions: string[]): NavGroup[] {
  if (userPermissions.includes("*")) return nav;

  const permSet = new Set(userPermissions);
  return nav
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || permSet.has(item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}
