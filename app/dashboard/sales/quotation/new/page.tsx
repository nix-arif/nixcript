import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomers } from "@/server/customer";
import {
  getOrgMembersForQuotation,
  peekNextQuotationNo,
  getOwnerOrganizations,
} from "@/server/quotation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NewQuotationClient } from "./new-quotation-client";

export default async function NewQuotationPage() {
  await requirePermission("quotation:create");

  const session = await auth.api.getSession({ headers: await headers() });
  const orgId = session?.session.activeOrganizationId ?? "";

  const [customers, members, quotationNo, ownerOrgs] = await Promise.all([
    getCustomers(),
    getOrgMembersForQuotation(),
    peekNextQuotationNo(orgId),
    getOwnerOrganizations(),
  ]);

  return (
    <NewQuotationClient
      customers={customers}
      members={members}
      quotationNo={quotationNo}
      currentUserId={session?.user.id ?? ""}
      currentUserName={session?.user.name ?? ""}
      ownerOrgs={ownerOrgs}
      activeOrgId={orgId}
    />
  );
}
