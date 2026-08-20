---
name: "文件脱敏助手"
description: "在本机完成敏感文件脱敏与还原的轻量工具。"
colors:
  paper: "#f1efe9"
  surface: "#fbfaf7"
  ink: "#15171b"
  muted: "#626771"
  blue: "#3157d5"
  blue-deep: "#2444af"
  green: "#187552"
  dark-paper: "#0d0f12"
  dark-surface: "#14171c"
  dark-ink: "#f3f1eb"
  dark-muted: "#a9adb5"
  dark-blue: "#8ba3ff"
  dark-green: "#6fc89d"
typography:
  display:
    fontFamily: '"Geist Variable", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "24px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: '"Geist Variable", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "clamp(30px, 3.15vw, 48px)"
    fontWeight: 620
    lineHeight: 1.04
    letterSpacing: "-0.055em"
  title:
    fontFamily: '"Geist Variable", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "clamp(20px, 1.7vw, 24px)"
    fontWeight: 700
    lineHeight: 1.24
    letterSpacing: "-0.025em"
  body:
    fontFamily: '"Geist Variable", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: '"Geist Variable", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "13px"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  progress: "3px"
  sm: "6px"
  md: "8px"
  control: "9px"
  panel: "22px"
  task: "16px"
  brand: "18px"
  round: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "32px"
  drawer: "36px"
components:
  button-primary:
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "18px 30px"
    height: "74px"
    width: "min(100%, 390px)"
  button-primary-compact:
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "14px 23px"
    height: "56px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "13px 22px"
    height: "56px"
  task-choice:
    backgroundColor: "color-mix(in srgb, var(--surface) 82%, transparent)"
    rounded: "{rounded.task}"
    padding: "21px"
    height: "142px"
  task-choice-active:
    textColor: "{colors.surface}"
    rounded: "{rounded.task}"
    padding: "21px"
    height: "142px"
  theme-switcher:
    modes: "light | dark | system"
    default: "system"
    persistence: "localStorage"
    rounded: "10px"
  local-task-panel:
    purpose: "summarize local restoration tasks and mapping totals without becoming a security dashboard"
    rounded: "16px"
    maxVisibleTasks: 1
  local-tasks-drawer:
    fields: "task name | task ID | created time | mapping count | mapping status"
    placement: "left overlay aligned with the local task rail; full-screen on mobile"
    cleanup: "manual per-task deletion with irreversible-impact confirmation"
    retentionPolicy: "deferred"
  evidence-trigger:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "14px 20px"
    height: "64px"
    width: "min(100%, 555px)"
  file-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "20px 22px"
    height: "116px"
    width: "100%"
  prototype-chip:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "5px 9px"
  drawer-summary-pending:
    textColor: "{colors.blue}"
    rounded: "{rounded.control}"
    padding: "15px 18px"
    height: "78px"
  mapping-table:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    width: "100%"
---

# Design System: 文件脱敏助手

## Overview

**Creative North Star: "脱敏后使用，还原后交付"**

“脱敏后使用，还原后交付”把企业内敏感文件的处理变成一条可见、可复核、低负担的操作路径。界面采用高频内部工具的 Operate 模式：默认只呈现两项任务、当前文件和唯一主动作，证据按需展开，不把使用者置于复杂安全后台中。

视觉以暖白纸面和炭黑文本建立安静的文档感，钴蓝只推动关键动作，墨绿只标记已验证结果；细边框承担大部分分层，阴影只提示结构或交互状态。桌面保留主工作区与证据抽屉的并列关系，窄屏将抽屉转为受控模态层。拒绝营销式 AIDA、滚动叙事、复杂仪表盘和夸张动效。

**Key Characteristics:**

- 高频、低学习成本的企业内部工具
- 默认简单视图，证据按需展开
- 暖白纸面、钴蓝主动作、墨绿核验和克制边框
- 状态同时由图标、文字和颜色表达

## Colors

调色盘以暖白和中性灰维持长时间操作的安静感，只用三组语义色表达动作、核验与拦截。

### Primary

- **行动钴蓝**（`blue`、`blue-deep`）：用于主按钮、当前任务、键盘焦点、进度和可执行链接；它说明“现在可以做什么”。

### Secondary

- **核验墨绿**（`green`、`green-soft`）：用于本机状态、已识别、已通过和可安全使用的结果；它不是第二种主动作色。

### Tertiary

- **拦截琥珀**（`amber`、`amber-soft`）：只用于不支持、未还原和导出停止等需人工处理的状态。

### Neutral

- **暖白纸面**（`paper`）：全局背景和页眉基底，维持接近文档工作台的观感。
- **白色工作面**（`surface`）：承载文件卡、按钮、证据触发器、标签和数据表。
- **炭黑墨色**（`ink`）：标题、关键文件名和主要结论。
- **说明灰**（`muted`）：解释、元数据和辅助信息。
- **精确分隔线**（`line`、`line-soft`）：定义工作区、抽屉、卡片和表格的结构，不制造厚重面板。
- **模态遮罩**（`scrim`）：始终使用中性深色压低背景；深色模式不得由浅色文字色反推遮罩，避免产生白雾。

