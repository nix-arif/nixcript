import { requirePermission } from "@/lib/auth/require-permission";
import { ItemsPriceClient } from "./items-price-client";

export default async function ItemsPricePage() {
  await requirePermission("product:read");
  return <ItemsPriceClient />;
}
