import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["central-operations.spec.js", "operation-sync.spec.js"],
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4175", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], viewport:{ width:390,height:844 } } },
  ],
  webServer: [
    { command: "node server/operations-index.mjs", url: "http://127.0.0.1:5180/readyz", reuseExistingServer: false, env: {
      NODE_ENV: "test", OPERATIONS_TEST_MODE: "1", OPERATIONS_PUBLIC_ORIGIN:"http://127.0.0.1:4175",
      OPERATIONS_DATABASE_URL:"postgres://operations_test@127.0.0.1:55434/filemask_operations_test",
      OPERATIONS_SESSION_SECRET:"isolated-test-session-secret-not-for-deployment",
      OPERATIONS_TEST_SECRET:"isolated-test-login-secret-not-for-deployment",
    } },
    { command: "npm run dev -- --port 4175", url:"http://127.0.0.1:4175", reuseExistingServer:false, env:{VITE_OPERATIONS_ENABLED:"true"} },
  ],
});
