import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PassThrough } from 'node:stream';
import { OPERATION_LABELS, OPERATION_RESULTS } from '../src/operationLog.js';
import { bucketActivity } from '../src/operationReports.js';
import { failureReason } from '../src/errorPresentation.js';

// The records export, laid out like the statistics page:
//   统计分析 — header, metric cards, a trend chart and ranking charts on a paper background;
//   明细     — every record in the filter, streamed from the database;
//   数据表   — the tables behind the charts, as plain numbers.
// exceljs has no charts, so they are added to the finished package as standard DrawingML parts.

const BEIJING = 8 * 60 * 60 * 1000;
// Excel has no time zones: shift to Beijing wall-clock time before writing a date cell.
const beijingDate = time => new Date(new Date(time).getTime() + BEIJING);
const beijingText = time => beijingDate(time).toISOString().slice(0, 16).replace('T', ' ');
const FONT = 'Microsoft YaHei';
const C = {
  paper: 'F4F2EC', card: 'FFFFFF', line: 'E2DFD7', ink: '1F2430', muted: '6B7079', headFill: 'EEF2FB', headLine: 'C5CFEA',
  blue: '3157D5', blueDeep: '2343AA', blueSoft: 'EAF0FD', orange: 'B8651B', green: '187552', red: 'B42318', amber: 'B45309', band: 'F8F7F3',
};
const argb = hex => ({ argb: `FF${hex}` });
const font = (color = C.ink, extra = {}) => ({ name: FONT, size: 10, color: argb(color), ...extra });
const solid = hex => ({ type: 'pattern', pattern: 'solid', fgColor: argb(hex) });
const thin = hex => ({ style: 'thin', color: argb(hex) });
const RESULT_COLORS = { failed: C.red, partial: C.amber, missing: C.amber, waiting: C.amber, success: C.green };

export function describeFilters(session, f) {
  return [
    ['数据范围', session.isAdmin ? (f.user ? `指定用户：${f.user}` : f.userIds ? `指定部门（${f.userIds.length} 人）` : '全部人员') : `仅本人（${session.userName}）`],
    ['日期', `${f.from || '最近 180 天'} 至 ${f.to || '今天'}`],
    ['格式', f.format ? f.format.toUpperCase() : '全部'],
    ['操作', f.action ? OPERATION_LABELS[f.action] : '全部'],
    ['结果', f.issues ? '只看异常（失败、部分还原、内容缺失、待导入钥匙文件）' : f.result ? OPERATION_RESULTS[f.result] : '全部'],
    ['搜索', f.query || '无'],
  ];
}

// A sheet drawn on a grid first, then streamed row by row (streamed rows can't change once committed).
function canvas() {
  const cells = new Map(), merges = [], heights = {};
  let rows = 0, cols = 0;
  const at = (r, c) => { rows = Math.max(rows, r); cols = Math.max(cols, c); const key = `${r}:${c}`; if (!cells.has(key)) cells.set(key, {}); return cells.get(key); };
  return {
    heights,
    // Borders add to what a card already drew instead of replacing it.
    set(r, c, value, style = {}) { const cell = at(r, c); if (value !== undefined) cell.value = value; Object.assign(cell, { ...style, ...(style.border && { border: { ...cell.border, ...style.border } }) }); },
    merge(r1, c1, r2, c2) { if (r1 !== r2 || c1 !== c2) merges.push([r1, c1, r2, c2]); },
    // A card with a hairline frame, like the page's cards.
    card(r1, c1, r2, c2, fill = C.card, edge = C.line) {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const cell = at(r, c);
        cell.fill = solid(fill);
        cell.border = { ...(r === r1 && { top: thin(edge) }), ...(r === r2 && { bottom: thin(edge) }), ...(c === c1 && { left: thin(edge) }), ...(c === c2 && { right: thin(edge) }) };
      }
    },
    extend(r, c) { at(r, c); },
    write(sheet, { background } = {}) {
      for (const [r1, c1, r2, c2] of merges) sheet.mergeCells(r1, c1, r2, c2);
      for (let r = 1; r <= rows; r++) {
        const row = sheet.getRow(r);
        if (heights[r]) row.height = heights[r];
        // The streaming writer drops rows without any value, fills included; an empty string keeps them.
        if (![...cells.keys()].some(key => key.startsWith(`${r}:`) && cells.get(key).value !== undefined)) row.getCell(1).value = '';
        for (let c = 1; c <= cols; c++) {
          const spec = cells.get(`${r}:${c}`) ?? {};
          const cell = row.getCell(c);
          if (spec.value !== undefined) cell.value = spec.value;
          const fill = spec.fill ?? (background && solid(background));
          if (fill) cell.fill = fill;
          for (const key of ['font', 'border', 'alignment', 'numFmt']) if (spec[key]) cell[key] = spec[key];
        }
        row.commit();
      }
    },
  };
}

