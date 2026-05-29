import { requirePermission } from "@/lib/auth/require-permission";
import { getClaimTypes } from "@/server/claim";
import { ClaimTypesClient } from "./claim-types-client";

export default async function ClaimTypesPage() {
  await requirePermission("claim:manage");
  const claimTypes = await getClaimTypes();
  return <ClaimTypesClient claimTypes={claimTypes} />;
}
