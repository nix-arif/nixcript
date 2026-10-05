import { requirePermission } from "@/lib/auth/require-permission";
import { getStockMovements, getWarehouses, getInventoryLocationNames } from "@/server/inventory";
import { getFieldReps } from "@/server/field-stock";
import { getConsignedInMovements } from "@/server/consign";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { MovementsClient } from "./movements-client";
import { db } from "@/db";
import { member } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export default async function MovementsPage() {
  const session = await requirePermission("inventory:read");
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const [movements, warehouses, fieldReps, permissions, ownerCheck, locationNames, consignedIn] = await Promise.all([
    getStockMovements(),
    getWarehouses(),
    getFieldReps().catch(() => []),
    getUserPermissions(userId, orgId),
    db.select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId), eq(member.role, "owner"), isNull(member.deletedAt)))
      .limit(1),
    getInventoryLocationNames().catch(() => ({})),
    getConsignedInMovements().catch(() => []),
  ]);

  const isOwner = ownerCheck.length > 0;

  // Merge configured warehouses with virtual field warehouses (Field:{repId})
  const fieldWarehouses = fieldReps.map(rep => ({ label: `Field:${rep.id}`, address: rep.name }));
  const allWarehouses = [
    ...warehouses,
    ...fieldWarehouses.filter(fw => !warehouses.find(w => w.label === fw.label)),
  ];

  // Stock sister companies consigned to us moves on THEIR ledger — shown
  // alongside ours (read-only, tagged with the owner), newest first.
  const allMovements = [...movements, ...consignedIn].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return <MovementsClient movements={allMovements} warehouses={allWarehouses} permissions={permissions} isOwner={isOwner} locationNames={locationNames} />;
}