const change = (now, before, span) => before === null || before === undefined ? '' : now === before ? `与前 ${span} 天持平`
  : `较前 ${span} 天 ${now > before ? '+' : '−'}${Math.abs(now - before)}${before ? `（${now > before ? '+' : '−'}${Math.abs(Math.round(((now - before) / before) * 100))}%）` : ''}`;
const tone = (now, before, lowerIsBetter = false) => before === null || before === undefined || now === before ? C.muted : (now > before) !== lowerIsBetter ? C.green : C.red;

// The chart sources. Returns the canvas plus where each series lives.
function dataSheet({ session, filters, total, analysis }) {
  const grid = canvas(), refs = {};
  let r = 2;
  const title = text => { grid.set(r, 2, text, { font: font(C.blueDeep, { size: 12, bold: true }) }); grid.heights[r] = 22; r += 1; };
  const header = labels => { labels.forEach((label, i) => grid.set(r, i + 2, label, { font: font(C.blueDeep, { bold: true }), fill: solid(C.headFill), border: { bottom: thin(C.headLine) }, alignment: { horizontal: i ? 'center' : 'left', vertical: 'middle' } })); grid.heights[r] = 20; r += 1; };
  const line = (values, formats = []) => { values.forEach((value, i) => grid.set(r, i + 2, value, { font: font(), border: { bottom: { style: 'hair', color: argb(C.line) } }, alignment: { horizontal: i ? 'center' : 'left', vertical: 'middle' }, ...(formats[i] && { numFmt: formats[i] }) })); grid.heights[r] = 19; r += 1; };

  title('导出说明');
  for (const [label, value] of [['导出人', session.userName], ['导出时间', `${beijingText(Date.now())}（北京时间）`], ...describeFilters(session, filters), ['明细条数', total]]) {
    grid.set(r, 2, label, { font: font(C.muted) }); grid.set(r, 3, value, { font: font(), alignment: { horizontal: 'left' } }); grid.merge(r, 3, r, 6); r += 1;
  }
  r += 1;

  const { totals, previous, outcome, span } = analysis;
  title('关键指标');
  header(['指标', '本期', `前 ${span} 天`, '变化', '变化率']);
  const metrics = [['成功脱敏任务', 'protected'], ['有还原结果的任务', 'restored'], ...(session.isAdmin ? [['使用人数', 'users']] : []), ['失败操作', 'failed'], ['导入文件次数', 'imports'], ['下载请求次数', 'downloads']];
  for (const [label, key] of metrics) line([label, totals[key], previous[key], totals[key] - previous[key], previous[key] ? (totals[key] - previous[key]) / previous[key] : null], [null, '0', '0', '+0;-0;0', '+0%;-0%;0%']);
  line(['完成率', outcome.rate / 100], [null, '0%']);
  line(['满意（点赞）', totals.likes, previous.likes], [null, '0', '0']);
  line(['不满意（倒赞）', totals.dislikes, previous.dislikes], [null, '0', '0']);
  line(['满意度', totals.satisfaction === null ? '暂无评价' : totals.satisfaction / 100, previous.satisfaction === null ? '暂无评价' : previous.satisfaction / 100], [null, '0%', '0%']);
  r += 1;

  title('需要关注');
  header(['结果', '次数']);
  if (outcome.issues.length) for (const issue of outcome.issues) line([issue.label, issue.count], [null, '0']);
  else line(['没有需要关注的异常', 0], [null, '0']);
  r += 1;

  const weekly = span > 30;
  const buckets = bucketActivity(analysis.days, weekly ? 7 : 1);
  const label = b => weekly ? `${b.label} 起` : b.label;
  title(weekly ? '处理趋势（按周）' : '处理趋势（按天）');
  header([weekly ? '周起始' : '日期', '脱敏任务', '还原任务', '图表标签']);
  // Every few days only, counted back from the latest, so the chart's axis stays on one line in every spreadsheet app.
  const every = Math.max(1, Math.ceil(buckets.length / 10));
  const axis = buckets.map((b, i) => (buckets.length - 1 - i) % every === 0 ? label(b) : '');
  refs.trend = { first: r, last: r + buckets.length - 1, labels: axis, protect: buckets.map(b => b.protected), restore: buckets.map(b => b.restored) };
  buckets.forEach((b, i) => line([label(b), b.protected, b.restored, axis[i]], [null, '0', '0']));
  r += 1;

  const ranking = (key, heading, name, items) => {
    title(heading);
    header([name, '成功脱敏任务', '占比']);
    const sum = items.reduce((n, item) => n + item.count, 0);
    const shown = items.slice(0, 10);
    refs[key] = { first: r, last: r + shown.length - 1, labels: shown.map(i => i.label), values: shown.map(i => i.count) };
    for (const item of items) line([item.label, item.count, sum ? item.count / sum : 0], [null, '0', '0%']);
    if (!items.length) line(['这段时间没有成功脱敏的任务']);
    r += 1;
  };
  if (session.isAdmin) ranking('people', '人员排行', '用户', analysis.people);
  ranking('formats', '文件格式', '格式', analysis.formats);
  return { grid, refs };
}

