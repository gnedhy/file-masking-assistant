import { spawnSync } from "node:child_process";
const env = { ...process.env, OPERATIONS_TEST_DATABASE_URL: "postgres://operations_test@127.0.0.1:55434/filemask_operations_test" };
for (const args of [
  ["scripts/operations-local.mjs", "start"],
  ["--test", "tests/operations-server.test.mjs", "tests/access.test.mjs", "tests/feedback.test.mjs", "tests/operations-integration.test.mjs", "tests/operation-reports.test.mjs"],
  ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.operations.config.js"],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio:"inherit", windowsHide:true });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
