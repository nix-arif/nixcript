import { requirePermission } from "@/lib/auth/require-permission";
import { getStockMovements, getWarehouses } from "@/server/inventory";
import { getFieldReps } from "@/server/field-stock";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { MovementsClient } from "./movements-client";
import { db } from "@/db";
import { member } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export default async function MovementsPage() {
  const session = await requirePermission("inventory:read");
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const [movements, warehouses, fieldReps, permissions, ownerCheck] = await Promise.all([
    getStockMovements(),
    getWarehouses(),
    getFieldReps().catch(() => []),
    getUserPermissions(userId, orgId),
    db.select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId), eq(member.role, "owner"), isNull(member.deletedAt)))
      .limit(1),
  ]);

  const isOwner = ownerCheck.length > 0;

  // Merge configured warehouses with virtual field warehouses (Field:{repId})
  const fieldWarehouses = fieldReps.map(rep => ({ label: `Field:${rep.id}`, address: rep.name }));
  const allWarehouses = [
    ...warehouses,
    ...fieldWarehouses.filter(fw => !warehouses.find(w => w.label === fw.label)),
  ];

  return <MovementsClient movements={movements} warehouses={allWarehouses} permissions={permissions} isOwner={isOwner} />;
}
