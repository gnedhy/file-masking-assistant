import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createAccess, PgAccessRepository } from "./access.mjs";
import { createAppHandler } from "./handler.mjs";
import { PgFeedbackRepository } from "./feedback.mjs";
import { PgOperationsRepository } from "./operations-repository.mjs";
import { PgVaultRepository } from "./repository.mjs";
import { SECURITY_HEADERS } from "./security-headers.mjs";
import { createWeComAuth } from "./session.mjs";

// Statistics group records by Beijing calendar day, like the record filters do in SQL.
process.env.TZ ||= "Asia/Shanghai";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secret = async (name, fallback) => (await readFile(process.env[`${name}_FILE`] || fallback, "utf8")).trim();
const masterKey = Buffer.from(await secret("VAULT_MASTER_KEY", "/run/secrets/vault_master_key"), "base64");
const keyVersion = process.env.VAULT_KEY_VERSION || "v1";
const repository = new PgVaultRepository({ connectionString: process.env.DATABASE_URL, masterKey, keyVersion });
await repository.initialize(await readFile(path.join(root, "server/schema.sql"), "utf8"));
const operationsRepository = new PgOperationsRepository({ connectionString: process.env.DATABASE_URL });
await operationsRepository.initialize(await readFile(path.join(root, "server/operations-schema.sql"), "utf8"));
const auth = createWeComAuth({
  corpId: process.env.WECOM_CORP_ID,
  agentId: process.env.WECOM_AGENT_ID,
  corpSecret: await secret("WECOM_SECRET", "/run/secrets/wecom_secret"),
  sessionSecret: await secret("SESSION_SECRET", "/run/secrets/session_secret"),
  publicOrigin: process.env.PUBLIC_ORIGIN,
  cookieSecure: process.env.COOKIE_SECURE !== "false",
});
const accessRepository = new PgAccessRepository({ connectionString: process.env.DATABASE_URL });
await accessRepository.initialize(await readFile(path.join(root, "server/access-schema.sql"), "utf8"));
const access = await createAccess({ repository: accessRepository, auth, directorySource: auth.directory, origin: process.env.PUBLIC_ORIGIN });
const feedbackRepository = new PgFeedbackRepository({ connectionString: process.env.DATABASE_URL, masterKey, keyVersion });
await feedbackRepository.initialize(await readFile(path.join(root, "server/feedback-schema.sql"), "utf8"));
const handle = createAppHandler({ vaultRepository: repository, operationsRepository, feedbackRepository, access, origin: process.env.PUBLIC_ORIGIN });
const clientRoot = path.join(root, "dist/client");
const securityHeaders = SECURITY_HEADERS;

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

const server = createServer(async (req, res) => {
  try {
    const request = new Request(new URL(req.url, process.env.PUBLIC_ORIGIN), {
      method: req.method, headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Readable.toWeb(req),
      duplex: ["GET", "HEAD"].includes(req.method) ? undefined : "half",
    });
    const response = await handle(request);
    if (response) {
      res.writeHead(response.status, { ...securityHeaders, ...Object.fromEntries(response.headers) });
      if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const candidate = path.resolve(clientRoot, `.${pathname}`);
    const relative = path.relative(clientRoot, candidate);
    const file = !relative.startsWith("..") && !path.isAbsolute(relative) && existsSync(candidate) && !pathname.endsWith("/") ? candidate : path.join(clientRoot, "index.html");
    res.writeHead(200, { ...securityHeaders, "content-type": mime[path.extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ code: "SERVER_FAILED", message: "企业服务暂时不可用。" }));
  }
});

// Operation records and feedback (with its attachments) are kept for 180 days.
const cleanupAll = () => Promise.all([operationsRepository.cleanupExpired(), feedbackRepository.cleanupExpired()]);
await cleanupAll();
const cleanup = setInterval(() => cleanupAll().catch(() => console.error("Retention cleanup failed")), 60 * 60_000);
cleanup.unref();
const port = Number(process.env.PORT || 8080);
server.listen(port, "0.0.0.0", () => console.log(`File masking service listening on ${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  clearInterval(cleanup);
  server.close();
  await Promise.all([repository.close(), operationsRepository.close(), accessRepository.close(), feedbackRepository.close()]);
  process.exit(0);
});
