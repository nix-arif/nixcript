import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomers } from "@/server/customer";
import {
  getOrgMembersForQuotation,
  generateQuotationNo,
} from "@/server/quotation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NewQuotationClient } from "./new-quotation-client";

export default async function NewQuotationPage() {
  await requirePermission("quotation:create");

  const session = await auth.api.getSession({ headers: await headers() });
  const orgId = session?.session.activeOrganizationId ?? "";

  const [customers, members, quotationNo] = await Promise.all([
    getCustomers(),
    getOrgMembersForQuotation(),
    generateQuotationNo(orgId),
  ]);

  return (
    <NewQuotationClient
      customers={customers}
      members={members}
      quotationNo={quotationNo}
      currentUserId={session?.user.id ?? ""}
      currentUserName={session?.user.name ?? ""}
    />
  );
}
