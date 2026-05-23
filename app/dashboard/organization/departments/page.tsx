import { requirePermission } from "@/lib/auth/require-permission";
import { getDepartments } from "@/server/departments";
import { DepartmentsClient } from "./departments-client";

export default async function DepartmentsPage() {
  await requirePermission("department:read");
  const departments = await getDepartments();
  return <DepartmentsClient departments={departments} />;
}
