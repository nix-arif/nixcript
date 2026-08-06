import { requirePermission } from "@/lib/auth/require-permission";
import { getGlossaryIndex } from "@/server/products";
import { GlossaryClient } from "./glossary-client";

export default async function ProductGlossaryPage() {
  await requirePermission("product:read");
  const index = await getGlossaryIndex();
  return <GlossaryClient index={index} />;
}
