import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getConsignment } from "@/server/consign";
import { ConsignmentDetailClient } from "./consignment-detail-client";

export default async function ConsignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("consignment:read");
  const { id } = await params;
  const data = await getConsignment(id);
  if (!data) notFound();
  return <ConsignmentDetailClient data={data} />;
}
