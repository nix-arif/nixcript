import { requirePermission } from "@/lib/auth/require-permission";
import { getOpenSosForPr, getOrgDeliveryAddresses } from "@/server/purchase-requisition";
import { CreatePrClient } from "./create-pr-client";

interface Props {
  searchParams: Promise<{ soId?: string }>;
}

export default async function CreatePrPage({ searchParams }: Props) {
  const session = await requirePermission("purchase-requisition:create");
  const { soId } = await searchParams;
  const [openSos, orgAddresses] = await Promise.all([
    getOpenSosForPr().catch(() => []),
    getOrgDeliveryAddresses().catch(() => ({ companyAddress: null, warehouseAddresses: [] })),
  ]);
  return (
    <CreatePrClient
      initialSoId={soId}
      openSos={openSos}
      currentUserName={session.user.name ?? ""}
      orgAddresses={orgAddresses}
    />
  );
}
