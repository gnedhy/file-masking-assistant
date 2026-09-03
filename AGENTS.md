# Prototype Instructions

## V2 isolation

- This worktree is the only development location for V2. Do not edit, publish, migrate, or delete data from the frozen V1.1 directory or its Sites project.
- V2 uses port `5174`, IndexedDB `file-masking-assistant-v2-vault`, branch `feat/v2-enterprise-vault`, and a separate Sites project.
- V1.1 local mappings are intentionally not migrated. Enterprise mode keeps file bytes in the browser and sends only task mappings and metadata to the enterprise Vault.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Confirmed prototype direction

- The visual direction is an expressive but professional file workspace: asymmetric task rail plus processing canvas, restrained cobalt and green accents, Geist typography, and subtle grid/ambient depth instead of generic flat cards or exaggerated AI futurism. Support persistent `浅色 / 深色 / 系统` modes; `系统` is the default.
- Use the space below the desktop task choices as a compact `本机任务` continuation panel. Show only the count and latest restorable task with a direct import action; do not turn it into task analytics or a security-management dashboard, and never infer that a generated file was downloaded.
- `查看全部任务` may open a bounded local-task drawer showing task ID, creation time, mapping count, and `映射可用`. Allow only per-task manual deletion with an explicit irreversible warning; disable deletion for the task currently in use. Keep automatic retention periods, trend statistics, and bulk cleanup out of V1.
- Open the local-task drawer from the left as an overlay so it extends the left task rail without pushing the active file workbench; use a full-screen panel on mobile.
- Keep the app header identity restrained: the product name stays around 24px on desktop and 18–21px on narrow screens; task titles and empty-state copy must remain visually subordinate and be QA'd at both 1440px and 390px widths.
- The selected visual target is `C:\Users\gnedhy\.codex\generated_images\019fdc85-0678-7d72-9091-ea72203e8c24\exec-34879e88-f755-4e0a-b550-f5f8c362ec0d.png`.
- Keep motion restrained, trustworthy, and task-oriented: short CSS feedback under 300ms, no perpetual decorative sweeps, no playful icon rotation, and complete reduced-motion coverage. Do not add GSAP unless a future interaction genuinely needs timeline choreography.
- On phones, use a compact task-first workspace rather than stacking the desktop composition: a small aligned header, single-line task context, a two-option segmented task switcher, an optional local-task continuation strip, then the file action surface and a quiet three-step local-processing boundary. The primary file action should be visible in the initial 390x844 viewport, use tap-first copy, and preserve the same order in protect and restore modes.
- Product name is `文件脱敏助手`; default to the low-learning-cost two-task interface: `制作脱敏文件` and `还原处理文件`.
- Do not create separate simple and expert processing modes. Processing behavior stays identical; `安全详情` is progressive disclosure in a drawer.
- The product is a local file utility, not an AI analysis product, report generator, data-security admin console, or model platform.
- Keep claims evidence-based. Show what was checked, what stayed local, what was restored, and what remains unresolved; never claim absolute security.
- Keep a discoverable `原理说明` entry in the header. Its primary message is that ordinary masking focuses on hiding values, while this product adds task-bound Tokens, local encrypted mappings, and complete-match restoration for an AI file round trip.
- The current functional proof processes real local files in the browser. Protection supports XLSX, CSV, TXT, MD, and DOCX; restoration supports XLSX, CSV, TXT, MD, DOCX, PPTX, and safe static HTML. Do not describe it as a simulation or a production-stable release.
- Confirmed validation scope: `XLSX/CSV/TXT/MD/DOCX → safe file → AI-generated or modified XLSX/CSV/TXT/MD/DOCX/PPTX/safe static HTML → local restoration in the AI output format`.
- HTML is restore-only in this validation stage. It must be converted to a safe static page locally: remove scripts, forms, frames, remote resources, and event handlers; do not add HTML protection input yet.
- DOCX protection and restoration cover body text, tables, headers, footers, and text boxes. PPTX restoration covers slide text, tables, and speaker notes. Split Office text runs must be reassembled before exact-token replacement.
- Office restoration fails closed for unknown, mixed, altered, unsupported-area, or residual tokens. It does not scan images or treat an absent mapping as an error. Reject macros, encryption/corruption, OLE/embedded packages, files over 20 MB compressed, packages over 250 MB uncompressed, or packages over 5,000 entries. CSV/TXT/MD/HTML stop at 10 MB before reading; XLSX/DOCX/PPTX stop at 20 MB before reading.
- Partial restoration is limited to safe static HTML: exact matching tokens may be restored while altered tokens in allowed visible text remain unchanged with an explicit warning. Other formats continue to fail closed on altered or incomplete tokens.
- After automatic recognition, users can add protected columns inside the safety drawer. Keep the default two-task flow unchanged.
- Show short tokens such as `C001` in the interface, but explain that formal tokens include a task-specific identifier to prevent cross-file mismatches.
- Restoration must visibly match the local task before showing the restorable-token count.
- Do not present legacy XLS, macro-enabled, or encrypted workbooks as supported in the first validation.
- The browser-local vault encrypts mappings with a non-exportable AES-GCM device key stored in IndexedDB. Describe this as a functional proof, not as a production enterprise key vault or OS-keystore guarantee.
- New formal tokens use the visible structure `[[客户名称:C001@7F2A9C4D]]`: the sanitized source field label, short entity code, and eight-character task fingerprint. Legacy `[[C001@7F2A9C4D]]` tokens remain restorable.
- Any unsupported cell in a selected protected column, unknown Token, formula-contained Token, missing local mapping, or mixed task fingerprint must fail closed and produce no output.
- ExcelJS is loaded only after file selection. Real-file support is deliberately limited to ordinary XLSX cells; macros, encryption, charts, and complex embedded objects are outside the verified preservation boundary.
- CSV creation and restoration support comma, tab, or semicolon delimiters, quoted fields, embedded line breaks, UTF-8, UTF-8 BOM, and GB18030 input. Output is normalized to UTF-8 BOM. CSV has no Office formulas, styles, images, or embedded objects.
- File generation and file download are separate user actions. Never label a file as downloaded merely because a Blob was generated or a download request was triggered; use `已生成`, then let the user click a persistent real download link and ask them to confirm through the browser download list.
- Metric columns such as sales amount remain unselected by default but may be explicitly protected. When selected, replace ordinary numeric values, preserve formula definitions, remove cached formula results from the safe copy, and request full recalculation after restoration; explain that the external AI cannot directly aggregate or sort the resulting metric Tokens.
- After de-identified-file generation but before download, make `下载脱敏文件` the only primary action; keep `修改脱敏字段` and `换一个文件` as quiet recovery links and delete the undelivered task mapping before leaving that result.
- After the user requests a download, show a three-step handoff: confirm the download, process the de-identified file with any AI without changing formal Tokens, then return on the same device and browser. Promote `导入 AI 处理后的文件` to the primary action. Keep `再次下载`, `调整字段并生成新文件`, and `处理另一个文件` secondary.
- The empty restoration state must show whether local mappings are available, the latest matching task when present, and the same-device-and-browser requirement.
- Fail-closed errors must lead with a plain-language cause, confirm that no output file was generated and the original file is unchanged, and offer recovery actions. Keep error codes and diagnostic details inside `技术详情` only.
- Returning to field selection after a download request must keep the old encrypted mapping, display the old task fingerprint, and explain that regeneration creates a new task whose file must not be mixed with the old one.

## Agent skills

### Issue tracker

Specs, defects, validation tasks, and follow-up work are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default Matt Pocock triage roles plus project priority labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. Read `CONTEXT.md` and relevant decisions under `docs/adr/` before changing product language or security boundaries. See `docs/agents/domain.md`.