// The page itself. Four card columns (B–D, F–H, J–L, N–P) with narrow gutters between them.
const CARD_COLUMNS = [[2, 4], [6, 8], [10, 12], [14, 16]];
function dashboard({ session, filters, total, analysis }) {
  const grid = canvas(), charts = [];
  const { totals, previous, outcome, span } = analysis;
  grid.heights[1] = 12;

  // Header: title, scope tag, range and the one-line summary the page shows.
  grid.set(2, 2, '使用统计', { font: font(C.ink, { size: 22, bold: true }), alignment: { vertical: 'middle' } });
  grid.merge(2, 2, 2, 10); grid.heights[2] = 36;
  grid.card(2, 15, 2, 16, C.blueSoft, 'C7D3F5');
  grid.set(2, 15, session.isAdmin ? '全部人员' : '仅本人', { font: font(C.blue, { bold: true }), alignment: { horizontal: 'center', vertical: 'middle' } });
  grid.merge(2, 15, 2, 16);
  grid.set(3, 2, `${analysis.from} 至 ${analysis.to} · 共 ${span} 天 · 北京时间 · ${session.userName} 导出于 ${beijingText(Date.now())}`, { font: font(C.muted) });
  grid.merge(3, 2, 3, 16); grid.heights[3] = 18;
  const delta = previous.protected ? Math.round(((totals.protected - previous.protected) / previous.protected) * 100) : null;
  const summary = `近 ${span} 天${session.isAdmin ? '' : '你'}处理 ${totals.protected} 个任务${delta === null ? '' : delta === 0 ? `，与前 ${span} 天持平` : `，比前 ${span} 天${delta > 0 ? '多' : '少'} ${Math.abs(delta)}%`}；${outcome.attention ? `${outcome.attention} 项需要关注` : '没有需要关注的异常'}`;
  grid.set(4, 2, summary, { font: font(C.ink, { size: 12 }), alignment: { vertical: 'middle' } });
  grid.merge(4, 2, 4, 16); grid.heights[4] = 24;
  const scope = describeFilters(session, filters).slice(2).filter(([, value]) => value !== '全部' && value !== '无').map(([name, value]) => `${name}：${value}`);
  grid.set(5, 2, `明细 ${total} 条${scope.length ? ` · 筛选 ${scope.join(' · ')}` : ''}`, { font: font(C.muted, { size: 9 }) });
  grid.merge(5, 2, 5, 16);
  grid.heights[6] = 10;

  // Metric cards: label, big number, comparison. Ordinary users get the completion rate instead of the head count.
  const tiles = [
    { label: '成功脱敏任务', value: totals.protected, before: previous.protected, primary: true },
    { label: '有还原结果的任务', value: totals.restored, before: previous.restored },
    session.isAdmin ? { label: '使用人数', value: totals.users, before: previous.users } : { label: '完成率', value: outcome.rate / 100, format: '0%', note: '完全完成的步骤占比', color: C.green },
    { label: '失败操作', value: totals.failed, before: previous.failed, lowerIsBetter: true, color: totals.failed ? C.red : C.ink },
  ];
  tiles.forEach((tile, i) => {
    const [c1, c2] = CARD_COLUMNS[i];
    grid.card(7, c1, 10, c2, tile.primary ? C.blueSoft : C.card, tile.primary ? 'C7D3F5' : C.line);
    grid.set(7, c1, tile.label, { font: font(C.muted), alignment: { vertical: 'bottom', indent: 1 } }); grid.merge(7, c1, 7, c2);
    grid.set(8, c1, tile.value, { font: font(tile.color ?? C.ink, { size: 26, bold: true }), alignment: { vertical: 'middle', indent: 1, horizontal: 'left' }, numFmt: tile.format ?? '0' }); grid.merge(8, c1, 9, c2);
    grid.set(10, c1, tile.note ?? change(tile.value, tile.before, span), { font: font(tile.note ? C.muted : tone(tile.value, tile.before, tile.lowerIsBetter), { size: 9 }), alignment: { vertical: 'top', indent: 1 } }); grid.merge(10, c1, 10, c2);
  });
  Object.assign(grid.heights, { 7: 22, 8: 22, 9: 22, 10: 22, 11: 12 });

  // Trend card with a column chart, and the outcome card beside it.
  grid.card(12, 2, 28, 12);
  grid.set(12, 2, '处理趋势', { font: font(C.ink, { size: 12, bold: true }), alignment: { vertical: 'middle', indent: 1 } }); grid.merge(12, 2, 12, 6);
  grid.set(12, 9, { richText: [{ text: '■ ', font: font(C.blue) }, { text: '脱敏任务    ', font: font(C.muted, { size: 9 }) }, { text: '■ ', font: font(C.orange) }, { text: '还原任务', font: font(C.muted, { size: 9 }) }] }, { alignment: { horizontal: 'right', vertical: 'middle', indent: 1 } });
  grid.merge(12, 9, 12, 12); grid.heights[12] = 26;
  charts.push({ name: '处理趋势', kind: 'trend', from: { col: 1, row: 12, colOff: 60000, rowOff: 20000 }, to: { col: 12, row: 28, colOff: -60000, rowOff: -40000 } });

  grid.card(12, 14, 28, 16);
  grid.set(12, 14, '处理结果', { font: font(C.ink, { size: 12, bold: true }), alignment: { vertical: 'middle', indent: 1 } }); grid.merge(12, 14, 12, 16);
  grid.set(14, 14, outcome.rate / 100, { font: font(C.green, { size: 30, bold: true }), numFmt: '0%', alignment: { horizontal: 'center', vertical: 'middle' } }); grid.merge(14, 14, 16, 16);
  grid.set(17, 14, '完成率', { font: font(C.muted), alignment: { horizontal: 'center' } }); grid.merge(17, 14, 17, 16);
  const rule = { bottom: { style: 'hair', color: argb(C.line) } };
  if (outcome.issues.length) outcome.issues.forEach((issue, i) => {
    const r = 19 + i, color = issue.key === 'failed' ? C.red : C.amber;
    grid.set(r, 14, { richText: [{ text: '● ', font: font(color) }, { text: issue.label, font: font() }] }, { alignment: { indent: 1, vertical: 'middle' }, border: rule }); grid.merge(r, 14, r, 15);
    grid.set(r, 16, issue.count, { font: font(color, { bold: true }), alignment: { horizontal: 'right', indent: 1, vertical: 'middle' }, numFmt: '0', border: rule });
    grid.heights[r] = 22;
  });
  else { grid.set(19, 14, '✓ 没有需要关注的异常', { font: font(C.green), alignment: { horizontal: 'center' } }); grid.merge(19, 14, 19, 16); }
  grid.set(25, 14, { richText: [{ text: '满意度  ', font: font(C.muted) }, { text: totals.satisfaction === null ? '暂无评价' : `${totals.satisfaction}%`, font: font(C.ink, { bold: true, size: 12 }) }, { text: totals.satisfaction === null ? '' : `   满意 ${totals.likes} · 不满意 ${totals.dislikes}`, font: font(C.muted, { size: 9 }) }] }, { alignment: { indent: 1, vertical: 'middle' }, border: { top: { style: 'hair', color: argb(C.line) } } });
  grid.merge(25, 14, 25, 16); grid.heights[25] = 24;
  grid.set(27, 14, '完全完成的步骤占全部处理结果的比例，未发起还原的任务不计入。', { font: font(C.muted, { size: 8 }), alignment: { wrapText: true, vertical: 'top', indent: 1 } }); grid.merge(27, 14, 28, 16);
  grid.heights[29] = 12;

  // Ranking cards with horizontal bar charts.
  const rankCard = (c1, c2, title, key, empty) => {
    grid.card(30, c1, 44, c2);
    grid.set(30, c1, title, { font: font(C.ink, { size: 12, bold: true }), alignment: { vertical: 'middle', indent: 1 } }); grid.merge(30, c1, 30, c2);
    grid.heights[30] = 26;
    if (empty) { grid.set(36, c1, '这段时间没有成功脱敏的任务。', { font: font(C.muted), alignment: { horizontal: 'center' } }); grid.merge(36, c1, 36, c2); return; }
    charts.push({ name: title, kind: key, from: { col: c1 - 1, row: 30, colOff: 40000, rowOff: 20000 }, to: { col: c2, row: 44, colOff: -40000, rowOff: -40000 } });
  };
  if (session.isAdmin) { rankCard(2, 8, '活跃用户', 'people', !analysis.people.length); rankCard(10, 16, '文件格式', 'formats', !analysis.formats.length); }
  else rankCard(2, 16, '文件格式', 'formats', !analysis.formats.length);

  grid.heights[45] = 12;
  grid.set(46, 2, '统计口径：任务按用户与任务编号去重；失败按操作计次，部分还原、内容缺失和待导入钥匙文件不计为失败。完整明细见“明细”工作表，图表数据见“数据表”工作表。', { font: font(C.muted, { size: 9 }), alignment: { wrapText: true, vertical: 'top' } });
  grid.merge(46, 2, 47, 16);
  grid.extend(49, 17);
  return { grid, charts };
}

