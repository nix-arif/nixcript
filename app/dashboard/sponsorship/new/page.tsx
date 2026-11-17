import { requirePermission } from "@/lib/auth/require-permission";
import { SponsorshipFormClient } from "../sponsorship-form-client";

export default async function NewSponsorshipPage() {
  await requirePermission("sponsorship:read:own");
  return <SponsorshipFormClient />;
}
