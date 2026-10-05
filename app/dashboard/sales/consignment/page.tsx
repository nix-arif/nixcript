import { redirect } from "next/navigation";

// Superseded by the Consignment module (one flow for agents and customers).
export default function SalesConsignmentPage() {
  redirect("/dashboard/consignment");
}
