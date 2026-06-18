import { requirePermission } from "@/lib/auth/require-permission";
import { PdfCompressClient } from "./compress-client";

export default async function PdfCompressPage() {
  await requirePermission("permission:read");
  return <PdfCompressClient />;
}
