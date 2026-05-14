// lib/store/app-store-provider.tsx
// "use client";

// import React from "react";
// import { authClient } from "@/lib/auth-client";
// import { useAppStore } from "@/lib/store/use-app-store";

// export function AppStoreProvider({ children }: { children: React.ReactNode }) {
//   const { data: activeOrganization, isPending } =
//     authClient.useActiveOrganization();
//   const { fetchPermissions, clearPermissions, currentOrgId } = useAppStore();

//   React.useEffect(() => {
//     // Wait until Better Auth has finished loading the active org
//     if (isPending) return;

//     // No active org — clear permissions
//     if (!activeOrganization?.id) {
//       clearPermissions();
//       return;
//     }

//     // Org switched — clear before fetching new permissions
//     if (currentOrgId && currentOrgId !== activeOrganization.id) {
//       clearPermissions();
//     }

//     fetchPermissions(activeOrganization.id);
//   }, [activeOrganization?.id, isPending]);

//   return <>{children}</>;
// }

"use client";

import React from "react";
import { authClient } from "@/lib/auth-client";
import { useAppStore } from "@/lib/store/use-app-store";

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const { data: activeOrganization, isPending: isOrgPending } =
    authClient.useActiveOrganization();
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const { fetchPermissions, clearPermissions, currentOrgId } = useAppStore();

  // Clear everything when session is gone (logout)
  React.useEffect(() => {
    if (isSessionPending) return;
    if (!session) {
      clearPermissions();
    }
  }, [session, isSessionPending]);

  // Fetch permissions when org is ready
  React.useEffect(() => {
    if (isSessionPending || isOrgPending) return;
    if (!session) return;
    if (!activeOrganization?.id) return;

    // Org switched — clear before fetching
    if (currentOrgId && currentOrgId !== activeOrganization.id) {
      clearPermissions();
    }

    fetchPermissions(activeOrganization.id);
  }, [
    activeOrganization?.id,
    isOrgPending,
    isSessionPending,
    session?.user?.id,
  ]);

  return <>{children}</>;
}
