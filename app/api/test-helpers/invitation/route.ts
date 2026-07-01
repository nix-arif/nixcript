import { db } from "@/db";
import { invitation } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { NextRequest } from "next/server";

// Returns the latest pending invitation ID for a given email.
// Only available in development — used by Playwright E2E tests to accept
// invitations without needing real email delivery.
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const email = new URL(request.url).searchParams.get("email");
  if (!email) return Response.json({ id: null, error: "email param required" }, { status: 400 });

  const [inv] = await db
    .select({ id: invitation.id, status: invitation.status, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(and(eq(invitation.email, email), eq(invitation.status, "pending")))
    .orderBy(desc(invitation.createdAt))
    .limit(1);

  return Response.json({ id: inv?.id ?? null });
}
