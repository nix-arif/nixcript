import { requirePermission } from "@/lib/auth/require-permission";
import { getSupplierTerms } from "@/server/post-delivery";
import { TermsClient } from "./terms-client";

export default async function ClaimTermsPage() {
  await requirePermission("supplier-claim:terms");
  return <TermsClient initial={await getSupplierTerms()} />;
}
