# Design QA

## Evidence

- Source visual truth: `E:\Work\Daily\2026-08-12_AI安全文件通道原型\.impeccable\review\source.png`
- Browser-rendered implementation: `E:\Work\Daily\2026-08-12_AI安全文件通道原型\.impeccable\review\desktop.png`
- Responsive evidence: `E:\Work\Daily\2026-08-12_AI安全文件通道原型\.impeccable\review\mobile.png`
- Expanded format scope: `E:\Work\Daily\2026-08-12_AI安全文件通道原型\.impeccable\review\desktop-formats.png`
- Added protection editor: `E:\Work\Daily\2026-08-12_AI安全文件通道原型\.impeccable\review\desktop-add-protection.png`
- Updated responsive drawer: `E:\Work\Daily\2026-08-12_AI安全文件通道原型\.impeccable\review\mobile-details.png`
- Desktop viewport and CSS size: `1440 × 1024`
- Source pixels: `1487 × 1058`
- Implementation pixels: `1440 × 1024`
- Device pixel ratio: `1`
- Density normalization: the source was proportionally fitted to the implementation frame for comparison; aspect ratios differ by less than 0.1%.
- Compared state: `制作安全文件 / 文件已选择 / 安全详情已展开 / 敏感信息已识别`

The source and implementation were opened together in one final comparison input. The full-view comparison shows the same 64/36 task-and-evidence split, header height, two-task switcher, dashed workbench, selected file position, recognition summary, evidence trigger, primary action, drawer summary, four checks, mapping table, note, and bottom detail action.

Focused crops were not required: the proportionally aligned desktop frames keep the task controls, drawer rows, mapping values, typography, borders, and icons readable. The narrow-screen capture was reviewed separately for stacking, overflow, persistent primary action visibility, and drawer behavior.

## Required Fidelity Surfaces

- Fonts and typography: uses a Windows-appropriate workhorse UI stack with matching hierarchy, weight steps, wrapping, and tabular numerals. The generated mock's exact font is unavailable; this is an accepted font concession.
- Spacing and layout rhythm: final drawer is 485 px, the left work area is 955 px, the header is 102 px, task choices are 152 px high, and the workbench is 670 px high. The main content landmarks align within a few pixels of the reference.
- Colors and visual tokens: warm off-white, charcoal, cobalt blue, verification green, hairline gray, and pale information surfaces match the approved direction. Color is paired with icons and text status.
- Image and asset fidelity: there are no photographic or illustrative assets. File and safety symbols use one real icon library instead of handmade SVG/CSS drawings. This is the accepted icon concession.
- Copy and content: product-specific sample names and tokens match the approved concept. Prototype-only labels and evidence-bounded wording intentionally replace absolute security claims.

## Interaction Verification

- Switched between `制作安全文件` and `还原 AI 成品`.
- Opened and closed `安全详情`; verified `Escape` closes the drawer.
- At `390 × 844`, verified the drawer receives dialog semantics, focuses its close control, contains Tab navigation, locks the background, and restores focus; when the original trigger is removed by the unresolved state, focus falls back to the labeled work area.
- At `910 × 900`, verified the overlay breakpoint is active and document width remains exactly 910 px with no horizontal crop.
- Completed the simulated safe-copy processing sequence and reached its checked result.
- Continued from safe-copy success into the restoration flow.
- Completed the simulated restoration sequence and reached the 36/36 result.
- Triggered the unresolved-token scenario; verified export stopped and both unresolved positions were shown.
- Verified desktop `1440 × 1024`, laptop `1024 × 768`, narrow `768 × 900`, and mobile-width `390 × 844` behavior.
- Browser console errors and warnings checked after primary flows: none.
- Real XLSX parsing and output were not tested because this artifact is explicitly an interaction prototype.
- The first validation accepts XLSX for both safe-copy creation and restoration; other extensions reach the unsupported-file stop state.
- The XLSX protection editor uses candidate columns, adds a custom item, updates the summary, and appends an `X001` mapping example.
- Restoration shows the matched task `7月销售明细 · 7F2A` before reporting `36 / 36` restorable tokens.
- Output-name round trips preserve the source format (`_安全副本.docx`, `_实名版.xlsx`).

## Comparison History

### Iteration 1

- Earlier P2: the initial desktop workbench ended too high and the main/drawer proportions drifted from the source.
- Fix: set the header, task choices, workbench, and drawer to the measured proportions; retained the evidence drawer as a full-height side region rather than a floating card.
- Post-fix evidence: `desktop.png` now matches the source's main region boundaries and 64/36 composition.

### Iteration 2

- Earlier P2: the selected file and downstream actions did not align to the source's vertical landmarks, and the first focus treatment was too faint for keyboard use.
- Fix: corrected desktop-only state rhythm and drawer width, then replaced the faint conditional ring with a high-contrast native `:focus-visible` treatment.
- Post-fix evidence: the selected file, summary, evidence trigger, primary button, trust line, and drawer content align to the source; keyboard focus remains clearly visible without a custom input-mode script.

### Iteration 3

- Earlier P1/P2: ready-state evidence claimed post-generation checks too early; mobile drawer focus could escape; the hidden file input was keyboard-focusable; a 901–929 px interval could crop horizontally; small evidence text was low contrast.
- Fix: separated identification from post-generation scan evidence, added modal focus containment and restoration below 960 px, removed the hidden input from the Tab order, advanced the overlay breakpoint, strengthened focus and text contrast, and removed layout-column animation.
- Post-fix evidence: build and Sites tests pass; browser recheck covers desktop and mobile task flow, modal focus order, Escape close, and the corrected 910 px breakpoint.

### Iteration 4

- Scope change: safe-copy support expanded from Excel to DOCX/XLSX/CSV; restoration expanded from PPTX/HTML to DOCX/XLSX/CSV/PPTX/static HTML.
- UX change: added an adaptive `添加保护项` editor inside the existing safety drawer, preserving the selected two-task simple flow. Table files select a column; Word accepts exact text.
- Safety clarification: added a task-specific local identifier note and explicit unsupported-format wording. Short interface tokens remain readable without implying that cross-task identity is shared.
- Visual correction: removed a redundant double divider between custom protection and the mapping sample. Desktop width remains contained and mobile retains a 390 px full-width modal drawer with focused close control.
- Post-fix evidence: browser-rendered screenshots were refreshed; no runtime exceptions or horizontal overflow were detected.

### Iteration 5

- Scope correction: the first technical validation is now the same-format `XLSX → XLSX` round trip rather than simultaneous multi-format support.
- UX correction: restoration now surfaces the automatically matched local task and its `36 / 36` token coverage before the primary action.
- Deferred scope: DOCX, CSV, PPTX, HTML, and cross-format restoration remain documented as later validation stages.

## Findings

No actionable P0, P1, or P2 differences remain.

Accepted differences:

- Exact Excel artwork is replaced by a consistent production icon library.
- Prototype disclosure and evidence-bounded safety wording add small text not present in the static concept.
- Exact font face is replaced by a Windows-oriented UI stack.

## Follow-up Polish

- P3: a future implementation can replace generic file icons with company-approved Office file assets if licensing and packaging allow.
- P3: final native Windows packaging should validate text rendering at 125% and 150% display scaling.

final result: passed
