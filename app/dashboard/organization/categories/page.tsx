import { requirePermission } from "@/lib/auth/require-permission";
import { getDocumentCategories, getSiblingOrganizations } from "@/server/document-category";
import { CategoriesClient } from "./categories-client";

export default async function CategoriesPage() {
  await requirePermission("organization-profile:read");
  const [categories, siblingOrgs] = await Promise.all([
    getDocumentCategories().catch(() => []),
    getSiblingOrganizations().catch(() => []),
  ]);
  return <CategoriesClient initialCategories={categories} siblingOrgs={siblingOrgs} />;
}
