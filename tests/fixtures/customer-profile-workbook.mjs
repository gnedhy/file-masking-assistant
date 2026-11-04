// A made-up workbook shaped like a real 重点客户资料表: form sheets with labels and values, a free-form org chart,
// a sales ledger, a quote addressed to the customer, plus a picture and an embedded attachment. No real data.
import ExcelJS from "exceljs";
import JSZip from "jszip";

export const PROFILE_NAMES = {
  customer: "虚构东骏纺织有限公司",
  partner: "虚构盛意环保科技有限公司",
  trader: "虚构亿弘化工贸易有限公司",
  supplier: "虚构宏昊化工有限公司",
  legal: "张良源",
  boss: "马立群",
  buyer: "张小婷",
  manager: "张振扬",
  sales: "周文斌",
};
const N = PROFILE_NAMES;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export function customerProfileWorkbook() {
  const wb = new ExcelJS.Workbook();
  const profile = wb.addWorksheet("重点客户资料表");
  profile.mergeCells("A1:F1"); profile.getCell("A1").value = "宏昊化工 · 重点客户资料表";
  profile.getCell("A3").value = "一、企业基础信息";
  profile.getRow(4).values = ["企业名称 *", `${N.customer}（以${N.partner}合作）`, null, null, "企业类型", "生产雨伞布"];
  profile.getRow(5).values = ["成立时间", "2008年", "法人", N.legal, "年产量(件)", "63990万米"];
  profile.getRow(9).values = ["开票资料", `${N.trader}-中间商`, null, null, "开票习惯", "/"];
  profile.getRow(11).values = ["合同规范性", "规范", "合作时间", "", "主要竞争对手", "虚构德美、虚构华大"];
  profile.getRow(15).values = ["股东人数", "2人", "股份占比分布", "张总、陈总", "股东是否在企业任职", "是"];
  profile.getRow(25).values = ["姓名 *", "马总", "职务", "副总", "生日(农历)", ""];
  profile.getRow(45).values = ["采购部", N.buyer, null, "张老板的女儿"];
  profile.getRow(56).values = ["产品名称", "防水剂", "报价", "", "年需求量", "30吨以上/月，东骏公司"];

  const chain = wb.addWorksheet("决策链分析");
  chain.getRow(2).values = ["客户名称", "", "产品", "防水剂"];
  chain.getRow(5).values = ["序号", "角色身份", "姓名", "职位/部门"];
  chain.getRow(6).values = [1, "最终决策人", N.boss, "老板/总经理"];
  chain.getRow(28).values = ["业务员", N.sales, "", ""];
  chain.getRow(29).values = ["项目经理", N.manager, "", ""];

  const org = wb.addWorksheet("组织架构");
  org.getCell("B2").value = "项目组："; org.getCell("C2").value = N.customer;
  org.getCell("E2").value = N.partner; org.getCell("F2").value = "东骏";
  org.getCell("E3").value = N.trader; org.getCell("F3").value = "骏邦";
  org.getRow(5).values = [null, "项目经理：", N.manager];
  org.getRow(6).values = [null, "销售：", N.sales];

  const ledger = wb.addWorksheet("销售明细表");
  ledger.addRow(["交易日期", "客户中文名称", "产品", "数量", "单价", "本币金额"]);
  ledger.addRow(["2026/07/21", N.partner, "C6防水剂", 50, 29.5, 1475]);
  ledger.addRow(["2026/08/01", N.trader, "C6防水剂", 1000, 29.5, 29500]);
  ledger.autoFilter = "A1:F1";

  const quote = wb.addWorksheet("6月报价单");
  quote.getCell("B2").value = `To：${N.partner}`;
  quote.getCell("B3").value = `From：${N.supplier}`;
  quote.getCell("B10").value = `需方：${N.partner}`; quote.getCell("E10").value = `供方：${N.supplier}`;
  quote.getCell("B11").value = `负责人：${N.boss}`; quote.getCell("E11").value = `负责人：${N.sales}`;
  const picture = wb.addImage({ buffer: PNG, extension: "png" });
  quote.addImage(picture, "H2:J8");
  return wb;
}

// The workbook as Excel would save it with an attached PDF (an OLE package inside xl/embeddings).
export async function customerProfileBytes() {
  const zip = await JSZip.loadAsync(await customerProfileWorkbook().xlsx.writeBuffer());
  zip.file("xl/embeddings/oleObject1.bin", `合同附件 ${N.customer}`);
  const types = await zip.file("[Content_Types].xml").async("string");
  zip.file("[Content_Types].xml", types.replace("</Types>", '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/></Types>'));
  return zip.generateAsync({ type: "nodebuffer" });
}
