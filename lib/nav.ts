import {
  LayoutDashboardIcon,
  FileTextIcon,
  ShoppingCartIcon,
  TruckIcon,
  ReceiptIcon,
  UsersIcon,
  ShieldIcon,
  KeyIcon,
  WrenchIcon,
  UserIcon,
  PackageOpen,
  HardHat,
  FolderOpenIcon,
  BuildingIcon,
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
      {
        title: "Home",
        url: "/dashboard",
        // no permission — always visible
      },
    ],
  },
  {
    title: "Sales",
    url: "#",
    icon: React.createElement(ShoppingCartIcon),
    items: [
      {
        title: "Customers",
        url: "/dashboard/sales/customer",
        permission: "customer:read",
      },
      {
        title: "Quotations",
        url: "/dashboard/sales/quotation",
        permission: "quotation:read",
      },
      {
        title: "Sales Orders",
        url: "/dashboard/sales/order",
        permission: "sales-order:read",
      },
      {
        title: "Customer POs",
        url: "/dashboard/sales/customer-po",
        permission: "customer-po:read",
      },
    ],
  },
  {
    title: "Procurement",
    url: "#",
    icon: React.createElement(BuildingIcon),
    items: [
      {
        title: "Suppliers",
        url: "/dashboard/procurement/supplier",
        permission: "supplier:read",
      },
      {
        title: "Purchase Orders",
        url: "/dashboard/procurement/purchase-order",
        permission: "purchase-order:read",
      },
    ],
  },
  {
    title: "Fulfillment",
    url: "#",
    icon: React.createElement(TruckIcon),
    items: [
      {
        title: "Delivery Orders",
        url: "/dashboard/fulfillment/delivery",
        permission: "delivery-order:read",
      },
      {
        title: "Invoices",
        url: "/dashboard/fulfillment/invoice",
        permission: "invoice:read",
      },
    ],
  },
  {
    title: "Product",
    url: "#",
    icon: React.createElement(PackageOpen),
    items: [
      {
        title: "Product Search",
        url: "/dashboard/products/search",
        permission: "product:read",
      },
      {
        title: "Catalogue",
        url: "/dashboard/products/catalogue",
        permission: "product:read",
      },
      {
        title: "MDA Certificate Generator",
        url: "/dashboard/products/mda-certificate-generator",
        permission: "product:read",
      },
      {
        title: "Items Price Check",
        url: "/dashboard/products/items-price",
        permission: "product:read",
      },
    ],
  },
  {
    title: "Organization",
    url: "#",
    icon: React.createElement(UsersIcon),
    items: [
      {
        title: "Members",
        url: "/dashboard/organization/members",
        permission: "member:read",
      },
      {
        title: "Invite Members",
        url: "/dashboard/organization/invite",
        permission: "member:invite",
      },
      {
        title: "Roles",
        url: "/dashboard/organization/roles",
        permission: "organization-role:update",
      },
      {
        title: "Create Role",
        url: "/dashboard/organization/roles/create",
        permission: "organization-role:create",
      },
      {
        title: "Organization Profile",
        url: "/dashboard/organization/organization-profile",
        permission: "organization-profile:create", // admin/owner only
      },
      {
        title: "Document Settings",
        url: "/dashboard/organization/document-settings",
        permission: "organization-profile:create",
      },
    ],
  },
  {
    title: "Projects",
    url: "#",
    icon: React.createElement(FolderOpenIcon),
    items: [
      {
        title: "Government",
        url: "/dashboard/project/government",
        permission: "quotation:create",
      },
    ],
  },
  {
    title: "Admin",
    url: "#",
    icon: React.createElement(ShieldIcon),
    items: [
      {
        title: "Permissions",
        url: "/dashboard/admin/permissions",
        permission: "permission:read",
      },
      {
        title: "Create Permission",
        url: "/dashboard/admin/permissions/create",
        permission: "permission:create",
      },
    ],
  },
  {
    title: "Human Resources",
    url: "#",
    icon: React.createElement(HardHat),
    items: [
      {
        title: "Payroll",
        url: "/dashboard/human-resources/payroll",
        permission: "payslip:read:all",
      },
      {
        title: "My Payslips",
        url: "/dashboard/human-resources/payslips",
        permission: "payslip:read:own",
      },
    ],
  },
  {
    title: "Profile",
    url: "/dashboard/profile",
    icon: React.createElement(UserIcon),
    items: [
      {
        title: "My Profile",
        url: "/dashboard/profile/my-profile",
        permission: "",
      },
    ],
  },
  {
    title: "Tools",
    url: "#",
    icon: React.createElement(WrenchIcon), // import WrenchIcon from lucide-react
    items: [
      {
        title: "Certificate Matcher",
        url: "/dashboard/tools/certificate-matcher",
        permission: "permission:read",
      },
      {
        title: "Seed Products",
        url: "/dashboard/tools/seed-products",
        permission: "product:seed",
      },
    ],
  },
];

export function filterNav(
  nav: NavGroup[],
  userPermissions: string[],
): NavGroup[] {
  const isOwner = userPermissions.includes("*");

  if (isOwner) return nav;

  const permSet = new Set(userPermissions);
  return nav
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.permission || permSet.has(item.permission),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
