import { requirePermission } from "@/lib/auth/require-permission";
import { UploadImagesClient } from "./upload-images-client";

export default async function UploadImagesPage() {
  await requirePermission("product:upload-image");
  return <UploadImagesClient />;
}
