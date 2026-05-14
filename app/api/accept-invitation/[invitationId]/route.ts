import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: { invitationId: string } },
) {
  const { invitationId } = await params;
  console.log(invitationId);
  try {
    const data = await auth.api.acceptInvitation({
      body: {
        invitationId, // required
      },
      // This endpoint requires session cookies.
      headers: await headers(),
    });

    console.log(data);
    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (error) {
    console.log(error);
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
}
