import { requirePermission } from "@/lib/auth/require-permission";
import { listPartners } from "@/server/consign";
import { PartnersClient } from "./partners-client";

export default async function ConsignmentPartnersPage() {
  await requirePermission("consignment:read");
  const data = await listPartners();
  return <PartnersClient data={data} />;
}
