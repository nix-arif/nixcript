import { test as setup } from "@playwright/test";
import path from "path";

const SESSION_FILE = path.join(__dirname, ".auth/staff.json");

setup("authenticate as staff", async ({ page, request }) => {
  const email    = process.env.TEST_STAFF_EMAIL;
  const password = process.env.TEST_STAFF_PASSWORD;

  if (!email || !password) {
    throw new Error("TEST_STAFF_EMAIL and TEST_STAFF_PASSWORD must be set in .env.local");
  }

  const res = await request.post("http://localhost:3000/api/auth/sign-in/email", {
    data: { email, password },
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Staff login failed ${res.status()}: ${body}\n` +
      `Check TEST_STAFF_EMAIL / TEST_STAFF_PASSWORD in .env.local`,
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
  console.log("✓ Staff session saved");
});
