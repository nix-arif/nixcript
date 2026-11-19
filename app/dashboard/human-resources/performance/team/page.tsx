import { redirect } from "next/navigation";
import { getCachedSession } from "@/lib/auth/cached-session";

// Signed in is enough here: what a person sees is decided by the reviews they are named on (see lib/performance/service.ts)
async function requireSignedIn() {
  const session = await getCachedSession();
  if (!session) redirect("/login");
  if (!session.session.activeOrganizationId) redirect("/dashboard");
}
import { getTeamReviews } from "@/server/performance";
import { ReviewsListClient } from "../reviews-list-client";

export default async function TeamReviewsPage() {
  await requireSignedIn();
  return <ReviewsListClient rows={await getTeamReviews()} variant="team" />;
}
