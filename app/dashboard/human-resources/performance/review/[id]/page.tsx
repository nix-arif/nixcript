import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { getReviewView, getEligibleEmployees } from "@/server/performance";
import { ReviewFormClient } from "./review-form-client";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(["review:read:own", "review:conduct", "review:manage"]);
  const { id } = await params;
  const view = await getReviewView(id);
  if (!view) notFound();
  // HR can change the reviewer, so it needs the list of people
  const people = view.role === "hr" ? await getEligibleEmployees() : [];
  return <ReviewFormClient view={view} people={people} />;
}
