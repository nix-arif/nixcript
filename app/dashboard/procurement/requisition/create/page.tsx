import { requirePermission } from "@/lib/auth/require-permission";
import { getOpenSosForPr } from "@/server/purchase-requisition";
import { CreatePrClient } from "./create-pr-client";

interface Props {
  searchParams: Promise<{ soId?: string }>;
}

export default async function CreatePrPage({ searchParams }: Props) {
  await requirePermission("purchase-order:create");
  const { soId } = await searchParams;
  const openSos = await getOpenSosForPr().catch(() => []);
  return <CreatePrClient initialSoId={soId} openSos={openSos} />;
}