const COLUMNS = [
  { header: '时间（北京时间）', key: 'time', width: 18 },
  { header: '用户', key: 'user', width: 14 },
  { header: '任务编号', key: 'task', width: 12 },
  { header: '输入文件名', key: 'input', width: 38 },
  { header: '输出文件名', key: 'output', width: 38 },
  { header: '格式', key: 'format', width: 9 },
  { header: '操作', key: 'action', width: 18 },
  { header: '结果', key: 'result', width: 30 },
];
const CENTERED = new Set([3, 6, 8]);

async function writeDetail(book, batches, pageSetup) {
  const sheet = book.addWorksheet('明细', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }], pageSetup: { ...pageSetup, orientation: 'landscape' } });
  sheet.pageSetup.printTitlesRow = '1:1';
  sheet.columns = COLUMNS;
  sheet.autoFilter = { from: 'A1', to: 'H1' };
  const head = sheet.getRow(1);
  head.height = 26;
  head.eachCell((cell, column) => {
    cell.font = font(C.blueDeep, { bold: true });
    cell.fill = solid(C.headFill);
    cell.border = { bottom: thin(C.headLine) };
    cell.alignment = { vertical: 'middle', horizontal: CENTERED.has(column) ? 'center' : 'left', indent: column === 1 ? 1 : 0 };
  });
  head.commit();
  let index = 0;
  for await (const batch of batches) {
    for (const r of batch) {
      const row = sheet.addRow({
        time: beijingDate(r.time), user: r.userName, task: r.marker || r.taskId?.slice(0, 8) || '—',
        input: r.inputName || '未记录', output: r.outputName || '未记录', format: r.format?.toUpperCase() || '—',
        action: OPERATION_LABELS[r.action], result: r.result === 'failed' && failureReason(r.errorCode) ? `${OPERATION_RESULTS[r.result]}：${failureReason(r.errorCode)}` : OPERATION_RESULTS[r.result],
      });
      const banded = index++ % 2 === 1;
      row.height = 20;
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        const resultColor = RESULT_COLORS[r.result];
        cell.font = column === 8 ? font(resultColor ?? C.ink, { bold: Boolean(resultColor) && r.result !== 'success' })
          : font(column === 1 || ((column === 4 || column === 5) && cell.value === '未记录') ? C.muted : C.ink);
        if (banded) cell.fill = solid(C.band);
        cell.border = { bottom: { style: 'hair', color: argb(C.line) } };
        cell.alignment = { vertical: 'middle', horizontal: CENTERED.has(column) ? 'center' : 'left', indent: column === 1 ? 1 : 0 };
      });
      row.getCell(1).numFmt = 'yyyy-mm-dd hh:mm';
      row.commit();
    }
  }
  sheet.commit();
}

