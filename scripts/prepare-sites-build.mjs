#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECURITY_HEADERS } from "../worker/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const hosting = path.join(root, ".openai", "hosting.json");

for (const file of [index, worker, hosting]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
copyFileSync(worker, path.join(dist, "server", "index.js"));
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

// Static assets can bypass the Worker, so publish the same policy at the asset layer.
writeFileSync(path.join(dist, "client", "_headers"),
  `/*\n${Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`).join("\n")}\n`);

console.log("Prepared Sites build: dist/server/index.js and dist/.openai/hosting.json");
