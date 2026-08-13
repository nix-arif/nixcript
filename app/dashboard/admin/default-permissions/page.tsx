import { requirePermission } from "@/lib/auth/require-permission";
import { getDefaultPermissionKeys, getSensitivePermissionKeys } from "@/server/default-permissions";
import { DefaultPermissionsClient } from "./default-permissions-client";

export default async function DefaultPermissionsPage() {
  await requirePermission("permission:read");
  const [defaultKeys, sensitiveKeys] = await Promise.all([
    getDefaultPermissionKeys(),
    getSensitivePermissionKeys(),
  ]);

  return <DefaultPermissionsClient defaultKeys={defaultKeys} sensitiveKeys={sensitiveKeys} />;
}
