import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliersForIssue } from "@/server/post-delivery";
import { IssueFormClient } from "../issue-form-client";

export default async function NewCustomerIssuePage() {
  await requirePermission("customer-issue:create");
  return <IssueFormClient suppliers={await getSuppliersForIssue()} />;
}
