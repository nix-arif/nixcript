import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { getCachedSession } from "@/lib/auth/cached-session";

// Signed in is enough here: what a person sees is decided by the reviews they are named on (see lib/performance/service.ts)
async function requireSignedIn() {
  const session = await getCachedSession();
  if (!session) redirect("/login");
  if (!session.session.activeOrganizationId) redirect("/dashboard");
}
import { getReviewView, getEligibleEmployees } from "@/server/performance";
import { ReviewFormClient } from "./review-form-client";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSignedIn();
  const { id } = await params;
  const view = await getReviewView(id);
  if (!view) notFound();
  // HR can change the reviewer, so it needs the list of people
  const people = view.role === "hr" ? await getEligibleEmployees() : [];
  return <ReviewFormClient view={view} people={people} />;
}
