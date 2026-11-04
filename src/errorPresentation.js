// What each stopped operation means to the user. The titles also explain failed rows in the operation records.
export const ERROR_PRESENTATION = {
  VAULT_TASK_EXISTS: { title: "任务编号已存在", description: "原还原记录未改动，本次没有生成可下载文件。", guidance: "请重新生成脱敏文件，系统会分配新任务编号。" },
  NO_COLUMNS: {
    title: "还没有选择脱敏字段",
    description: "当前没有可用于生成脱敏文件的已选字段。",
    guidance: "可以直接返回字段选择，勾选至少一个需要替换的字段。",
  },
  NO_VALUES: {
    title: "所选字段没有可替换内容",
    description: "整格字段中没有可替换值，或文中替换字段里没有出现已经确认的实体。",
    guidance: "请至少把一个客户、产品或人员字段设为“整个单元格”。",
  },
  UNSUPPORTED_CELLS: {
    title: "所选字段包含暂不支持的单元格",
    description: "所选范围中包含公式、富文本、链接或其他结构化单元格，为避免破坏文件结构，系统已停止生成。",
    guidance: "请调整选择字段，或先在副本中把这些单元格转成普通值。",
  },
  NO_TOKENS: {
    title: "这个文件无法自动还原",
    description: "没有识别到本工具生成的代号。它可能不是脱敏文件，或者 AI 改变了代号格式。",
    guidance: "请选择 AI 处理后的脱敏文件；代号被改写时需重新制作。",
  },
  VAULT_NOT_FOUND: {
    title: "找不到这个文件的还原记录",
    description: "文件中的任务编号不在你的任务里。记录可能已被删除，或文件是其他同事生成的。",
    guidance: "请确认文件是你自己生成的；记录删除后无法恢复，需要用原文件重新制作。",
  },
  NO_TEXT_CANDIDATES: {
    title: "还没有选择敏感内容",
    description: "当前没有可用于生成脱敏文件的已选文字。",
    guidance: "返回候选列表，勾选自动识别的内容，或手动添加文件中的完整文字。",
  },
  VAULT_SAVE_FAILED: {
    title: "还原记录没有保存成功",
    description: "公司服务器没有保存成功，因此没有生成无法还原的脱敏文件。",
    guidance: "请稍后重试；持续失败请联系管理员。",
  },
  VAULT_SERVICE_UNAVAILABLE: {
    title: "暂时连不上公司服务器",
    description: "脱敏和还原都需要读取或保存还原记录，服务器不可用时已停止处理。",
    guidance: "请检查网络后重试；持续失败请联系管理员。",
  },
  VAULT_SERVICE_FAILED: {
    title: "公司服务器暂时不可用",
    description: "服务器没有完成请求，系统已停止处理，原文件不受影响。",
    guidance: "请稍后重试；持续失败请联系管理员。",
  },
  AUTH_REQUIRED: {
    title: "登录已过期",
    description: "需要重新确认身份才能读取或保存还原记录。",
    guidance: "请刷新页面重新进入应用，再选择文件。",
  },
  MIXED_TASKS: {
    title: "文件中混入了不同任务的代号",
    description: "系统无法确认每个代号应该使用哪一份还原记录，因此已停止还原。",
    guidance: "请使用同一次任务生成的处理文件，不要合并来自不同脱敏文件的内容。",
  },
  UNRESOLVED_TOKENS: {
    title: "有些代号无法安全还原",
    description: "系统发现未知代号，或代号出现在暂不支持自动改写的位置。",
    guidance: "可以查看技术详情定位问题；修正文件后重新选择，系统会再次完整检查。",
  },
  UNSUPPORTED_FILE: {
    title: "当前还不能处理这种文件",
    description: "制作脱敏文件支持 XLSX、CSV、TXT、MD、DOCX；还原支持标准 XLSX、CSV、TXT、MD、DOCX、PPTX 和安全静态 HTML。",
    guidance: "请选择支持的标准文件。宏、加密文件和复杂嵌入对象暂不处理。",
  },
  INVALID_CSV: { title: "无法安全读取这个 CSV", description: "文件可能包含二进制内容、损坏的引号或异常分隔结构。", guidance: "请从 Excel 重新另存为 UTF-8 CSV 后再试。" },
  INVALID_CSV_ENCODING: { title: "无法识别 CSV 文字编码", description: "当前文件不是可识别的 UTF-8 或 GB18030 编码。", guidance: "请将文件另存为 UTF-8 CSV 后再试。" },
  INVALID_TEXT: { title: "无法安全读取这个文本文件", description: "文件包含二进制内容或空字符，不是标准纯文本。", guidance: "请另存为 UTF-8 的 TXT 或 MD 文件后再试。" },
  INVALID_TEXT_ENCODING: { title: "无法识别文本编码", description: "TXT/MD 仅支持标准 UTF-8 或 UTF-8 BOM。", guidance: "请用文本编辑器另存为 UTF-8 后再试。" },
  TEXT_TOO_LARGE: { title: "文本文件超过安全大小限制", description: "TXT/MD 文件不能超过 10 MB。", guidance: "请拆分文件后重试。" },
  CSV_TOO_LARGE: { title: "CSV 超过当前安全限制", description: "CSV 文件不能超过 10 MB。", guidance: "请按月份、业务单元或数据范围拆分后重试。" },
  CSV_LIMIT_EXCEEDED: { title: "CSV 表格规模超过安全限制", description: "文件的行数、列数或字段总量过大，系统已停止处理。", guidance: "请按月份、业务单元或工作表拆分后重试。" },
  CSV_FORMULA_INJECTION: { title: "CSV 里有疑似公式的内容", description: "以 =、+、-、@ 开头的内容，在 Excel 等表格软件里可能被当作公式运行，因此没有生成输出文件。", guidance: "请在原文件中修改这些位置后重新选择文件，例如把 +86-138… 写成 86-138…；工具不会自动改写原值。" },
  SUSPICIOUS_TEXT: { title: "文件中包含不可见控制字符", description: "这些字符可能隐藏内容或改变代号识别，系统已停止处理。", guidance: "请用纯文本编辑器显示并移除不可见字符后重试。" },
  EXTERNAL_RELATIONSHIPS: { title: "文件包含外部链接或远程连接", description: "为避免文件打开时连接外部资源，系统已停止处理。", guidance: "请在 Office 中断开外部链接并另存为标准文件。" },
  SENSITIVE_RESIDUALS: { title: "脱敏后仍发现真实内容", description: "已选真实值仍出现在文件的其他位置，因此没有生成脱敏文件。", guidance: "请返回调整选择：叙述列可选“仅文中已选内容”，或把相关列设为整格替换。" },
  INVALID_OFFICE_PACKAGE: { title: "无法安全读取这个 Office 文件", description: "文件可能已损坏、加密，或不是标准 DOCX/PPTX。", guidance: "请从 Word 或 PowerPoint 重新另存为标准文件后再试。" },
  UNSUPPORTED_DOCX_STRUCTURE: { title: "这个 Word 文件包含暂时无法完整脱敏的结构", description: "检测到脚注、尾注、修订、内容控件、域或批注。为避免静默遗漏，系统已停止生成。", guidance: "请处理修订，移除批注、域、脚注或内容控件后另存为标准 DOCX。" },
  INVALID_HTML: { title: "无法安全读取这个 HTML 文件", description: "文件不是有效的 UTF-8 静态 HTML，或包含无法识别的二进制内容。", guidance: "请让 AI 导出为 UTF-8 的单文件 HTML 后再试。" },
  FORMAT_MISMATCH: { title: "文件扩展名与内部格式不一致", description: "为避免把伪装文件当作 Office 文件处理，系统已停止输出。", guidance: "请用原应用重新另存文件，不要只修改扩展名。" },
  EMBEDDED_OBJECTS: { title: "文件包含暂不处理的嵌入内容", description: "检测到宏、OLE、ActiveX 或嵌入包，系统已停止输出。", guidance: "请移除嵌入对象并另存为标准 DOCX/PPTX 后再试。" },
  FILE_TOO_LARGE: { title: "文件超过当前安全限制", description: "Office 文件不能超过 20 MB，HTML 不能超过 10 MB。", guidance: "请拆分文件或压缩图片后重试。" },
  PACKAGE_TOO_LARGE: { title: "文件内部结构超过安全限制", description: "解包总量或内部文件项过多，系统已停止处理。", guidance: "请精简文件后重试。" },
  ALTERED_TOKENS: { title: "有些代号已被改写或截断", description: "系统只还原完整且能由还原记录确认的代号。", guidance: "请让 AI 保留完整代号，或重新生成处理文件。" },
  UNSUPPORTED_CONTENT: { title: "代号出现在不安全或暂不处理的位置", description: "Office 的 SmartArt、批注、自定义属性、嵌入内容，或 HTML 的外部脚本、样式、链接、事件属性中发现代号，因此已停止输出。具体位置见下方明细。", guidance: "请把代号放回普通文字、表格或图表后再试。" },
};

// The short reason shown next to a failed record; unknown codes show nothing rather than a raw code.
export function failureReason(code) {
  return (code && ERROR_PRESENTATION[code]?.title) || "";
}
