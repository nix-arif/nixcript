import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getSupplierClaimDetail } from "@/server/post-delivery";
import { ClaimDetailClient } from "./claim-detail-client";

export default async function SupplierClaimPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("supplier-claim:read");
  const { id } = await params;
  const claim = await getSupplierClaimDetail(id);
  if (!claim) notFound();
  return <ClaimDetailClient claim={claim} />;
}
