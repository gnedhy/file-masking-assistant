import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2] || "tests/output/performance-assets");
await mkdir(output, { recursive: true });

async function writeSized(name, megabytes, line) {
  const target = megabytes * 1024 * 1024;
  const handle = await open(path.join(output, name), "w");
  let written = 0;
  try {
    while (written < target) {
      const repeat = Math.min(4096, Math.ceil((target - written) / Buffer.byteLength(line)));
      const chunk = Buffer.from(line.repeat(repeat)).subarray(0, target - written);
      await handle.write(chunk);
      written += chunk.length;
    }
  } finally { await handle.close(); }
}

await writeSized("01_1MB_中英混合.txt", 1, "客户名称：浙江ABC染整；产品：HT-825GK；销售：张三\r\n");
await writeSized("02_10MB_销售数据.csv", 10, "浙江ABC染整,HT-825GK,张三,13800138000\r\n");
await writeSized("03_20MB_中英混合.txt", 20, "Customer: 浙江ABC染整; Product: HT-825GK; Owner: 张三\n");
await writeSized("04_50MB_销售数据.csv", 50, "浙江ABC染整,HT-825GK,张三,test@example.com\r\n");
await writeFile(path.join(output, "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), files: [1, 10, 20, 50], note: "仅用于实机性能记录，不包含真实数据。" }, null, 2));
console.log(output);
