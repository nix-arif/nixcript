import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomers } from "@/server/customer";
import {
  getOrgMembersForQuotation,
  peekNextQuotationNo,
  getOwnerOrganizations,
} from "@/server/quotation";
import { getDocumentCategories } from "@/server/document-category";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NewQuotationClient } from "./new-quotation-client";

export default async function NewQuotationPage() {
  await requirePermission("quotation:create");

  const session = await auth.api.getSession({ headers: await headers() });
  const orgId = session?.session.activeOrganizationId ?? "";

  const [customers, members, quotationNo, ownerOrgs, categories] = await Promise.all([
    getCustomers().catch((e) => { console.error("[new-quotation] getCustomers failed:", e); throw e; }),
    getOrgMembersForQuotation().catch(() => []),
    peekNextQuotationNo(orgId).catch((e) => { console.error("[new-quotation] peekNextQuotationNo failed:", e); throw e; }),
    getOwnerOrganizations().catch((e) => { console.error("[new-quotation] getOwnerOrganizations failed:", e); throw e; }),
    getDocumentCategories().catch(() => []),
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
      categories={categories}
    />
  );
}
