import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { CustomerPoClient } from "./customer-po-client";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documentCategory } from "@/db/schema";

export default async function CustomerPoPage() {
  const session = await getCachedSession();
  if (!session) redirect("/login");
  const perms = await getUserPermissions(session.user.id, session.session.activeOrganizationId ?? "");
  if (!perms.includes("*") && !perms.includes("customer-po:read")) redirect("/dashboard");
  const pos = await getCustomerPos();
  const canCreateSo = perms.includes("*") || perms.includes("sales-order:create");
  // this company's categories, for the filter chips
  const categories = await db
    .select({ id: documentCategory.id, name: documentCategory.name, color: documentCategory.color })
    .from(documentCategory)
    .where(eq(documentCategory.organizationId, session.session.activeOrganizationId ?? ""))
    .orderBy(asc(documentCategory.position), asc(documentCategory.createdAt));
  return <CustomerPoClient initialPos={pos} canCreateSo={canCreateSo} categories={categories} />;
}
