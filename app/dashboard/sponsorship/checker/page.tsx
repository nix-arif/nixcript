import { requirePermission } from "@/lib/auth/require-permission";
import { getSponsorshipsToCheck } from "@/server/sponsorship";
import { SponsorshipListClient } from "../sponsorship-list-client";

export default async function Page() {
  await requirePermission("sponsorship:check");
  return <SponsorshipListClient rows={await getSponsorshipsToCheck()} variant="check" />;
}
