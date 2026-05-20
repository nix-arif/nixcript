import { cache } from "react";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

// Deduplicated per request — all server functions calling this
// within the same render share one DB lookup instead of N.
export const getCachedSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
