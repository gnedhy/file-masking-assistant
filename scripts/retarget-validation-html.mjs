import fs from "node:fs/promises";

const [source, destination, sourceTaskId, targetTaskId] = process.argv.slice(2);
if (!source || !destination || !/^[A-F0-9]{8}$/.test(sourceTaskId) || !/^[A-F0-9]{8}$/.test(targetTaskId)) {
  throw new Error("Usage: node retarget-validation-html.mjs <source> <destination> <source-task> <target-task>");
}
const html = await fs.readFile(source, "utf8");
await fs.writeFile(destination, html.replaceAll(sourceTaskId, targetTaskId), "utf8");
console.log(destination);
