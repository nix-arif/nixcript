import { requirePermission } from "@/lib/auth/require-permission";
import { getMySponsorships } from "@/server/sponsorship";
import { SponsorshipListClient } from "./sponsorship-list-client";

export default async function MySponsorshipsPage() {
  await requirePermission("sponsorship:read:own");
  return <SponsorshipListClient rows={await getMySponsorships()} variant="mine" />;
}
