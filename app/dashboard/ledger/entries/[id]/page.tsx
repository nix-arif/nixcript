import { requirePermission } from "@/lib/auth/require-permission";
import { getLedgerEntry } from "@/server/ledger";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { notFound } from "next/navigation";
import { EntryDetailClient } from "./entry-detail-client";

export default async function LedgerEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("account:read");
  const { id } = await params;
  const [entry, permissions] = await Promise.all([
    getLedgerEntry(id),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
  ]);
  if (!entry) notFound();
  return <EntryDetailClient entry={entry} permissions={permissions} />;
}
