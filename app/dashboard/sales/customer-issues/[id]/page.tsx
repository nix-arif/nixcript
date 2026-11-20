import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerIssueDetail } from "@/server/post-delivery";
import { IssueDetailClient } from "./issue-detail-client";

export default async function CustomerIssuePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customer-issue:read");
  const { id } = await params;
  const issue = await getCustomerIssueDetail(id);
  if (!issue) notFound();
  return <IssueDetailClient issue={issue} />;
}
