import { requirePermission } from "@/lib/auth/require-permission";
import { CreateDeliveryOrderClient } from "./create-do-client";

export default async function CreateDeliveryOrderPage() {
  await requirePermission("delivery-order:create");
  return <CreateDeliveryOrderClient />;
}
