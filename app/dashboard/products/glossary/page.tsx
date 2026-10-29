import { requirePermission } from "@/lib/auth/require-permission";
import { getGlossaryBrands, getGlossaryIndex } from "@/server/products";
import { GlossaryClient } from "./glossary-client";

export default async function ProductGlossaryPage() {
  await requirePermission("product:read");
  const [index, brands] = await Promise.all([getGlossaryIndex(), getGlossaryBrands()]);
  return <GlossaryClient index={index} brands={brands} />;
}
