import { auth } from "@/lib/auth";
import { headers } from "next/headers";

await auth.api.hasPermission({
  headers: await headers(),
  body: {
    permissions: {
      project: ["create"],
    },
  },
});
