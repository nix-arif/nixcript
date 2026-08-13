import { requirePermission } from "@/lib/auth/require-permission";
import { getActiveClaimTypes } from "@/server/claim";
import { getTravelFormForEdit } from "@/server/travel-form";
import { CLAIM_FORM } from "@/lib/claim/constants";
import { ApplyTravelClient } from "./apply-travel-client";

export default async function ApplyTravelPage({
  searchParams,
}: {
  searchParams: Promise<{ draftId?: string }>;
}) {
  await requirePermission("travel:apply");
  // Reuse the org's LOCAL claim type's per-km rate so the auto-calculated
  // estimate lines up with what the eventual expense claim will compute.
  // Falls back to a sane default if the type isn't configured or readable.
  let ratePerKm = 0.5;
  try {
    const claimTypes = await getActiveClaimTypes();
    const localType = claimTypes.find((t) => t.category === CLAIM_FORM.LOCAL);
    if (localType?.ratePerUnit) ratePerKm = parseFloat(localType.ratePerUnit);
  } catch { /* keep default rate */ }

  const { draftId } = await searchParams;
  const draft = draftId ? await getTravelFormForEdit(draftId).catch(() => null) : null;

  return <ApplyTravelClient ratePerKm={ratePerKm} draft={draft ?? undefined} />;
}
