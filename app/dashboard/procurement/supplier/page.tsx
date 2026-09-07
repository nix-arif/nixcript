import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers, getOwnerOrganizations } from "@/server/supplier";
import { SupplierClient } from "./supplier-client";

export default async function SupplierPage() {
  await requirePermission("supplier:read");
  const [suppliers, ownerOrganizations] = await Promise.all([
    getSuppliers(),
    getOwnerOrganizations(),
  ]);
  return <SupplierClient initialSuppliers={suppliers} ownerOrganizations={ownerOrganizations} />;
}
