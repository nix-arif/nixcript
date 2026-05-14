export type NavItem = {
  title: string;
  url: string;
  permission: string;
  icon?: string;
};

export type NavGroup = {
  group: string;
  items: NavItem[];
};

export const navConfig: NavGroup[] = [
  {
    group: "Sales",
    items: [
      {
        title: "Quotation",
        url: "/dashboard/sales/quotation",
        permission: "quotation.view",
      },
      {
        title: "Sales Order",
        url: "/dashboard/sales/order",
        permission: "salesOrder.view",
      },
    ],
  },
  {
    group: "Fulfillment",
    items: [
      {
        title: "Delivery Order",
        url: "/dashboard/fulfillment/delivery",
        permission: "deliveryOrder.view",
      },
      {
        title: "Invoice",
        url: "/dashboard/fulfillment/invoice",
        permission: "invoice.view",
      },
    ],
  },
  {
    group: "Admin",
    items: [
      {
        title: "Create Permission",
        url: "/dashboard/admin/create-permission",
        permission: "permission.create",
      },
      {
        title: "Create Organization Role",
        url: "/dashboard/admin/create-organization-role",
        permission: "organizationRole.create",
      },
      {
        title: "Members Invitation",
        url: "/dashboard/admin/invite-members",
        permission: "member.invite",
      },
    ],
  },
];
