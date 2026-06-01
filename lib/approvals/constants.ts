export const APPROVAL_MODULES = [
  {
    id: "leave",
    title: "Leave Management",
    description: "Who can approve or reject leave applications and configure leave types.",
    permissions: [
      { key: "leave:approve", label: "Approve / Reject Leave" },
      { key: "leave:manage",  label: "Manage Leave Types" },
    ],
  },
  {
    id: "claim",
    title: "Claim Management",
    description: "Who can approve or reject expense claims and configure claim types & rates.",
    permissions: [
      { key: "claim:approve", label: "Approve / Reject Claims" },
      { key: "claim:manage",  label: "Manage Claim Types & Rates" },
    ],
  },
  {
    id: "payroll",
    title: "Payroll",
    description: "Who can approve payroll periods and publish payslips to employees.",
    permissions: [
      { key: "payslip:approve", label: "Approve Payroll Period" },
      { key: "payslip:publish", label: "Publish Payslips" },
    ],
  },
  {
    id: "sales",
    title: "Sales Orders",
    description: "Who can approve, reject or recall sales orders.",
    permissions: [
      { key: "sales-order:approve", label: "Approve Sales Order" },
      { key: "sales-order:reject",  label: "Reject Sales Order" },
      { key: "sales-order:recall",  label: "Recall Sales Order" },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    description: "Who can approve or reject stock movement submissions.",
    permissions: [
      { key: "inventory:approve", label: "Approve / Reject Stock Movements" },
      { key: "inventory:manage",  label: "Manage Inventory Settings" },
    ],
  },
] as const;

export type ApprovalModule = typeof APPROVAL_MODULES[number];
