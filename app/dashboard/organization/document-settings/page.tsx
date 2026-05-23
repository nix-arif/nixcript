import { getFullOrganizationProfile } from "@/server/organization-profile";
import { getDocumentNumberingSettings } from "@/server/document-numbering";
import { DocumentSettingsClient } from "./document-settings-client";
import { redirect } from "next/navigation";

export default async function DocumentSettingsPage() {
  let data;
  try {
    data = await getFullOrganizationProfile();
  } catch {
    redirect("/dashboard");
  }

  const numberingSettings = await getDocumentNumberingSettings().catch(() => []);

  return <DocumentSettingsClient data={data} numberingSettings={numberingSettings} />;
}
