import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    slowMo: 500,
  },
  projects: [
    // ── Setup: login and save sessions ──────────────────────────────────────
    { name: "admin-setup", testMatch: /auth\.admin\.setup\.ts/ },
    { name: "staff-setup", testMatch: /auth\.staff\.setup\.ts/ },

    // ── Tests ────────────────────────────────────────────────────────────────
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/admin.json",
      },
      dependencies: ["admin-setup"],
    },
  ],
});
