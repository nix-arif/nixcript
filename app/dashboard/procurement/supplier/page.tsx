import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers } from "@/server/supplier";
import { SupplierClient } from "./supplier-client";

export default async function SupplierPage() {
  await requirePermission("supplier:read");
  const suppliers = await getSuppliers();
  return <SupplierClient initialSuppliers={suppliers} />;
}
