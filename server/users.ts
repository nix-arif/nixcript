// @/server/users.ts
"use server";

import { db } from "@/db";
import { user } from "@/db/schema";
import { mapUser } from "@/helper/map-user";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const getCurrentUser = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/auth/login");
  }

  return {
    ...session,
    user: mapUser(session.user),
  };
};

export const signIn = async (email: string, password: string) => {
  console.log(email);
  try {
    await auth.api.signInEmail({
      body: {
        email,
        password,
      },
    });
    return { success: true, message: "Sign in successfully" };
  } catch (error) {
    const e = error as Error;
    console.log(e);
    return {
      success: false,
      message: e.message || "An unknown error occurred.",
    };
  }
};

export const signUp = async (name: string, email: string, password: string) => {
  try {
    await auth.api.signUpEmail({
      body: {
        name,
        email,
        password,
      },
    });
    return { success: true, message: "Registered successfully." };
  } catch (error) {
    const e = error as Error;
    return {
      success: false,
      message: e.message || "An unknown error occurred.",
    };
  }
};
