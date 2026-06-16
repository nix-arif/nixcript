import { requirePermission } from "@/lib/auth/require-permission";
import { getLedgerEntry, getLedgerReferenceData } from "@/server/ledger";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { EntryDetailClient } from "./entry-detail-client";

export default async function LedgerEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("account:read");
  const { id } = await params;
  const [entry, refData, permissions] = await Promise.all([
    getLedgerEntry(id),
    getLedgerReferenceData(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  if (!entry) notFound();
  return <EntryDetailClient entry={entry} refData={refData} permissions={permissions} />;
}
