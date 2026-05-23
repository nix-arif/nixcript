import { requirePermission } from "@/lib/auth/require-permission";
import { CreateCustomerPoClient } from "./create-customer-po-client";

export default async function CreateCustomerPoPage() {
  await requirePermission("customer-po:create");
  return <CreateCustomerPoClient />;
}
