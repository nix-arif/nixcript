import { requirePermission } from "@/lib/auth/require-permission";
import { getConsignments } from "@/server/consignment";
import { ConsignmentListClient } from "./consignment-list-client";

export default async function ConsignmentPage() {
  await requirePermission("sales-order:read");
  const consignments = await getConsignments();
  return <ConsignmentListClient initialConsignments={consignments} />;
}
