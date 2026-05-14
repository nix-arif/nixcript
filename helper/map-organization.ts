import { authClient } from "@/lib/auth-client";

type BetterAuthOrg = NonNullable<
  ReturnType<typeof authClient.useActiveOrganization>["data"]
>;

type Organization = {
  id: string;
  name: string;
  logo: string | null;
};

export function mapOrganization(org: BetterAuthOrg): Organization {
  return {
    id: org.id,
    name: org.name,
    logo: org.logo ?? null, // 🔥 fix utama
  };
}
