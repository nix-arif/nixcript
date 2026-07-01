import { test as setup } from "@playwright/test";
import path from "path";

const SESSION_FILE = path.join(__dirname, ".auth/admin.json");

setup("authenticate as admin", async ({ page, request }) => {
  const email    = process.env.TEST_ADMIN_EMAIL ?? process.env.TEST_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD ?? process.env.TEST_PASSWORD;

  if (!email || !password) {
    throw new Error("TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD must be set in .env.local");
  }

  const res = await request.post("http://localhost:3000/api/auth/sign-in/email", {
    data: { email, password },
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Admin login failed ${res.status()}: ${body}\n` +
      `Check TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD in .env.local`,
    );
  }

  const cookies = res.headers()["set-cookie"];
  if (cookies) {
    const parsed = cookies.split(",").map((c) => {
      const [nameVal] = c.trim().split(";");
      const [name, value] = nameVal.split("=");
      return { name: name.trim(), value: value?.trim() ?? "", domain: "localhost", path: "/" };
    });
    await page.context().addCookies(parsed);
  }

  await page.context().storageState({ path: SESSION_FILE });
  console.log("✓ Admin session saved");
});
