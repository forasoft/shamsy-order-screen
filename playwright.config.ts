import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.APP_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "phone", testMatch: /.*\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    {
      name: "walkthrough",
      testMatch: /walkthrough\.ts/,
      use: {
        ...devices["Pixel 7"],
        video: { mode: "on", size: { width: 412, height: 839 } },
        launchOptions: { slowMo: 25 },
      },
    },
  ],
});
