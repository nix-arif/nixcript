import { requirePermission } from "@/lib/auth/require-permission";
import { getConsignmentSettings } from "@/server/consign";
import { ConsignmentSettingsClient } from "./settings-client";

export default async function ConsignmentSettingsPage() {
  await requirePermission("consignment:read");
  const settings = await getConsignmentSettings();
  return <ConsignmentSettingsClient settings={settings} />;
}
