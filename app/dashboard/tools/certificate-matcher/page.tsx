// app/dashboard/tools/certificate-matcher/page.tsx
import { requirePermission } from "@/lib/auth/require-permission";
import { MatcherLoader } from "./matcher-loader";

export default async function CertificateMatcherPage() {
  await requirePermission("permission:read");

  return (
    <div className="-m6">
      <MatcherLoader />
    </div>
  );
}
