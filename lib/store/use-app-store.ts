// lib/store/use-app-store.ts
// import { create } from "zustand";

// type AppState = {
//   permissions: string[];
//   permissionsLoading: boolean;
//   currentOrgId: string | null;
//   permissionsFetched: boolean; // ← track if fetch completed

//   fetchPermissions: (organizationId: string) => Promise<void>;
//   clearPermissions: () => void;
// };

// export const useAppStore = create<AppState>((set, get) => ({
//   permissions: [],
//   permissionsLoading: false,
//   currentOrgId: null,
//   permissionsFetched: false,

//   fetchPermissions: async (organizationId: string) => {
//     // Only skip if same org AND fetch already completed successfully
//     if (
//       get().currentOrgId === organizationId &&
//       get().permissionsFetched &&
//       get().permissions.length > 0
//     )
//       return;

//     set({
//       permissionsLoading: true,
//       currentOrgId: organizationId,
//       permissionsFetched: false,
//     });

//     try {
//       const res = await fetch(
//         `/api/permissions?organizationId=${organizationId}`,
//       );
//       if (!res.ok) throw new Error("Failed to fetch permissions");
//       const data = await res.json();
//       set({
//         permissions: data.permissions ?? [],
//         permissionsLoading: false,
//         permissionsFetched: true,
//       });
//     } catch (err) {
//       console.error("Failed to load permissions:", err);
//       set({
//         permissions: [],
//         permissionsLoading: false,
//         permissionsFetched: false,
//       });
//     }
//   },

//   clearPermissions: () => {
//     set({ permissions: [], currentOrgId: null, permissionsFetched: false });
//   },
// }));

import { create } from "zustand";

type AppState = {
  permissions: string[];
  permissionsLoading: boolean;
  currentOrgId: string | null;

  fetchPermissions: (organizationId: string) => Promise<void>;
  clearPermissions: () => void;
};

export const useAppStore = create<AppState>((set, get) => ({
  permissions: [],
  permissionsLoading: false,
  currentOrgId: null,

  fetchPermissions: async (organizationId: string) => {
    // Only skip if currently loading the same org — prevents duplicate in-flight requests
    if (get().permissionsLoading && get().currentOrgId === organizationId)
      return;

    set({ permissionsLoading: true, currentOrgId: organizationId });

    try {
      const res = await fetch(
        `/api/permissions?organizationId=${organizationId}`,
      );
      if (!res.ok) throw new Error("Failed to fetch permissions");
      const data = await res.json();
      console.log("use-app-store.ts line 90", data.permission);
      set({ permissions: data.permissions ?? [], permissionsLoading: false });
    } catch (err) {
      console.error("Failed to load permissions:", err);
      set({ permissions: [], permissionsLoading: false });
    }
  },

  clearPermissions: () => {
    set({ permissions: [], currentOrgId: null, permissionsLoading: false });
  },
}));
