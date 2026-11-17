import { requirePermission } from "@/lib/auth/require-permission";
import { getAllSponsorships } from "@/server/sponsorship";
import { SponsorshipListClient } from "../sponsorship-list-client";

export default async function Page() {
  await requirePermission("sponsorship:manage");
  return <SponsorshipListClient rows={await getAllSponsorships()} variant="all" />;
}
