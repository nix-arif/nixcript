import { requirePermission } from "@/lib/auth/require-permission";
import { getSponsorshipsToApprove } from "@/server/sponsorship";
import { SponsorshipListClient } from "../sponsorship-list-client";

export default async function Page() {
  await requirePermission("sponsorship:approve");
  return <SponsorshipListClient rows={await getSponsorshipsToApprove()} variant="approve" />;
}
