import { requirePermission } from "@/lib/auth/require-permission";
import { getTeamReviews } from "@/server/performance";
import { ReviewsListClient } from "../reviews-list-client";

export default async function TeamReviewsPage() {
  await requirePermission("review:conduct");
  return <ReviewsListClient rows={await getTeamReviews()} variant="team" />;
}
