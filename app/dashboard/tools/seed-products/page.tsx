import { SeedProductsClient } from "./seed-products-client";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function SeedProductsPage() {
  await requirePermission("product:seed");
  return <SeedProductsClient />;
}
