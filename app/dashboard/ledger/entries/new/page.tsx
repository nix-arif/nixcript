import { requirePermission } from "@/lib/auth/require-permission";
import { getLedgerReferenceData, getLedgerEntry } from "@/server/ledger";
import { NewEntryClient } from "./new-entry-client";

// ?draftId=<id> reopens a saved draft entry in this form (the form switches to
// that address after its first "Save as Draft", so a reload keeps the draft).
// Only a DRAFT is loaded — a posted or void entry's figures can't be edited.
export default async function NewLedgerEntryPage({ searchParams }: { searchParams: Promise<{ draftId?: string }> }) {
  await requirePermission("account:create");
  const { draftId } = await searchParams;
  const [refData, entry] = await Promise.all([
    getLedgerReferenceData(),
    draftId ? getLedgerEntry(draftId).catch(() => null) : Promise.resolve(null),
  ]);
  const draft = entry?.status === "DRAFT" ? entry : null;
  return <NewEntryClient refData={refData} draft={draft} />;
}
