import { requirePermission } from "@/lib/auth/require-permission";
import { getAllTravelForms } from "@/server/travel-form";
import { AllTravelClient } from "./all-travel-client";

export default async function AllTravelFormsPage() {
  await requirePermission("travel:read:all");
  const travelForms = await getAllTravelForms();
  return <AllTravelClient travelForms={travelForms} />;
}
