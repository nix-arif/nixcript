import { requirePermission } from "@/lib/auth/require-permission";
import { getMyTravelForms } from "@/server/travel-form";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { MyTravelClient } from "./my-travel-client";

export default async function MyTravelPage() {
  const session = await requirePermission("travel:read:own");
  const [travelForms, permissions] = await Promise.all([
    getMyTravelForms(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  return <MyTravelClient travelForms={travelForms} permissions={permissions} />;
}
