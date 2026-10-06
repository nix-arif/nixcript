import { readFile } from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { MANUALS } from "@/lib/manuals";
import { TESTING_MODE } from "@/lib/testing-mode";

// Manuals are plain HTML outside the app layout, so the testing deployment
// adds its red bar here.
const TESTING_BAR = `<div style="position:sticky;top:0;z-index:999;background:#dc2626;color:#fff;font:700 12px system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;text-align:center;padding:6px 12px">&#9873; Testing mode &#9873;</div>`;

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
  let html = await readFile(path.join(process.cwd(), "manuals", manual.file), "utf8");
  if (TESTING_MODE) html = html.replace(/<body([^>]*)>/, `<body$1>${TESTING_BAR}`);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // private to this user's browser — never stored by shared caches
      "Cache-Control": "private, no-store",
    },
  });
}
