import { getProfile } from "@/server/profile";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const profileData = await getProfile();

  return (
    <div>
      <ProfileClient
        user={{
          id: session!.user.id,
          name: session!.user.name,
          email: session!.user.email,
        }}
        initialProfile={profileData}
      />
    </div>
  );
}
