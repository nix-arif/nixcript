"use client";

import dynamic from "next/dynamic";

const CertificateMatcher = dynamic(
  () => import("./matcher-client").then((m) => m.CertificateMatcher),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-sm text-muted-foreground">Loading...</div>
    ),
  },
);

export function MatcherLoader() {
  return <CertificateMatcher />;
}
