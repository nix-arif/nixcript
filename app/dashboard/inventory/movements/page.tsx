import { requirePermission } from "@/lib/auth/require-permission";
import { getStockMovements, getWarehouses, getInventoryLocationNames } from "@/server/inventory";
import { getFieldLocations } from "@/server/field-stock";
import { getConsignedInMovements } from "@/server/consign";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { MovementsClient } from "./movements-client";
import { db } from "@/db";
import { member, product } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ new?: string; location?: string; product?: string }> }) {
  const sp = await searchParams;
  const session = await requirePermission("inventory:read");
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const [movements, warehouses, fieldReps, permissions, ownerCheck, locationNames, consignedIn] = await Promise.all([
    getStockMovements(),
    getWarehouses(),
    getFieldLocations().catch(() => []),
    getUserPermissions(userId, orgId),
    db.select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId), eq(member.role, "owner"), isNull(member.deletedAt)))
      .limit(1),
    getInventoryLocationNames().catch(() => ({})),
    getConsignedInMovements().catch(() => []),
  ]);

  const isOwner = ownerCheck.length > 0;

  // Merge configured warehouses with virtual field warehouses (Field:{repId}) —
  // this company's own people only (plus any leftover balance to clear)
  const fieldWarehouses = fieldReps;
  const allWarehouses = [
    ...warehouses,
    ...fieldWarehouses.filter(fw => !warehouses.find(w => w.label === fw.label)),
  ];

  // Stock sister companies consigned to us moves on THEIR ledger — shown
  // alongside ours (read-only, tagged with the owner), newest first.
  const allMovements = [...movements, ...consignedIn].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  // "Adjust quantity" from Stock Overview: open New Movement on that location and item
  let prefill: { location: string; productId: string; productLabel: string } | undefined;
  if (sp.new && sp.location && sp.product && allWarehouses.some((w) => w.label === sp.location)) {
    const [p] = await db.select({ code: product.productCode, description: product.description }).from(product).where(eq(product.id, sp.product)).limit(1);
    if (p) prefill = { location: sp.location, productId: sp.product, productLabel: `${p.code}${p.description ? ` — ${p.description}` : ""}` };
  }

  return <MovementsClient movements={allMovements} warehouses={allWarehouses} permissions={permissions} isOwner={isOwner} locationNames={locationNames} prefill={prefill} />;
}