### Named Rules

**The Cobalt Is Action Rule.** 钴蓝推动任务，不能被大面积铺成装饰背景；例外仅限当前任务卡这一明确选中态。

**The Status Meaning Rule.** 钴蓝推动、墨绿核验、琥珀拦截；三者不得互换，也不得只靠颜色传达状态。

## Typography

**Display Font:** Segoe UI Variable（回退至 Segoe UI、苹方和微软雅黑 UI）
**Body Font:** Segoe UI Variable（使用同一回退栈）
**Label/Mono Font:** 同一 UI 字体栈；数字通过等宽数字特性对齐，不另引入等宽字体

**Character:** 这是一套清楚、耐读、适合 Windows 企业环境的工作字体。层级依靠字号、字重和紧凑的负字距形成，不依赖装饰性字体或夸张大字。

### Hierarchy

- **Display:** 仅用于产品名，固定在 28px 左右，作为应用识别而非营销标题。
- **Headline:** 用于处理中、成功和拦截等关键状态结论。
- **Title:** 用于两项任务选择及主要文件标题。
- **Body:** 用于流程说明、结果解释和较长的安全边界文字。
- **Label:** 用于状态眉题、数值标签和紧凑的证据说明；表格数值与日期使用 tabular numerals。

### Named Rules

**The Workhorse Type Rule.** 所有文字先服务扫描和操作；不用展示型字体、超大口号或营销式字级跳跃制造气氛。

## Layout

桌面基线是顶部页眉与下方任务区：页眉高 84px；证据抽屉打开时，主区与抽屉形成 `minmax(620px, 1fr) / minmax(390px, 485px)` 两列，在 1440px 视口呈现约 64/36 的工作与证据比例。无抽屉时，工作区限制在 1120px 内；两个任务卡采用接近等分的双列，任务卡高 132px，下面是随视口在 500–620px 之间调整的虚线处理台。

在 1180px 及以下缩短任务卡和处理台；在 960px 及以下改为单列，证据抽屉成为右侧固定覆盖层，宽度不超过 490px 或视口的 92%；在 640px 及以下任务卡纵向堆叠、主按钮占满可用宽度、抽屉铺满屏幕。抽屉开启时窄屏背景不可交互，焦点留在抽屉内。

常规间距使用 frontmatter 中已提取的 8–36px 节奏。关键区域依靠留白、细线和单一对齐轴组织，不加入可折叠导航树、指标墙或多栏控制台。

**The One Task Focus Rule.** 每个状态只保留一个视觉主动作；安全证据可以靠近主流程，但必须作为按需检查层而非第二工作台。

## Elevation & Depth

系统采用“平面为主、结构抬升为辅”的混合策略。静态层级主要由纸面色差、细边框和留白完成；阴影只标记被选中的任务、可执行主按钮、从边缘进入的抽屉或临时通知。

### Shadow Vocabulary

- **File card rest** (`0 1px 3px rgba(18, 28, 45, 0.035)`): 只让已选文件从处理台背景中轻微分离。
- **Active task** (`0 7px 20px rgba(7, 91, 229, 0.13)`): 表示当前选中的任务卡。
- **Primary action rest** (`0 8px 20px rgba(7, 91, 229, 0.17)`): 让唯一主动作在宽阔处理台中可立即定位。
- **Primary action hover** (`0 10px 25px rgba(7, 91, 229, 0.23)`): 仅在精细指针设备上增强响应。
- **Desktop drawer seam** (`-5px 0 18px rgba(25, 31, 39, 0.025)`): 强调桌面证据区域的结构接缝。
- **Overlay drawer** (`-18px 0 48px rgba(18, 25, 33, 0.16)`): 只用于 960px 以下的模态覆盖层。
- **Toast** (`0 16px 38px rgba(16, 21, 27, 0.2)`): 只用于短暂的全局反馈。

**The Structural Shadow Rule.** 阴影必须说明选中、边缘层级或临时反馈；普通卡片不得用浓重悬浮阴影制造后台面板感。

## Shapes

形态以轻柔圆角矩形为主：进度轨道最克制，标签与数据格略小，按钮和状态摘要统一为控件圆角，任务卡和品牌标记略宽松。圆形只用于文件/安全图标容器、步骤编号和结果印章；常规按钮不做胶囊形。

处理台用钴蓝细虚线界定文件落点，卡片、抽屉与表格用灰色细实线建立结构。当前任务卡底部保留一个小型向下指示角，明确它与处理台的从属关系；映射表和拦截表通过容器裁切保持连续表格轮廓。

**The Rectangles Stay Rectangular Rule.** 主要控件保持克制圆角，不把按钮、卡片和状态条全部胶囊化；圆形只承担图标和步骤语义。

## Components

### Buttons

- **Primary:** 钴蓝渐变、白字和右向图标构成唯一主动作；常规形态高 82px，结果页紧凑形态高 56px。
- **Secondary:** 白色底、灰色细边框和较低字级，用于重置、返回或补充动作。
- **Hover / Focus / Active:** 精细指针悬停只增加阴影；键盘焦点使用 3px 钴蓝外轮廓并偏移 3px；按下缩放至 0.975，不加入弹跳或旋转。

