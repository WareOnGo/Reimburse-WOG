import { defineConfig } from "@playwright/test";

const port = process.env.ERP_TEST_PORT;
if (!port || !process.env.ERP_TEST_DATABASE_URL) throw new Error("Run npm run test:e2e to start the isolated database.");
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: { command: `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL, reuseExistingServer: false, timeout: 120_000 },
});
