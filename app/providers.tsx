// app/providers.tsx
"use client";

import { AppStoreProvider } from "@/lib/store/app-store-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return <AppStoreProvider>{children}</AppStoreProvider>;
}
