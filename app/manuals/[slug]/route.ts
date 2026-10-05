import { readFile } from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { MANUALS } from "@/lib/manuals";

// Signed-in users only: anyone else goes to the sign-in page and comes back here.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    // relative, so it follows whatever host the browser used
    return new Response(null, { status: 302, headers: { Location: `/auth/login?next=${encodeURIComponent(`/manuals/${slug}`)}` } });
  }
  const manual = MANUALS.find((m) => m.slug === slug);
  if (!manual) return new Response("Manual not found", { status: 404 });
  const html = await readFile(path.join(process.cwd(), "manuals", manual.file), "utf8");
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // private to this user's browser — never stored by shared caches
      "Cache-Control": "private, no-store",
    },
  });
}
