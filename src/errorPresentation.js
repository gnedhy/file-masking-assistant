// What each stopped operation means to the user, in everyday words: what happened (title), why (description),
// and what to do (guidance). The titles also explain failed rows in the operation records.
export const ERROR_PRESENTATION = {
  VAULT_TASK_EXISTS: { title: "这次没有生成成功", description: "系统给这次任务分配的编号刚好被占用了，原来的记录没有受影响。", guidance: "直接再点一次“生成脱敏文件”就可以，系统会换一个编号。" },
  NO_COLUMNS: { title: "还没有选择要替换的内容", description: "要先告诉系统哪些列或名称需要换成代号。", guidance: "点“查看并调整”，勾选至少一列或一个名称后再生成。" },
  NO_VALUES: { title: "选中的列里没有可以替换的内容", description: "勾选的列是空的，或者里面只有“/”“无”这类没有实际内容的值。", guidance: "点“调整选择字段”，换成有客户名、人名或产品名的列。" },
  UNSUPPORTED_CELLS: { title: "选中的列里有暂时处理不了的格子", description: "这些格子里放的是图片、控件或特殊对象，不是普通文字。为了不把文件弄坏，系统没有生成。", guidance: "可以先不选这一列；或者复制一份文件，把这些格子改成普通文字后再试。" },
  NO_TABLE: { title: "没有找到需要保护的内容", description: "文件里没有认出表格的表头，也没有找到公司名、人名这类名称。", guidance: "如果文件里确实有要保护的名称，可以在“查看并调整”里手动添加。" },
  NO_TOKENS: { title: "这个文件里没有找到代号", description: "还原要用本工具生成的脱敏文件（里面有“客户-K7M4-01”这样的代号）。这个文件可能是原文件，或者 AI 把代号改掉了。", guidance: "请选择 AI 处理后返回的文件。如果代号被改掉了，需要让 AI 保留代号重新处理。" },
  VAULT_NOT_FOUND: { title: "找不到这个文件的还原记录", description: "文件里的任务编号不在你的任务里：可能是别的同事生成的，或者记录已经被删除。", guidance: "请确认是你自己生成的文件。记录删除后无法找回，需要用原文件重新制作。" },
  NO_TEXT_CANDIDATES: { title: "还没有选择要替换的内容", description: "要先勾选需要换成代号的文字。", guidance: "在候选列表里勾选，或者手动添加文件里的完整文字。" },
  VAULT_SAVE_FAILED: { title: "还原记录没有保存成功", description: "没能把还原记录存到公司服务器。为了避免生成一个以后无法还原的文件，系统没有继续。", guidance: "稍等一会儿再试；一直不行请联系管理员。" },
  VAULT_SERVICE_UNAVAILABLE: { title: "暂时连不上公司服务器", description: "脱敏和还原都要用到存在公司服务器上的还原记录，现在连不上。", guidance: "检查一下网络后再试；一直不行请联系管理员。" },
  VAULT_SERVICE_FAILED: { title: "公司服务器暂时出了点问题", description: "服务器这次没有处理完，原文件没有受影响。", guidance: "稍等一会儿再试；一直不行请联系管理员。" },
  AUTH_REQUIRED: { title: "登录已过期", description: "需要重新确认你的身份，才能读取或保存还原记录。", guidance: "刷新页面，或者从企业微信工作台重新打开应用。" },
  MIXED_TASKS: { title: "文件里混进了不同任务的代号", description: "一个文件里出现了两次以上脱敏任务的代号，系统分不清该用哪一份记录还原。", guidance: "请分别还原每次生成的文件，不要把几份脱敏文件的内容拼在一起交给 AI。" },
  UNRESOLVED_TOKENS: { title: "有些代号对不上", description: "文件里有些代号在你的还原记录里找不到，可能被 AI 改过。", guidance: "点“查看详细信息”看看是哪些代号；改正后重新选择文件，或让 AI 保留原代号重新处理。" },
  UNSUPPORTED_FILE: { title: "暂时不支持这种文件", description: "制作脱敏文件支持 Excel（XLSX）、CSV、TXT、Markdown、Word（DOCX）；还原还支持 PowerPoint（PPTX）和网页（HTML）。", guidance: "旧版 .xls、.doc，以及 PDF 请先另存为新版格式再试。" },
  INVALID_CSV: { title: "这个 CSV 读不出来", description: "文件可能已经损坏，或者引号、分隔符不完整。", guidance: "用 Excel 打开后“另存为 CSV UTF-8”，再重新选择。" },
  INVALID_CSV_ENCODING: { title: "这个 CSV 的文字编码识别不了", description: "文字可能显示成乱码，系统没法准确替换。", guidance: "用 Excel 打开后“另存为 CSV UTF-8”，再重新选择。" },
  INVALID_TEXT: { title: "这个文本文件读不出来", description: "文件里有不是文字的内容，可能不是普通的文本文件。", guidance: "用记事本打开后另存为 UTF-8 编码，再重新选择。" },
  INVALID_TEXT_ENCODING: { title: "这个文本文件的文字编码识别不了", description: "文字可能显示成乱码，系统没法准确替换。", guidance: "用记事本打开，“另存为”时编码选 UTF-8，再重新选择。" },
  TEXT_TOO_LARGE: { title: "文件太大了", description: "文本文件不能超过 10 MB。", guidance: "把文件拆成几份，分别处理。" },
  CSV_TOO_LARGE: { title: "文件太大了", description: "CSV 文件不能超过 10 MB。", guidance: "按月份或部门拆成几份，分别处理。" },
  CSV_LIMIT_EXCEEDED: { title: "表格太大了", description: "行数、列数太多，超出了一次能处理的范围。", guidance: "按月份或部门拆成几份，分别处理。" },
  CSV_FORMULA_INJECTION: { title: "有些格子会被 Excel 当成公式", description: "以 =、+、-、@ 开头的内容，在 Excel 里打开时可能被当成公式运行，不安全，所以没有生成。", guidance: "按下面列出的位置修改原文件，例如把“+86-138…”写成“86-138…”，再重新选择。" },
  SUSPICIOUS_TEXT: { title: "文件里有看不见的特殊字符", description: "这些字符可能藏着内容，或者打乱代号的识别。", guidance: "复制一份文件，把内容粘贴到记事本里重新保存后再试。" },
  EXTERNAL_RELATIONSHIPS: { title: "文件里有会自动联网的外部连接", description: "文件里有数据连接、链接的对象或远程图片，打开时会自己去连接外部网址或其他文件，可能带出信息。普通超链接和引用其他工作簿的公式不在此列，系统会自动处理。", guidance: "在 Excel 的“数据 → 查询和连接”里删除连接，或把链接的对象、图片改成嵌入后另存一份，再重新选择。" },
  SENSITIVE_RESIDUALS: { title: "还有真实名称没有替换掉", description: "已选的真实名称还出现在没有选中的列里，或者出现在系统不能安全改写的地方（例如工作表名称、批注、图表、下拉选项、公式）。为了不把它们交给 AI，系统没有生成。", guidance: "按下面列出的位置处理：点“调整选择字段”，用“手动添加”把这个名称加进去再重新生成；或者在原文件副本里改掉、删掉这些名称（例如重命名工作表、删除批注），再重新选择。" },
  MEDIA_LEFT: { title: "附件没能去掉", description: "文件里嵌入的附件没能从脱敏文件里去掉，为了安全没有生成。", guidance: "在原文件副本里删除嵌入的附件后再试。" },
  INVALID_OFFICE_PACKAGE: { title: "这个 Office 文件读不出来", description: "文件可能已经损坏、设置了密码，或者不是标准格式。", guidance: "用 Word 或 PowerPoint 打开，去掉密码后另存一份，再重新选择。" },
  UNSUPPORTED_DOCX_STRUCTURE: { title: "这个 Word 文件里有暂时处理不了的内容", description: "文件里有修订记录、批注、脚注或特殊控件，系统没法保证这些地方都替换干净。", guidance: "复制一份文件，接受全部修订、删除批注和脚注后再试。" },
  INVALID_HTML: { title: "这个网页文件读不出来", description: "文件不是普通的网页格式，或者文字编码识别不了。", guidance: "让 AI 重新导出成一个单独的 HTML 文件后再试。" },
  FORMAT_MISMATCH: { title: "文件的类型和后缀名对不上", description: "比如一个 Word 文件被改成了 .xlsx 后缀，系统不能确定它是什么文件。", guidance: "用原来的软件打开后另存为正确的格式，不要只改文件名后缀。" },
  EMBEDDED_OBJECTS: { title: "文件里有宏或控件", description: "宏和控件可能自动运行程序，为了安全暂时不处理这类文件。", guidance: "复制一份文件，另存为不带宏的普通格式（例如 .xlsx、.docx）后再试。" },
  FILE_TOO_LARGE: { title: "文件太大了", description: "Office 文件不能超过 20 MB，网页文件不能超过 10 MB。", guidance: "把文件拆成几份，或者压缩里面的图片后再试。" },
  PACKAGE_TOO_LARGE: { title: "文件内容太多了", description: "文件里的工作表或内部内容太多，超出了一次能处理的范围。", guidance: "把文件拆成几份，分别处理。" },
  ALTERED_TOKENS: { title: "有些代号被 AI 改动过", description: "代号被改写或截断后，系统没法确认它原来对应哪个名称。", guidance: "让 AI 原样保留代号重新处理；“复制 AI 处理说明”里已经写了这个要求。" },
  PROCESSING_ERROR: { title: "处理时出了点意外问题", description: "文件在处理过程中出现了系统没有预料到的错误，原文件没有受影响。", guidance: "用文件副本再试一次；仍然不行，请点右上角「反馈」告诉管理员，写明文件格式和操作到哪一步。" },
  UNSUPPORTED_CONTENT: { title: "代号出现在系统不能还原的地方", description: "代号出现在了批注、特殊图形、网页脚本或链接这类地方，系统不能安全地改回去。", guidance: "按“查看详细信息”里的位置，把代号挪回普通文字或表格里，再重新选择。" },
};

