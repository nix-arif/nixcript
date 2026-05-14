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
        title: "Quotations",
        url: "/dashboard/sales/quotation",
        permission: "quotation:read",
      },
      {
        title: "Create Quotation",
        url: "/dashboard/sales/quotation/create",
        permission: "quotation:create",
      },
      {
        title: "Sales Orders",
        url: "/dashboard/sales/order",
        permission: "sales-order:read",
      },
      {
        title: "Create Sales Order",
        url: "/dashboard/sales/order/create",
        permission: "sales-order:create",
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
        title: "Create Delivery Order",
        url: "/dashboard/fulfillment/delivery/create",
        permission: "delivery-order:create",
      },
      {
        title: "Invoices",
        url: "/dashboard/fulfillment/invoice",
        permission: "invoice:read",
      },
      {
        title: "Create Invoice",
        url: "/dashboard/fulfillment/invoice/create",
        permission: "invoice:create",
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
  console.log("nav.ts line 149", permSet);

  return nav
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.permission || permSet.has(item.permission),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
