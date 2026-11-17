import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { getSponsorshipDetail } from "@/server/sponsorship";
import { SponsorshipDetailClient } from "./sponsorship-detail-client";

export default async function SponsorshipPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(["sponsorship:read:own", "sponsorship:check", "sponsorship:approve", "sponsorship:manage"]);
  const { id } = await params;
  const d = await getSponsorshipDetail(id);
  if (!d) notFound();
  return <SponsorshipDetailClient d={d} />;
}
