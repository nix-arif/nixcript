"use server";

import { db } from "@/db";
import {
  assetUnit, claimApplication, deliveryOrder, leaveApplication, leaveCreditRequest, member, packingList, packingListItem, payrollPeriod,
  pendingDepartmentAssignment, pendingInvitation, product, purchaseOrder, purchaseRequisition, salesOrder, stockLevel, stockLot, stockMovement,
  stockRequest, stockShortfall, travelForm,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { isSelfActionAllowed } from "@/server/approval-settings";
import { getOrgGroupIds } from "@/lib/document-number-group";
import { and, eq, inArray, isNull, ne, not, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

// What is waiting for the signed-in user to check or approve in the active
// company — one entry per kind of task they hold the permission for, with how
// many are waiting and since when. A workflow that doesn't let people act on
// their own submissions (Org Approvals → self-action) leaves those out.

export interface MyTask {
  key: string;
  title: string;          // e.g. "Leave applications to approve"
  role: "Checker" | "Approver" | "Owner" | "Inventory" | "Specialist";
  count: number;
  oldest: Date | null;    // the longest-waiting one
  waitingDays: number | null; // whole days the oldest has waited
  href: string;           // where it is actioned
  detail?: string;        // shown instead of the waiting time (e.g. "earliest expires 12 Oct")
}

async function tally(table: PgTable, createdAt: AnyPgColumn, where: SQL | undefined) {
  const [r] = await db.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${createdAt})` }).from(table).where(where);
  return { count: r?.n ?? 0, oldest: r?.oldest ? new Date(r.oldest) : null };
}

export async function getMyApprovalTasks(): Promise<MyTask[]> {
  const session = await getCachedSession();
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId) return [];
  const userId = session.user.id;
  const perms = await getUserPermissions(userId, orgId);
  const can = (k: string) => hasAccess(perms, k);
  // Leave out the user's own submissions where the workflow doesn't allow self-action
  const notMine = async (key: string, col: AnyPgColumn) =>
    (await isSelfActionAllowed(orgId, key)) ? undefined : or(isNull(col), ne(col, userId));

  type Spec = Omit<MyTask, "count" | "oldest" | "waitingDays" | "detail"> & { run: () => Promise<{ count: number; oldest: Date | null; detail?: string }> };
  const specs: Spec[] = [];
  const add = (perm: string | null, spec: Spec) => { if (perm === null || can(perm)) specs.push(spec); };

  add("leave:approve", { key: "leave", title: "Leave applications to approve", role: "Approver", href: "/dashboard/human-resources/leave/approvals",
    run: async () => tally(leaveApplication, leaveApplication.createdAt, and(eq(leaveApplication.organizationId, orgId), eq(leaveApplication.status, "PENDING"), await notMine("leave:approve", leaveApplication.userId))) });
  add("leave:approve", { key: "leave-credit", title: "Replacement leave credits to approve", role: "Approver", href: "/dashboard/human-resources/leave/approvals",
    run: async () => tally(leaveCreditRequest, leaveCreditRequest.createdAt, and(eq(leaveCreditRequest.organizationId, orgId), eq(leaveCreditRequest.status, "PENDING"), await notMine("leave:approve", leaveCreditRequest.userId))) });
  add("claim:check", { key: "claim-check", title: "Claims to check", role: "Checker", href: "/dashboard/human-resources/claim/checker",
    run: async () => tally(claimApplication, claimApplication.createdAt, and(eq(claimApplication.organizationId, orgId), eq(claimApplication.status, "PENDING"), await notMine("claim:check", claimApplication.userId))) });
  add("claim:check", { key: "claim-rejection", title: "Claim rejections to confirm", role: "Checker", href: "/dashboard/human-resources/claim/checker",
    run: async () => tally(claimApplication, claimApplication.createdAt, and(eq(claimApplication.organizationId, orgId), eq(claimApplication.status, "REJECTION_REVIEW"), await notMine("claim:check", claimApplication.userId))) });
  add("claim:approve", { key: "claim-approve", title: "Checked claims to approve", role: "Approver", href: "/dashboard/human-resources/claim/approvals",
    run: async () => tally(claimApplication, claimApplication.createdAt, and(eq(claimApplication.organizationId, orgId), eq(claimApplication.status, "CHECKED"), await notMine("claim:approve", claimApplication.userId))) });
  add("travel:approve", { key: "travel", title: "Travel forms to approve", role: "Approver", href: "/dashboard/human-resources/travel/approvals",
    run: async () => tally(travelForm, travelForm.createdAt, and(eq(travelForm.organizationId, orgId), eq(travelForm.status, "PENDING"), await notMine("travel:approve", travelForm.userId))) });
  add("sales-order:approve", { key: "so", title: "Sales orders to approve", role: "Approver", href: "/dashboard/sales/order",
    run: async () => tally(salesOrder, salesOrder.createdAt, and(eq(salesOrder.organizationId, orgId), eq(salesOrder.status, "submitted"), await notMine("sales-order:approve", salesOrder.submittedBy))) });
  add("purchase-requisition:approve", { key: "pr", title: "Purchase requisitions to approve", role: "Approver", href: "/dashboard/procurement/requisition",
    run: async () => tally(purchaseRequisition, purchaseRequisition.createdAt, and(eq(purchaseRequisition.organizationId, orgId), eq(purchaseRequisition.status, "submitted"), await notMine("purchase-requisition:approve", purchaseRequisition.requestedBy))) });
  add("purchase-order:approve", { key: "po", title: "Purchase orders to approve", role: "Approver", href: "/dashboard/procurement/purchase-order",
    run: async () => tally(purchaseOrder, purchaseOrder.createdAt, and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.status, "submitted"), await notMine("purchase-order:approve", purchaseOrder.createdBy))) });
  add("inventory:approve", { key: "stock-movement", title: "Stock movements to approve", role: "Approver", href: "/dashboard/inventory/approvals",
    // a transfer is two lines (out and in) but one decision — count its "out" line only
    run: async () => tally(stockMovement, stockMovement.createdAt, and(eq(stockMovement.organizationId, orgId), eq(stockMovement.status, "PENDING"),
      not(and(eq(stockMovement.movementType, "TRANSFER"), sql`${stockMovement.quantity}::numeric > 0`)!), await notMine("inventory:approve", stockMovement.createdBy))) });
  add("inventory:approve", { key: "stock-request", title: "Stock requests to approve", role: "Approver", href: "/dashboard/inventory/requests",
    run: async () => tally(stockRequest, stockRequest.createdAt, and(eq(stockRequest.organizationId, orgId), eq(stockRequest.status, "pending"), await notMine("inventory:approve", stockRequest.requestedBy))) });
  const inspected = async (orgIds: string[], key: string) => {
    const [r] = await db.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${packingListItem.draftInspectedAt})` })
      .from(packingListItem).innerJoin(packingList, eq(packingList.id, packingListItem.packingListId))
      .where(and(inArray(packingList.organizationId, orgIds), eq(packingList.status, "pending"), eq(packingListItem.draftApprovalStatus, "pending"),
        await notMine(key, packingListItem.draftInspectedBy)));
    return { count: r?.n ?? 0, oldest: r?.oldest ? new Date(r.oldest) : null };
  };
  add("packing-list:approve", { key: "packing", title: "Inspected packing-list items to approve", role: "Approver", href: "/dashboard/procurement/packing-list",
    run: () => inspected([orgId], "packing-list:approve") });
  add("packing-list:approve:centralized", { key: "packing-central", title: "Inspected items to approve — other companies", role: "Approver", href: "/dashboard/procurement/packing-list/centralized",
    run: async () => inspected((await getOrgGroupIds(orgId)).filter((id) => id !== orgId), "packing-list:approve:centralized") });
  add("payslip:approve", { key: "payroll-approve", title: "Payroll periods to approve", role: "Approver", href: "/dashboard/human-resources/payroll",
    run: async () => tally(payrollPeriod, payrollPeriod.createdAt, and(eq(payrollPeriod.organizationId, orgId), eq(payrollPeriod.status, "draft"), await notMine("payslip:approve", payrollPeriod.createdBy))) });
  add("payslip:publish", { key: "payroll-publish", title: "Approved payroll to publish", role: "Approver", href: "/dashboard/human-resources/payroll",
    run: async () => tally(payrollPeriod, payrollPeriod.createdAt, and(eq(payrollPeriod.organizationId, orgId), eq(payrollPeriod.status, "approved"))) });

  // Inventory housekeeping for whoever manages inventory
  add("inventory:manage", { key: "shortfall", title: "Stock shortfalls to reconcile", role: "Inventory", href: "/dashboard/inventory/stock-rules",
    run: () => tally(stockShortfall, stockShortfall.createdAt, and(eq(stockShortfall.organizationId, orgId), eq(stockShortfall.status, "open"))) });
  add("inventory:manage", { key: "expiring", title: "Lots expired or expiring within 30 days", role: "Inventory", href: "/dashboard/inventory/serialized-units?tab=lots",
    run: async () => {
      const [r] = await db.select({ n: sql<number>`count(*)::int`, first: sql<string | null>`min(${stockLot.expiryDate})` }).from(stockLot)
        .where(and(eq(stockLot.organizationId, orgId), sql`${stockLot.quantity}::numeric > 0`, sql`${stockLot.expiryDate} <= now() + interval '30 days'`));
      const first = r?.first ? new Date(r.first) : null;
      return { count: r?.n ?? 0, oldest: null, detail: first ? `earliest ${first < new Date() ? "expired" : "expires"} ${first.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}` : undefined };
    } });
  add("inventory:manage", { key: "no-serial", title: "Machines held without a serial number", role: "Inventory", href: "/dashboard/inventory/serialized-units",
    run: async () => {
      // serial-tracked / rental items where the quantity held is more than the serial numbers recorded there
      const rows = await db.select({ productId: stockLevel.productId, label: stockLevel.warehouseLabel, qty: stockLevel.quantity }).from(stockLevel)
        .innerJoin(product, eq(product.id, stockLevel.productId))
        .where(and(eq(stockLevel.organizationId, orgId), sql`${stockLevel.quantity}::numeric > 0`, or(eq(product.requiresSerialTracking, true), eq(product.isRental, true)), sql`${stockLevel.warehouseLabel} not like 'CS:%'`));
      if (!rows.length) return { count: 0, oldest: null };
      const units = await db.select({ productId: assetUnit.productId, label: assetUnit.currentWarehouseLabel, n: sql<number>`count(*)::int` }).from(assetUnit)
        .where(and(eq(assetUnit.currentOrgId, orgId), inArray(assetUnit.status, ["IN_STOCK", "WITH_REP"])))
        .groupBy(assetUnit.productId, assetUnit.currentWarehouseLabel);
      const missing = rows.reduce((s, r) => s + Math.max(0, Math.floor(parseFloat(r.qty)) - (units.find((u) => u.productId === r.productId && u.label === r.label)?.n ?? 0)), 0);
      return { count: missing, oldest: null, detail: missing ? "give them serial numbers in Lots & Serial Numbers" : undefined };
    } });
  // The specialist's own Case DOs where the items used aren't recorded yet
  add(null, { key: "case-actuals", title: "Your Case DOs: record the items used", role: "Specialist", href: "/dashboard/fulfillment/delivery",
    run: () => tally(deliveryOrder, deliveryOrder.createdAt, and(eq(deliveryOrder.organizationId, orgId), eq(deliveryOrder.isCaseDo, true),
      eq(deliveryOrder.actualStatus, "pending"), eq(deliveryOrder.applicationSpecialistId, userId), ne(deliveryOrder.status, "cancelled"))) });

  // Owner-only reviews: new member invitations and department assignments
  const [me] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId), isNull(member.deletedAt))).limit(1);
  if (me?.role === "owner") {
    add(null, { key: "invitation", title: "Member invitations to approve", role: "Owner", href: "/dashboard/admin/member-approvals",
      run: () => tally(pendingInvitation, pendingInvitation.createdAt, and(eq(pendingInvitation.organizationId, orgId), eq(pendingInvitation.status, "PENDING"))) });
    add(null, { key: "department", title: "Department assignments to approve", role: "Owner", href: "/dashboard/admin/member-approvals",
      run: () => tally(pendingDepartmentAssignment, pendingDepartmentAssignment.createdAt, and(eq(pendingDepartmentAssignment.organizationId, orgId), eq(pendingDepartmentAssignment.status, "PENDING"))) });
  }

  const now = Date.now();
  const results = await Promise.all(specs.map(async ({ run, ...s }) => {
    const r = await run();
    return { ...s, ...r, waitingDays: r.oldest ? Math.floor((now - r.oldest.getTime()) / 86_400_000) : null };
  }));
  return results.filter((t) => t.count > 0).sort((a, b) => (a.oldest?.getTime() ?? 0) - (b.oldest?.getTime() ?? 0));
}
