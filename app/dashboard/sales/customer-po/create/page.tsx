import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers } from "@/server/members";
import { CreateCustomerPoClient } from "./create-customer-po-client";
import { categoriesOfOrgs } from "@/lib/document-category/inherit";

export default async function CreateCustomerPoPage() {
  const session = await requirePermission("customer-po:create");
  const members = await getOrgMembers().catch(() => []);
  // this company's categories, to pick from (the quotation's are picked to begin with)
  const categories = await categoriesOfOrgs([session.session.activeOrganizationId!]);
  return <CreateCustomerPoClient members={members} currentUserName={session.user.name ?? ""} categories={categories} />;
}