// ---- Charts (DrawingML), written into the finished package ----
const esc = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const text = (size, color, bold = false) => `<c:txPr><a:bodyPr rot="0" vert="horz" wrap="none" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr>`;
const strRef = (ref, values) => `<c:strRef><c:f>${ref}</c:f><c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
const numRef = (ref, values) => `<c:numRef><c:f>${ref}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef>`;
const range = (col, first, last) => `'数据表'!$${col}$${first}:$${col}$${last}`;

function series(index, name, color, labels, values, catRef, valRef, labelsOn) {
  return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${esc(name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`
    + (labelsOn ? `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${text(900, C.ink, true)}<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` : '')
    + `<c:cat>${strRef(catRef, labels)}</c:cat><c:val>${numRef(valRef, values)}</c:val></c:ser>`;
}

function barChart({ horizontal, seriesXml, gap }) {
  const axisLine = `<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="${C.line}"/></a:solidFill></a:ln></c:spPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>`
    + `<c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${seriesXml}<c:gapWidth val="${gap}"/><c:overlap val="${horizontal ? 0 : -8}"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>`
    + `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${horizontal ? '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>' : axisLine}${text(900, horizontal ? C.ink : C.muted)}<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:tickLblSkip val="1"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    + `<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${horizontal ? 1 : 0}"/><c:axPos val="${horizontal ? 't' : 'l'}"/>${horizontal ? '' : `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="ECEAE4"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>`}<c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${text(900, C.muted)}<c:crossAx val="5001"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`
    + `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>`
    + `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${text(900, C.muted)}</c:chartSpace>`;
}

