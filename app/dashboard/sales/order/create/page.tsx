import { requirePermission } from "@/lib/auth/require-permission";
import { getOrgMembers } from "@/server/members";
import { getExistingDraftSo } from "@/server/sales-order";
import { getCustomerPoForSoCreate, getOpenCustomerPos } from "@/server/customer-purchase-order";
import { getOrganizationProfile } from "@/server/organization-profile";
import { CreateSalesOrderClient } from "./create-order-client";
import { redirect } from "next/navigation";

export default async function CreateSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ cpoId?: string | string[]; draftId?: string; form?: string }>;
}) {
  const session = await requirePermission("sales-order:create");
  const currentUserName = session.user.name ?? "";

  const { cpoId, draftId, form } = await searchParams;
  const cpoIds = cpoId ? (Array.isArray(cpoId) ? cpoId : [cpoId]) : [];

  // form: the create form is open (it adds form=1 to its address as soon as it opens, before any save).
  // The page runs again inside every auto-save, and must then stay put — not go to the draft the form
  // just made, nor to the CPO's (now linked) SO — or the form reloads while being typed in. A reload
  // after its draft was made (draftId) is sent to that draft's edit page by the form itself.
  const ownDraft = form === "1" || !!draftId;

  // Only redirect to existing draft if not coming from a CPO
  if (cpoIds.length === 0 && !ownDraft) {
    const existingDraft = await getExistingDraftSo().catch(() => null);
    if (existingDraft) {
      redirect(`/dashboard/sales/order/${existingDraft.id}?draft=1`);
    }
  }

  const [members, requestedCpos, openCpos, profile] = await Promise.all([
    getOrgMembers().catch(() => []),
    Promise.all(cpoIds.map((id) => getCustomerPoForSoCreate(id).catch(() => null))).then(
      (results) => results.filter((r): r is NonNullable<typeof r> => r !== null)
    ),
    getOpenCustomerPos().catch(() => []),
    getOrganizationProfile().catch(() => null),
  ]);

  // A CPO belongs to at most one SO: one that already has a (live) SO isn't
  // linked again. Opening "Create SO" from such a CPO goes to its SO instead.
  const isTaken = (c: (typeof requestedCpos)[number]) => !!c.linkedSo && c.linkedSo.status !== "cancelled" && !ownDraft;
  if (requestedCpos.length === 1 && isTaken(requestedCpos[0])) {
    redirect(`/dashboard/sales/order/${requestedCpos[0].linkedSo!.id}`);
  }
  const cpos = requestedCpos.filter((c) => !isTaken(c));

  return (
    <CreateSalesOrderClient
      members={members}
      cpos={cpos}
      openCpos={openCpos}
      currentUserName={currentUserName}
      businessType={profile?.businessType ?? "trading"}
    />
  );
}
