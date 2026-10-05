import { requirePermission } from "@/lib/auth/require-permission";
import { getInventory, getWarehouses, getExpiringLots, getInventoryLocationNames } from "@/server/inventory";
import { getActiveConsignmentItems } from "@/server/consignment";
import { getConsignedInStock, getConsignMoveTargets } from "@/server/consign";
import { getItemGroups } from "@/server/item-group";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getFieldLocations } from "@/server/field-stock";
import { InventoryClient } from "./inventory-client";
import { db } from "@/db";
import { member } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export default async function InventoryPage() {
  const session = await requirePermission("inventory:read");
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const [inventory, warehouses, fieldReps, permissions, activeConsignments, expiringLots, ownerCheck, locationNames, consignedIn, consignMove, itemGroups] = await Promise.all([
    getInventory(),
    getWarehouses(),
    getFieldLocations().catch(() => []),
    getUserPermissions(userId, orgId),
    getActiveConsignmentItems().catch(() => []),
    getExpiringLots().catch(() => []),
    db.select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId), eq(member.role, "owner"), isNull(member.deletedAt)))
      .limit(1),
    getInventoryLocationNames().catch(() => ({})),
    getConsignedInStock().catch(() => []),
    getConsignMoveTargets().catch(() => ({ canMove: false, targets: [] })),
    getItemGroups().catch(() => []),
  ]);

  const isOwner = ownerCheck.length > 0;
  const allWarehouses = [
    ...warehouses,
    // this company's own people only (plus any leftover balance to clear)
    ...fieldReps.filter((r) => !warehouses.find((w) => w.label === r.label)),
  ];

  return <InventoryClient inventory={inventory} warehouses={allWarehouses} permissions={permissions} isOwner={isOwner} activeConsignments={activeConsignments} expiringLots={expiringLots} locationNames={locationNames} consignedIn={consignedIn} consignMove={consignMove} itemGroups={itemGroups} />;
}