function chartXml(kind, refs) {
  if (kind === 'trend') {
    const t = refs.trend;
    return barChart({ gap: t.labels.length > 20 ? 40 : 80, seriesXml:
      series(0, '脱敏任务', C.blue, t.labels, t.protect, range('E', t.first, t.last), range('C', t.first, t.last), false)
      + series(1, '还原任务', C.orange, t.labels, t.restore, range('E', t.first, t.last), range('D', t.first, t.last), false) });
  }
  const rank = refs[kind];
  return barChart({ horizontal: true, gap: 60, seriesXml: series(0, '成功脱敏任务', C.blue, rank.labels, rank.values, range('B', rank.first, rank.last), range('C', rank.first, rank.last), true) });
}

// Anchors are zero-based cells plus EMU offsets; a negative offset ends that far before the cell's left/top edge.
const EMU_COLUMN = 11 * 7 * 9525, EMU_ROW = 20 * 9525;
const anchorPoint = ({ col, row, colOff, rowOff }) => `<xdr:col>${col}</xdr:col><xdr:colOff>${colOff}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${rowOff}</xdr:rowOff>`;
const endPoint = ({ col, row, colOff, rowOff }) => anchorPoint({ col: colOff < 0 ? col - 1 : col, row: rowOff < 0 ? row - 1 : row, colOff: colOff < 0 ? EMU_COLUMN + colOff : colOff, rowOff: rowOff < 0 ? EMU_ROW + rowOff : rowOff });

