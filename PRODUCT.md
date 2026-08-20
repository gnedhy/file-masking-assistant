# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 and Vite. ExcelJS is loaded on demand only after a user selects a workbook; ordinary interface feedback uses CSS transitions.

## Users

Primary users are AI operations staff and business analysts who need to give a sensitive sales Excel workbook to an external AI, then restore an AI-modified Excel workbook inside the enterprise environment.

Reviewers such as business owners or IT may inspect safety evidence, but they are not the default daily interaction model.

## Product Purpose

Create a tokenized safe XLSX, CSV, TXT, MD, or DOCX locally, let the user work with any external AI outside this product, then restore an AI-generated or modified XLSX, CSV, TXT, MD, DOCX, PPTX, or safe static HTML to real enterprise names locally. Success means ordinary users can complete the round trip without learning security terminology, while unresolved or unsupported content is never silently exported.

## Positioning

The external AI can understand what happened to an entity without receiving the entity's real identity. The mapping between real values and entity tokens remains on the local device or inside the enterprise boundary.

## Operating Context

The first validation scenario uses sales-detail files containing customer, product, and salesperson identifiers. The same two-task workflow creates a safe XLSX, CSV, TXT, MD, or DOCX and restores supported AI outputs. The product does not analyze the source data itself, connect to CRM or ERP, or write back into production systems.

## Capabilities and Constraints

- Safe-file creation formats: XLSX, CSV, TXT, MD, and DOCX. Restore formats: XLSX, CSV, TXT, MD, DOCX, PPTX, and safe static HTML.
- Users confirm detected sensitive categories before creating a de-identified file.
- Users may add protected columns after automatic recognition.
- Every formal token carries a task-specific identifier even though the interface shows a short code such as `C001`.
- Restoration automatically matches the local task before showing the count of restorable tokens.
- Safety evidence is available on demand through a detail drawer; it does not change processing behavior.
- A persistent `原理说明` entry explains the distinction from ordinary field masking: task-bound Tokens, encrypted local mappings, and fail-closed restoration checks.
- Restoration must surface unresolved tokens and stop incomplete export rather than report silent success.
- The functional proof performs real XLSX parsing, token replacement, download, task matching, and restoration in the browser.
- Local mappings are encrypted with AES-GCM using a non-exportable browser key and stored in IndexedDB. This is not yet an enterprise Token Vault, OS-keystore integration, managed key lifecycle, or secure deletion guarantee.
- Unsupported cells in a selected protected column, unknown Tokens, mixed task fingerprints, missing local mappings, and formula-contained Tokens stop export.
- A completed transformation is shown as `文件已生成`, not `已下载`. Download is a separate explicit action through a persistent file link because a browser page cannot reliably prove that the operating system saved the file.
- After a de-identified file download is requested, the result state explicitly hands the user off to any external AI, asks them to preserve formal Tokens, and labels the return action `导入 AI 处理后的文件`.
- The restoration entry shows whether this browser has local restorable tasks, identifies the latest task, and reminds the user to return on the same device and browser.
- The local-task summary shows the number of restorable tasks and the total encrypted mapping entries in the current browser. A bounded drawer lists task name, task ID, creation time, mapping count, and `映射可用`; individual mappings can be manually deleted only after an irreversible-impact confirmation. Automatic retention periods are not part of V1.
- Restoration failures use plain-language causes and recovery actions by default. Technical error codes remain available only in the on-demand detail drawer, and every failed safety check produces no output file.
- Numeric metrics are not protected by default because Token replacement removes direct aggregation and sorting. If the user explicitly selects one, ordinary numeric cells are tokenized, formula definitions are retained, cached formula results are removed from the safe copy, and the restored workbook is marked for full recalculation.
- Before a generated safe file has been requested for download, users can return to field selection without re-uploading; the undelivered task mapping is deleted before editing or switching files.
- After a safe-file download has been requested, the primary action becomes restoration. Returning to field selection creates a new task and keeps the old encrypted mapping so the previously delivered file remains restorable.
- The first validation rejects legacy XLS, macro-enabled workbooks, and encrypted workbooks.
- PPTX creation-side tokenization, PDF, OCR, image text, chart text, SmartArt, macros, and embedded objects remain out of scope.
- TXT and Markdown are processed as non-executable UTF-8 text. Candidates come from explicit labels and Markdown tables, can be searched or supplemented manually, and preserve UTF-8 BOM plus CRLF/LF. JSON, XML, and logs are not treated as supported aliases.
- DOCX protection covers body text, ordinary tables, headers, footers, text boxes, and values split across adjacent runs. Actual comments, footnotes/endnotes, revisions, content controls, and fields stop protection instead of being silently skipped.
- CSV supports comma, tab, and semicolon delimiters; quoted fields and embedded line breaks; UTF-8, UTF-8 BOM, and GB18030 input. Output is normalized to UTF-8 BOM for reliable Chinese display in Excel. Files over 50 MB, 200,000 rows, 500 columns, or 5,000,000 fields stop safely.
- DOCX restore covers body text, tables, headers, footers, and text boxes; PPTX restore covers slide text, tables, and speaker notes. Exact tokens split across adjacent Office text runs are reassembled and inherit the first token run's style.
- Office files are processed locally with strict package limits: 50 MB compressed, 250 MB uncompressed, and 5,000 entries. Macros, encrypted/corrupt files, OLE/embedded packages, unknown or mixed tokens, altered token syntax, unsupported-area tokens, and post-restore residuals stop output.
- Images are not scanned. Missing mappings that do not appear in the file are not errors, and longer restored text may require layout review in Office.
- No AI analysis, report generation, model connection, organization administration, production-system integration, or automatic write-back.

## Brand Commitments

Product name: `文件脱敏助手`.

Voice: calm, direct, operational, and understandable without terms such as Token Vault, Late Binding, or Rehydration.

User-facing task language: `制作脱敏文件` and `还原处理文件`. Generated filenames use `脱敏版` and `还原版`; technical terms such as Token remain inside explanations or diagnostics.

The approved visual reference uses a warm off-white surface, dark charcoal text, cobalt primary actions, quiet green verification states, precise dividers, and generous spacing.

## Evidence on Hand

- Approved visual target: `C:\Users\gnedhy\.codex\generated_images\019fdc85-0678-7d72-9091-ea72203e8c24\exec-34879e88-f755-4e0a-b550-f5f8c362ec0d.png`.
- Illustrative sample mapping supplied by the user: `浙江ABC染整 → C001`, `HT-825GK → P017`, `张三 → S008`.
- Interface counts and filenames come from the workbook selected in the current browser session; they are not production operating metrics.

## Product Principles

- Simple by default; evidence on demand.
- Show verifiable checks instead of abstract security promises.
- Explain that the product is designed for a reversible AI file round trip, not only for hiding source values.
- Keep real identities and mapping inside the enterprise boundary.
- Fail closed when restoration is incomplete or a format is unsupported.
- Preserve the original file and require a deliberate export action.

## Accessibility & Inclusion

All core actions must work by keyboard, expose visible focus, retain readable contrast, and respect reduced-motion preferences. Status must not rely on color alone.
