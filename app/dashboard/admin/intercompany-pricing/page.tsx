import { redirect } from "next/navigation";

// Pricing now lives on the Intercompany Purchasing page (Supplier Rules), under its own tabs
export default function IntercompanyPricingRedirect() {
  redirect("/dashboard/admin/supplier-rules?tab=pricing");
}
