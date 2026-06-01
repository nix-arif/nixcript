import { requirePermission } from "@/lib/auth/require-permission";
import { getPendingMovements } from "@/server/inventory";
import { InventoryApprovalsClient } from "./inventory-approvals-client";

export default async function InventoryApprovalsPage() {
  await requirePermission("inventory:approve");
  const pending = await getPendingMovements();
  return <InventoryApprovalsClient pending={pending} />;
}