### Task Switcher

- **Default:** 白色半透明任务卡、圆形文件图标和两级文字，保持可扫描但不抢主流程。
- **Active:** 钴蓝渐变、白色文字、轻阴影和底部指示角共同表达选中；移动端纵向堆叠并取消指示角。

### Local Task Panel

- **Placement:** 位于桌面左侧任务选择下方，与任务选择共同构成任务轨道；右侧处理台始终只负责当前文件。
- **Content:** 显示本机任务数量、映射总数、最近任务名称、生成时间、任务号和映射仍在当前浏览器的事实；不推断文件是否已下载。
- **Action:** 有任务时提供 `导入处理后的文件`，切换到还原任务并打开文件选择；没有任务时只解释任务会在何时出现。
- **Task drawer:** `查看全部任务` 从左侧打开有限的管理抽屉，覆盖任务轨道而不挤压当前文件工作区；逐项显示任务编号、生成时间、映射数量和 `映射可用`，当前使用中的任务不可删除。移动端使用全屏面板。
- **Cleanup:** 单任务删除必须在任务行内二次确认，并明确说明对应脱敏文件之后无法在当前浏览器还原；删除失败时保持原映射并提供清楚反馈。
- **Boundary:** V1 不提供趋势统计、批量清理或自动保留期限，避免形成数据安全后台。

### Selected File & Empty State

- **Selected file:** 白色文件卡包含真实文件类型图标、文件名、大小、修改时间和移除按钮；长文件名截断而不破坏布局。
- **Empty state:** 整个处理台中央区域可触发选文件，支持拖放；上传图标、文件类型说明和小型按钮形成单一路径。

### Evidence Trigger

- **Style:** 白色横向控件，左侧以墨绿盾牌和识别摘要说明“有什么证据”，右侧钴蓝文字说明“查看什么”。
- **Behavior:** 打开同一个安全详情抽屉；成功态仅改变证据文案和边框语气，不升级成第二主按钮。

### Security Drawer

- **Desktop:** 作为全高右侧结构区与工作台并列，包含摘要、四条证据、映射示例、说明和明细入口。
- **Narrow:** 在 960px 及以下成为带遮罩的模态抽屉，支持焦点约束、Escape 关闭与关闭后焦点还原；在 640px 及以下全宽。
- **Motion:** 抽屉以 260ms 的短距离横移淡入；遮罩淡入 180ms。所有常规控件使用 160ms 状态过渡。

### Protection Items

- **Placement:** 只在“制作脱敏文件”的安全详情中出现，不增加主界面步骤，也不形成独立高级模式。
- **Column input:** XLSX 与 CSV 使用相同的候选列确认方式。TXT、MD 与 DOCX 使用“敏感内容候选—上下文—出现次数—手动增删”的共用确认方式。
- **Safety cue:** 金额、日期等分析指标默认保留并解释原因；任务标识在抽屉底部用普通语言说明，短代号仅用于界面展示。
- **Format identity:** 制作端根据 XLSX、CSV、TXT、MD、DOCX 切换文件标记；还原端根据 XLSX、CSV、TXT、MD、DOCX、PPTX、HTML 自动切换文件图标、格式说明和原格式下载扩展名。
- **Restore evidence:** 安全详情显示文件格式、任务指纹、发现代号数、使用映射数、已检查区域和首版不承诺范围，并明确图片未扫描、未出现的映射不代表异常。

### Status, Progress & Mapping

- **Pending / Success / Blocked:** 信息蓝、核验绿和拦截琥珀分别配套图标与文字；成功和错误结果使用圆形印章强化结论。
- **Progress:** 三步列表与水平进度条同步；常规状态反馈使用不超过 300ms 的 CSS 动效。减少动态时移除位移动画，但保留短促的颜色与边框反馈。
- **Mapping:** 三列映射表以箭头连接原始内容和安全代号/实名结果，结果列用淡绿字段；未还原项切换为琥珀拦截表。

### Chip

- **Prototype chip:** 小型白底灰边标签只标注“交互原型”，不承担筛选、导航或主状态职责。

## Do's and Don'ts

### Do:

- Do show one explicit primary action per task state and keep evidence subordinate.
- Do pair every status color with an icon and plain-language text.
- Do preserve the warm-paper base, cobalt action, green verification and hairline structure.
- Do turn the evidence drawer into a focus-contained overlay at the implemented narrow breakpoint.
- Do keep motion brief, state-driven and fully reduced by the existing reduced-motion behavior.

### Don't:

- Don't turn this into a complex security backend, metric dashboard or administration console.
- Don't use marketing AIDA, scroll storytelling, oversized slogans or decorative motion.
- Don't make pills the default silhouette or add heavy shadows to ordinary surfaces.
- Don't use green as a primary action, cobalt as a verification result or amber as decoration.
- Don't hide unresolved states or imply trust through color alone.
