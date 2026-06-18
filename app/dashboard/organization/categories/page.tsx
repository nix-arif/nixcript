import { requirePermission } from "@/lib/auth/require-permission";
import { getDocumentCategories } from "@/server/document-category";
import { CategoriesClient } from "./categories-client";

export default async function CategoriesPage() {
  await requirePermission("organization-profile:read");
  const categories = await getDocumentCategories().catch(() => []);
  return <CategoriesClient initialCategories={categories} />;
}
