// What changed in each release, newest first, in words staff understand. The first entry is the running version.
// One version per day: a second deployment on the same day adds to that day's entry instead of a new version.
// Numbering: each new day's release adds 1 to the last digit (1.0.0, 1.0.1 … 1.0.9, then 1.1.0).
// package.json "version" should match the first entry. The type chip says 新增/改进/修复, so the text doesn't repeat it.
export const CHANGELOG = [
  {
    version: "1.0.2",
    date: "2026-11-04",
    items: [
      ["new", "Excel 表单式的资料表也能处理：自动找出公司名、人名，确认后在整个文件里替换，简称和昵称可以手动添加"],
      ["new", "「使用指南」：在顶栏打开，包含使用步骤、反馈方法和更新日志"],
      ["new", "管理员查看操作记录时可以切换「我的 / 全部」，并按部门或人员筛选"],
      ["improve", "同一个名称在整个文件里统一替换，其他工作表、备注、汇总页里的也一并换掉"],
      ["improve", "图片原样保留并提示；嵌入的附件不放进脱敏文件，不再整份拒绝"],
      ["improve", "出错时的说明改成大白话，并列出需要处理的具体位置"],
      ["improve", "使用统计的明细按任务列出；下拉框和筛选面板统一样式；没有内容的列不能勾选"],
      ["fix", "“/”“无”这类占位符，以及序号、金额、年份、短编号，不再导致生成失败；合并单元格、“客户全称”列也能正确处理"],
      ["fix", "在企业微信里打开后反复加载、无法登录；公司内网环境下选择文件后没有反应"],
    ],
  },
  {
    version: "1.0.1",
    date: "2026-11-03",
    items: [
      ["new", "反馈：结果页可以评价满意或不满意，右上角「反馈」随时提交问题，管理员处理后会回复"],
      ["new", "权限配置：管理员可以同步企业微信通讯录，设置其他管理员"],
      ["new", "使用统计：员工看本人，管理员看全员，可以导出带图表的 Excel 报表"],
      ["improve", "操作记录显示企业微信里的姓名"],
      ["fix", "PowerPoint 图表和文档属性还原不完整"],
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-02",
    items: [
      ["new", "首个版本：文件在本机脱敏，还原记录加密保存在公司服务器，稍后再还原、换电脑还原都可以"],
      ["new", "简短代号（如「客户-K7M4-01」），AI 更容易原样保留"],
      ["new", "操作记录按任务归组，脱敏和还原的进度一目了然"],
    ],
  },
];

export const CURRENT_VERSION = CHANGELOG[0];
