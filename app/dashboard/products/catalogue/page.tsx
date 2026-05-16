import { CatalogueGenerator } from "./catalogue-client";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function CataloguePage() {
  await requirePermission("product:read");
  return <CatalogueGenerator />;
}
