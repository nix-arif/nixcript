import { ProductSearch } from "./product-search-client";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function ProductSearchPage() {
  await requirePermission("product:read");
  return <ProductSearch />;
}
