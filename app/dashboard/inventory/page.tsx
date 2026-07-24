import { requirePermission } from "@/lib/auth/require-permission";
import { getInventory, getWarehouses, getExpiringLots } from "@/server/inventory";
import { getActiveConsignmentItems } from "@/server/consignment";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getFieldReps } from "@/server/field-stock";
import { InventoryClient } from "./inventory-client";
import { db } from "@/db";
import { member } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export default async function InventoryPage() {
  const session = await requirePermission("inventory:read");
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const [inventory, warehouses, fieldReps, permissions, activeConsignments, expiringLots, ownerCheck] = await Promise.all([
    getInventory(),
    getWarehouses(),
    getFieldReps().catch(() => []),
    getUserPermissions(userId, orgId),
    getActiveConsignmentItems().catch(() => []),
    getExpiringLots().catch(() => []),
    db.select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId), eq(member.role, "owner"), isNull(member.deletedAt)))
      .limit(1),
  ]);

  const isOwner = ownerCheck.length > 0;
  const allWarehouses = [
    ...warehouses,
    ...fieldReps
      .filter((r) => !warehouses.find((w) => w.label === `Field:${r.id}`))
      .map((r) => ({ label: `Field:${r.id}`, address: r.name })),
  ];

  return <InventoryClient inventory={inventory} warehouses={allWarehouses} permissions={permissions} isOwner={isOwner} activeConsignments={activeConsignments} expiringLots={expiringLots} />;
}
