import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(here, "fixtures");
const outputPath = resolve(outputDirectory, "销售明细_功能测试.xlsx");

await mkdir(outputDirectory, { recursive: true });

const workbook = new ExcelJS.Workbook();
workbook.creator = "文件脱敏助手功能测试";
const sheet = workbook.addWorksheet("销售明细", { views: [{ state: "frozen", ySplit: 1 }] });
sheet.columns = [
  { header: "客户名称", key: "customer", width: 22 },
  { header: "产品内部编码", key: "product", width: 18 },
  { header: "销售人员", key: "sales", width: 14 },
  { header: "销售金额", key: "amount", width: 16 },
  { header: "内部订单号", key: "order", width: 18 },
];
sheet.addRows([
  { customer: "浙江ABC染整", product: "HT-825GK", sales: "张三", amount: 128000, order: "SO-001" },
  { customer: "江苏明远纺织", product: "HT-992", sales: "李四", amount: 86000, order: "SO-002" },
  { customer: "浙江ABC染整", product: "HT-992", sales: "张三", amount: 72000, order: "SO-003" },
]);
sheet.addRow({ customer: "合计", amount: { formula: "SUM(D2:D4)", result: 286000 } });
sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF075BE5" } };
sheet.getCell("A2").font = { bold: true, color: { argb: "FF123456" } };
sheet.autoFilter = "A1:E4";

await workbook.xlsx.writeFile(outputPath);
console.log(outputPath);
