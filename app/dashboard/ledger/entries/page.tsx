import { requirePermission } from "@/lib/auth/require-permission";
import { getLedgerEntries } from "@/server/ledger";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { LedgerEntriesClient } from "./entries-client";

export default async function LedgerEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("account:read");
  const [entries, permissions, { q }] = await Promise.all([
    getLedgerEntries(),
    getUserPermissions(session.user.id, session.session.activeOrganizationId!),
    searchParams,
  ]);
  return <LedgerEntriesClient entries={entries} permissions={permissions} initialSearch={q ?? ""} />;
}
