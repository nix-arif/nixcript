export const APPROVAL_MODULES = [
  {
    id: "leave",
    title: "Leave Management",
    description: "Who can approve or reject leave applications.",
    permissions: [
      { key: "leave:approve", label: "Approve / Reject Leave" },
    ],
  },
  {
    id: "claim",
    title: "Claim Management",
    description: "Who can check (first-level review) or approve expense claims.",
    permissions: [
      { key: "claim:check",   label: "Check Claims (1st level)" },
      { key: "claim:approve", label: "Approve / Reject Claims (final)" },
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
      { key: "sales-order:approve", label: "Approve / Reject / Recall Sales Orders" },
    ],
  },
  {
    id: "purchase-requisition",
    title: "Purchase Requisitions",
    description: "Who can approve or reject internal purchase requisitions.",
    permissions: [
      { key: "purchase-requisition:approve", label: "Approve / Reject Purchase Requisitions" },
    ],
  },
  {
    id: "procurement",
    title: "Purchase Orders",
    description: "Who can approve, reject or recall purchase orders.",
    permissions: [
      { key: "purchase-order:approve", label: "Approve / Reject / Recall Purchase Orders" },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    description: "Who can approve or reject stock movement submissions.",
    permissions: [
      { key: "inventory:approve", label: "Approve / Reject Stock Movements" },
    ],
  },
] as const;

export type ApprovalModule = typeof APPROVAL_MODULES[number];
