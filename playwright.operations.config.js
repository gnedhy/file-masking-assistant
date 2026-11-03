import { defineConfig, devices } from "@playwright/test";

// Runs the dev server against the isolated PostgreSQL test database (see scripts/operations-local.mjs).
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["central-operations.spec.js", "access-settings.spec.js", "feedback.spec.js"],
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4175", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "node scripts/dev-server.mjs --port 4175",
    url: "http://127.0.0.1:4175/readyz",
    reuseExistingServer: false,
    env: { DATABASE_URL: "postgres://operations_test@127.0.0.1:55434/filemask_operations_test" },
  },
});