async function addCharts(buffer, charts, refs) {
  if (!charts.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const chartType = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
  const anchors = charts.map((chart, i) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${anchorPoint(chart.from)}</xdr:from><xdr:to>${endPoint(chart.to)}</xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${esc(chart.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`);
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.join('')}</xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${charts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join('')}</Relationships>`);
  charts.forEach((chart, i) => zip.file(`xl/charts/chart${i + 1}.xml`, chartXml(chart.kind, refs)));

  // The analysis sheet is the first worksheet the writer produced.
  const sheetPath = 'xl/worksheets/sheet1.xml', relsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  let sheet = await zip.file(sheetPath).async('string');
  if (!/<worksheet[^>]*xmlns:r=/.test(sheet)) sheet = sheet.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  zip.file(sheetPath, sheet.replace('</worksheet>', '<drawing r:id="rIdCharts"/></worksheet>'));
  const drawingRel = '<Relationship Id="rIdCharts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>';
  const rels = zip.file(relsPath) ? await zip.file(relsPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  zip.file(relsPath, rels.replace('</Relationships>', `${drawingRel}</Relationships>`));
  const types = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', types.replace('</Types>', `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${charts.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="${chartType}"/>`).join('')}</Types>`));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const PAGE = { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };

// Builds the whole workbook and returns it as a Buffer.
export async function recordsWorkbook(options) {
  const chunks = [], stream = new PassThrough();
  stream.on('data', chunk => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject); });
  const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  book.creator = '文件脱敏助手';

  const data = dataSheet(options);
  const page = dashboard(options);
  const analysis = book.addWorksheet('统计分析', { views: [{ showGridLines: false }], properties: { tabColor: argb(C.blue) }, pageSetup: { ...PAGE, orientation: 'landscape' } });
  analysis.columns = [{ width: 2 }, ...Array.from({ length: 15 }, (_, i) => ({ width: [3, 7, 11].includes(i) ? 2 : 11 })), { width: 2 }];
  page.grid.write(analysis, { background: C.paper });
  analysis.commit();

  await writeDetail(book, options.batches, PAGE);

  const tables = book.addWorksheet('数据表', { views: [{ showGridLines: false }], pageSetup: { ...PAGE, orientation: 'portrait' } });
  tables.columns = [{ width: 3 }, { width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  data.grid.write(tables);
  tables.commit();
  await book.commit();
  await finished;
  return addCharts(Buffer.concat(chunks), page.charts, data.refs);
}
