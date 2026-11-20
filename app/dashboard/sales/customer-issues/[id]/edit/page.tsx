import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerIssueDetail, getSuppliersForIssue } from "@/server/post-delivery";
import { IssueFormClient } from "../../issue-form-client";

export default async function EditCustomerIssuePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customer-issue:update");
  const { id } = await params;
  const [issue, suppliers] = await Promise.all([getCustomerIssueDetail(id), getSuppliersForIssue()]);
  if (!issue) notFound();
  return <IssueFormClient suppliers={suppliers} issue={issue} />;
}
