import { getDepartments } from "@/server/departments";
import { RolesClient } from "./roles-client";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function RolesPage() {
  await requirePermission("organization-role:update");
  const departments = await getDepartments();
  return <RolesClient departments={departments} />;
}
