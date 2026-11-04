import { buildTextCandidate } from "./textCore.js";
import { classifyHeader, isPlaceholderValue } from "./xlsxCore.js";

// Many working sheets are forms, not tables: "企业名称 | 某某有限公司", "负责人：马某", a quote addressed
// "To: 某某公司". Column headers cannot find those names, so the whole workbook is read for them and the user
// confirms the list. Confirmed names are then replaced everywhere in the file.

const PERSON_LABEL = /^(?:法人|法定代表人|法人代表|姓名|联系人|负责人|责任人|项目经理|销售|业务员|采购|决策人|被拜访人|拜访人|老板|总经理|对接人|经办人|跟单员?|股东|实际控制人|签字人|签约人|协助)$/;
const COMPANY_LABEL = /^(?:企业名称|公司名称|单位名称|客户名称|客户|甲方|乙方|供方|需方|供应商|项目组|开票资料|开票信息|to|from|买方|卖方|购货单位|收货单位|发货单位|合作客户|主要竞争对手|竞争对手)$/i;
// Prefer the full suffix: 某某集团有限公司, not 某某集团.
const COMPANY_NAME = /[一-龥A-Za-z（）()·]{2,30}?(?:(?:集团)?(?:股份有限公司|有限责任公司|有限公司)|集团|公司|厂)/g;
const BARE_SUFFIX = /^(?:集团)?(?:股份有限公司|有限责任公司|有限公司|公司|集团|厂)$/;
const GENERIC_COMPANY = /^(?:本|子|分|母|总|该|贵|我|我方|对方|其|一家|这家|那家|同一|关联|其他|其它|合作)(?:公司|厂|集团)$/;
const MARKER_SHEET = "__AI安全任务";
// Words that head a column or a form row rather than name anyone.
const FIELD_WORD = /^(?:职位|部门|职务|岗位|角色|身份|电话|手机|手机号|微信|微信号|邮箱|地址|日期|时间|备注|数量|金额|单价|价格|序号|状态|类型|产品|产品名称|品名|规格|方式|说明|内容|结果|情况|是|否)$/;
// Words a sentence puts in front of a company name: "以某某公司合作" → 某某公司.
const LEADING_WORD = /^(?:以|与|和|及|向|给|对|由|在|从|为|被|跟|同|经|通过|委托)(?=[\u4e00-\u9fa5A-Za-z]{4,})/;

function normalizeLabel(text) {
  return String(text ?? "").normalize("NFKC").replace(/[（(][^）)]*[）)]/g, "").replace(/[*＊:：\s]/g, "").trim();
}

// The kind of name a label introduces, or null when it is not a name label.
function labelKind(text) {
  const label = normalizeLabel(text);
  if (!label || label.length > 12) return null;
  if (COMPANY_LABEL.test(label)) return { category: "customer", prefix: "C" };
  if (PERSON_LABEL.test(label)) return { category: "sales", prefix: "S" };
  const header = classifyHeader(label);
  return header.category === "customer" || header.category === "sales" ? header : null;
}

const cellText = value => {
  if (typeof value === "string") return value;
  if (value && Array.isArray(value.richText)) return value.richText.map(part => part.text).join("");
  return null;
};

// "张总、陈总" or "马总/小陈总" hold several names.
function names(value) {
  const text = String(value).replace(/\s*[（(][^）)]*[）)]\s*$/, "").replace(/((?:股份有限公司|有限责任公司|有限公司|集团|公司|厂))[-—–_·].*$/, "$1");
  return text.split(/[、，,；;\/／]|\s和\s/).map(part => part.trim()).filter(part =>
    part.length >= 2 && part.length <= 60 && !isPlaceholderValue(part) && !/^[\d\s.,%+\-]+$/.test(part) && !labelKind(part) && !FIELD_WORD.test(part) && !/\[\[|-[23456789A-HJ-NP-Z]{4}-\d/.test(part));
}

export function workbookText(workbook) {
  const texts = [];
  workbook.eachSheet(sheet => {
    if (sheet.name === MARKER_SHEET) return;
    sheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
      const text = cellText(cell.value);
      if (text) texts.push(text);
    }));
  });
  return texts.join("\n");
}

// headerRows: sheet name → the rows that head a table there (from the column analysis).
export function findWorkbookCandidates(workbook, coveredValues = new Set(), headerRows = new Map()) {
  const sourceText = workbookText(workbook);
  const found = new Map();
  const add = (value, label, kind) => {
    for (const name of names(value)) {
      if (found.has(name) || coveredValues.has(name)) continue;
      const item = buildTextCandidate(name, label, sourceText, false, kind);
      if (item) found.set(name, item);
    }
  };
  workbook.eachSheet(sheet => {
    if (sheet.name === MARKER_SHEET) return;
    sheet.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (cell.isMerged && cell.master !== cell) return;
        const text = cellText(cell.value);
        if (!text) return;
        // Table header rows hold column names, not labels with a value beside them.
        const kind = headerRows.get(sheet.name)?.has(cell.row) ? null : labelKind(text);
        // A label cell: the name sits in the next filled cell to its right.
        if (kind) {
          for (let column = cell.col + 1; column <= cell.col + 4; column += 1) {
            const next = row.getCell(column);
            if (next.isMerged && next.master !== next && next.master.col <= cell.col) continue;
            const value = cellText(next.isMerged ? next.master.value : next.value);
            if (value == null || !String(value).trim()) continue;
            if (!labelKind(value)) add(value, normalizeLabel(text), kind);
            break;
          }
        }
        // "负责人：马某" in one cell.
        const inline = text.match(/^\s*([^:：\n]{1,12})\s*[:：]\s*(.+?)\s*$/);
        const inlineKind = inline && labelKind(inline[1]);
        if (inlineKind) add(inline[2], normalizeLabel(inline[1]), inlineKind);
        for (const match of text.matchAll(COMPANY_NAME)) {
          const company = match[0].replace(/^[（(]+|[）)]+$/g, "").replace(LEADING_WORD, "");
          if (company.length >= 4 && !GENERIC_COMPANY.test(company) && !BARE_SUFFIX.test(company)) add(company, "公司名称", { category: "customer", prefix: "C" });
        }
      });
    });
  });
  const candidates = [...found.values()];
  return { candidates, sourceText, suggestedCandidateIds: candidates.map(item => item.id) };
}
