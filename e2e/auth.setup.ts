import { test as setup } from "@playwright/test";
import path from "path";

const SESSION_FILE = path.join(__dirname, ".auth/session.json");

setup("authenticate", async ({ page, request }) => {
  const email    = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;

  if (!email || !password) {
    throw new Error("TEST_EMAIL and TEST_PASSWORD must be set in .env.local");
  }

  // Call better-auth sign-in API directly — bypasses React Hook Form entirely
  const res = await request.post("http://localhost:3000/api/auth/sign-in/email", {
    data: { email, password },
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Login API returned ${res.status()}: ${body}\n` +
      `Check TEST_EMAIL / TEST_PASSWORD in .env.local`,
    );
  }

  // Save the session cookies from the API response into the browser context
  const cookies = res.headers()["set-cookie"];
  if (cookies) {
    const parsed = cookies.split(",").map((c) => {
      const [nameVal, ...rest] = c.trim().split(";");
      const [name, value] = nameVal.split("=");
      return { name: name.trim(), value: value?.trim() ?? "", domain: "localhost", path: "/" };
    });
    await page.context().addCookies(parsed);
  }

  await page.context().storageState({ path: SESSION_FILE });
  console.log("✓ Authenticated via API, session saved");
});
