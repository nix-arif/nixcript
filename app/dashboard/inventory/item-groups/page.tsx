import { requirePermission } from "@/lib/auth/require-permission";
import { getItemGroupPage } from "@/server/item-group";
import { ItemGroupsClient } from "./item-groups-client";

export default async function ItemGroupsPage() {
  await requirePermission("inventory:read");
  const data = await getItemGroupPage();
  return <ItemGroupsClient data={data} />;
}
