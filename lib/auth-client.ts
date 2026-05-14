import { createAuthClient } from "better-auth/react";
import { adminClient, organizationClient } from "better-auth/client/plugins";
import type { Session } from "@/lib/auth";

// import type { auth } from "./auth";

export const authClient = createAuthClient({
  /** The base URL of the server (optional if you're using the same domain) */
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin // uses whatever URL the browser is on
      : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  plugins: [
    adminClient(),
    organizationClient({
      dynamicAccessControl: {
        enabled: true,
      },
    }),
  ],
});

export const { signIn, signUp } = createAuthClient();

export const useSession = () => {
  return authClient.useSession() as {
    data: Session | null;
    refetch: () => Promise<void>;
  };
};
