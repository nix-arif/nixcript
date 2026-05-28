import { requirePermission } from "@/lib/auth/require-permission";
import { getLedgerReferenceData } from "@/server/ledger";
import { NewEntryClient } from "./new-entry-client";

export default async function NewLedgerEntryPage() {
  await requirePermission("account:create");
  const refData = await getLedgerReferenceData();
  return <NewEntryClient refData={refData} />;
}
