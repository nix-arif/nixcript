import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingFromSupplierCentralized } from "@/server/pending-from-supplier";
import { PendingFromSupplierClient } from "../pending-from-supplier-client";

// What suppliers still owe, across every company the owner holds.
export default async function CentralizedPendingFromSupplierPage() {
  await requirePermission("purchase-order:read:centralized");
  const lines = await getPendingFromSupplierCentralized();
  return <PendingFromSupplierClient lines={lines} centralized />;
}
