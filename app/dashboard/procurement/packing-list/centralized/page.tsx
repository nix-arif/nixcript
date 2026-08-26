import { requirePermission } from "@/lib/auth/require-permission";
import { getPackingListsCentralized } from "@/server/packing-list";
import { CentralizedPackingListClient } from "./centralized-packing-list-client";

export default async function CentralizedPackingListPage() {
  await requirePermission("packing-list:read:centralized");
  const lists = await getPackingListsCentralized();
  return <CentralizedPackingListClient initialLists={lists} />;
}
