import { getFullOrganizationProfile } from "@/server/organization-profile";
import { DocumentSettingsClient } from "./document-settings-client";
import { redirect } from "next/navigation";

export default async function DocumentSettingsPage() {
  let data;
  try {
    data = await getFullOrganizationProfile();
  } catch {
    redirect("/dashboard");
  }

  return <DocumentSettingsClient data={data} />;
}
