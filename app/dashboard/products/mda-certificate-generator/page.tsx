import { MdaCertGeneratorClient } from "./mda-cert-generator-client";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function MdaCertificateGeneratorPage() {
  await requirePermission("product:read");
  return <MdaCertGeneratorClient />;
}
