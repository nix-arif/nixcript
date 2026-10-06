"use server";

import { db } from "@/db";
import {
  claimApplication, leaveApplication, leaveCreditRequest, member, packingList, packingListItem, payrollPeriod,
  pendingDepartmentAssignment, pendingInvitation, purchaseOrder, purchaseRequisition, salesOrder, stockMovement,
  stockRequest, travelForm,
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
  role: "Checker" | "Approver" | "Owner";
  count: number;
  oldest: Date | null;    // the longest-waiting one
  waitingDays: number | null; // whole days the oldest has waited
  href: string;           // where it is actioned
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

  type Spec = Omit<MyTask, "count" | "oldest" | "waitingDays"> & { run: () => Promise<{ count: number; oldest: Date | null }> };
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
