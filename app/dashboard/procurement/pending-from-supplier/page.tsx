import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingFromSupplier } from "@/server/pending-from-supplier";
import { PendingFromSupplierClient } from "./pending-from-supplier-client";

// What suppliers still owe this company — see server/pending-from-supplier.ts.
export default async function PendingFromSupplierPage() {
  await requirePermission("purchase-order:read");
  const lines = await getPendingFromSupplier();
  return <PendingFromSupplierClient lines={lines} />;
}
