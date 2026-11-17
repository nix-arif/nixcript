import { requirePermission } from "@/lib/auth/require-permission";
import { getMyReviews } from "@/server/performance";
import { ReviewsListClient } from "./reviews-list-client";

export default async function MyReviewsPage() {
  await requirePermission("review:read:own");
  return <ReviewsListClient rows={await getMyReviews()} variant="mine" />;
}
