import { PictureRefClient } from "./picture-ref-client";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function PictureRefPage() {
  await requirePermission("product:read");
  return <PictureRefClient />;
}
