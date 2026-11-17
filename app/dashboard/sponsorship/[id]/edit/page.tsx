import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getSponsorshipDetail } from "@/server/sponsorship";
import { SponsorshipFormClient } from "../../sponsorship-form-client";

export default async function EditSponsorshipPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sponsorship:read:own");
  const { id } = await params;
  const d = await getSponsorshipDetail(id);
  if (!d) notFound();
  if (!d.can.edit) redirect(`/dashboard/sponsorship/${id}`);
  return (
    <SponsorshipFormClient
      initial={{
        id: d.id, sponsorshipNo: d.sponsorshipNo, rejectReason: d.status === "REJECTED" ? d.rejectReason : null,
        recipientType: d.recipientType, recipientName: d.recipientName, recipientOrganization: d.recipientOrganization ?? "", isHcp: d.isHcp, isGovernment: d.isGovernment,
        institutionApproved: d.institutionApproved, title: d.title, purpose: d.purpose, eventDateFrom: d.eventDateFrom ?? "", eventDateTo: d.eventDateTo ?? "", venue: d.venue ?? "",
        declarationAccepted: d.declarationAccepted, items: d.items.map((i) => ({ category: i.category, description: i.description, amount: i.amount })),
      }}
    />
  );
}
