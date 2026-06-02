import { requirePermission } from "@/lib/auth/require-permission";
import { getStockRequests, getStaffAllocations, getStaffStockLimits } from "@/server/stock-request";
import { getWarehouses } from "@/server/inventory";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { StockRequestsClient } from "./requests-client";
import { db } from "@/db";
import { member, user } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function StockRequestsPage() {
  const session = await requirePermission("inventory:read");
  const orgId = session.session.activeOrganizationId!;

  const perms = await getUserPermissions(session.user.id, orgId);
  const canApprove = perms.includes("inventory:approve") || perms.includes("*");
  const canManage = perms.includes("inventory:manage") || perms.includes("*");
  const canRequest = perms.includes("inventory:request") || perms.includes("*");

  const [requests, allocations, warehouses] = await Promise.all([
    getStockRequests(),
    getStaffAllocations(),
    getWarehouses(),
  ]);

  const limits = canManage ? await getStaffStockLimits() : [];

  // Staff list for limit management (members with inventory:request permission)
  const staffMembers = canManage
    ? await db
        .select({ userId: member.userId, name: user.name, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, orgId))
    : [];

  return (
    <StockRequestsClient
      requests={requests}
      allocations={allocations}
      limits={limits}
      warehouses={warehouses}
      staffMembers={staffMembers}
      permissions={perms}
      canApprove={canApprove}
      canManage={canManage}
      canRequest={canRequest}
    />
  );
}