// The code stored for a failed operation: the error's own code, or PROCESSING_ERROR when it has none,
// so a failure is never recorded without a reason.
export function errorCodeOf(caught) {
  const code = caught?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? code : "PROCESSING_ERROR";
}

// Where in a file a stopped operation found its problem. Only the kind of place is recorded with a failure,
// never the name or the cell: the records are the evidence for improving the rules, not a copy of the content.
export const ERROR_PLACE_LABELS = {
  cell: "单元格", formula: "公式", comment: "批注", chart: "图表或图形", pivot: "数据透视表", table: "超级表列名",
  sheetName: "工作表名称", properties: "文件属性", link: "链接", externalLink: "外部工作簿链接", connection: "数据连接",
  macro: "宏或控件", document: "文档正文以外的区域", other: "其他位置",
};
const PLACE_BY_LABEL = [
  ["工作表单元格或公式", "formula"], ["单元格文字", "cell"], ["批注", "comment"], ["图表或图形里的文字", "chart"], ["数据透视表", "pivot"],
  ["表格（超级表）的列名", "table"], ["工作表名称或定义的名称", "sheetName"], ["文件属性", "properties"], ["文件的其他部分", "other"],
];
const PLACE_BY_PART = [
  [/comments?/i, "comment"], [/^xl\/(?:charts|drawings)\//i, "chart"], [/^xl\/pivot/i, "pivot"], [/^xl\/tables\//i, "table"],
  [/^xl\/externalLinks\//i, "externalLink"], [/^xl\/connections\.xml$/i, "connection"], [/vbaProject|activeX/i, "macro"],
  [/^xl\/_rels\/workbook\.xml\.rels$/i, "externalLink"], [/\.rels$/i, "link"], [/^xl\/worksheets\//i, "cell"], [/^xl\/workbook\.xml$/i, "sheetName"],
  [/^docProps\//i, "properties"], [/^(?:word|ppt)\//i, "document"],
];
function placeOf(detail) {
  if (detail && typeof detail === "object") return detail.sheetName && detail.row ? "cell" : "other";
  const text = String(detail ?? "");
  const label = PLACE_BY_LABEL.find(([prefix]) => text.startsWith(prefix));
  if (label) return label[1];
  if (/^[\w\[\]./-]+\.(?:xml|rels|vml|bin)$/i.test(text)) return PLACE_BY_PART.find(([pattern]) => pattern.test(text))?.[1] ?? "other";
  // "销售明细!B5：原因" from the cell checks.
  return /^[^!：:]{1,40}![A-Z]{1,3}\d{1,7}(?:[：:]|$)/.test(text) ? "cell" : "other";
}

// The kinds of place behind a failure with how many of each, most frequent first: ["comment:3", "sheetName:1"].
export function errorPlacesOf(caught) {
  const counts = new Map();
  for (const detail of Array.isArray(caught?.details) ? caught.details : []) {
    const place = placeOf(detail);
    counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([place, count]) => `${place}:${Math.min(count, 99999)}`);
}

export function isErrorPlace(value) {
  const match = typeof value === "string" && /^([a-zA-Z]{2,20}):([1-9]\d{0,4})$/.exec(value);
  return Boolean(match) && Object.hasOwn(ERROR_PLACE_LABELS, match[1]);
}

// The short reason shown next to a failed record; unknown codes show nothing rather than a raw code.
// With places: "还有真实名称没有替换掉（批注 3 处、工作表名称 1 处）".
export function failureReason(code, places) {
  const title = (code && ERROR_PRESENTATION[code]?.title) || "";
  const where = (Array.isArray(places) ? places : []).filter(isErrorPlace).map((item) => { const [place, count] = item.split(":"); return `${ERROR_PLACE_LABELS[place]} ${count} 处`; });
  return title && where.length ? `${title}（${where.join("、")}）` : title;
}

// A place in a sheet or CSV from a candidate's locations: "「重点客户资料表」第 4 行 B 列" or "第 2 行第 3 列".
export function cellPlace({ sheet, row, column }) {
  return residualPlace({ sheetName: sheet, row, columnNumber: column });
}

// One leftover position in words: "「销售明细表」第 5 行 B 列" for a cell, "批注里的「某某公司」" for other places.
export function residualPlace(detail) {
  if (detail && typeof detail === "object" && detail.sheetName && detail.row) {
    let column = "", n = detail.columnNumber;
    while (n > 0) { const r = (n - 1) % 26; column = String.fromCharCode(65 + r) + column; n = Math.floor((n - 1) / 26); }
    return detail.sheetName === "CSV" ? `第 ${detail.row} 行第 ${detail.columnNumber} 列` : `「${detail.sheetName}」第 ${detail.row} 行 ${column} 列`;
  }
  const text = String(detail ?? "");
  const split = text.indexOf("：");
  return split > 0 ? `${text.slice(0, split)}里的「${text.slice(split + 1)}」` : text;
}
