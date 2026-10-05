import { db } from "@/db";
import { organizationProfile } from "@/db/schema";
import { eq } from "drizzle-orm";

// Inventory needs at least one named warehouse (Organization Profile →
// Warehouses): stock, transfers, DOs and consignments all point at a
// warehouse by its name. Until one exists the inventory pages show a set-up
// prompt instead, so stock never lands under a nameless placeholder.
export async function hasNamedWarehouse(orgId: string): Promise<boolean> {
  const [p] = await db.select({ w: organizationProfile.warehouseAddresses }).from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId)).limit(1);
  const list = (p?.w as { label?: string }[] | null) ?? [];
  return list.some((w) => !!w.label?.trim());
}
