import { requirePermission } from "@/lib/auth/require-permission";
import { ItemTrackingClient } from "./item-tracking-client";

export default async function ItemTrackingPage() {
  await requirePermission("purchase-order:read:centralized");
  return <ItemTrackingClient />;
}
