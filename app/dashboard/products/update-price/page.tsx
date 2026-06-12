import { requirePermission } from "@/lib/auth/require-permission";
import { UpdatePriceClient } from "./update-price-client";

export default async function UpdatePricePage() {
  await requirePermission("product:update-price");
  return <UpdatePriceClient />;
}
