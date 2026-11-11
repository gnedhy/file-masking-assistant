// People write a customer's short name in notes and summaries: 广州宏图化工有限公司 becomes 宏图化工 or just 宏图.
// A column of full names does not catch those, so the likely short forms are worked out from each full name and
// offered as keywords when they really occur somewhere outside the full name.

const SUFFIX = /(?:集团)?(?:股份有限公司|有限责任公司|有限公司)$|(?:集团|公司|工厂|厂|商行|经营部|门市部)$/;
const PROVINCES = "北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门";
const CITIES = "广州|深圳|佛山|东莞|中山|珠海|惠州|江门|肇庆|清远|汕头|潮州|揭阳|汕尾|湛江|茂名|阳江|云浮|韶关|河源|梅州|"
  + "杭州|宁波|温州|绍兴|嘉兴|湖州|金华|台州|南京|苏州|无锡|常州|南通|扬州|徐州|昆山|厦门|泉州|福州|漳州|晋江|石狮|"
  + "济南|青岛|烟台|潍坊|淄博|武汉|长沙|郑州|成都|西安|合肥|南昌|南宁|昆明|贵阳|沈阳|大连|长春|哈尔滨|石家庄|太原|兰州|海口|三亚";
const REGION = new RegExp(`^(?:中国|(?:${PROVINCES})省?|(?:${CITIES})市?)`);
// After a known province or city, a district, county or town can follow: 清远市清新区山塘镇….
const SUBREGION = /^[一-龥]{2,3}?(?:区|县|镇|乡)(?=[一-龥]{2,})/;
// Trade words that follow the brand; taken off the end to reach the brand itself.
const TRADE = /(?:精细化工|新材料|有机硅|化工|化学|科技|技术|贸易|商贸|工贸|实业|材料|电子|电器|机械|设备|制造|制品|用品|洗涤|纺织|印染|染整|针织|服饰|服装|鞋业|皮革|塑胶|塑料|橡胶|树脂|助剂|涂料|油墨|五金|建材|家具|日化|生物|医药|食品|包装|物流|供应链|国际|发展|投资|控股|工业|能源|环保|装饰|工程|建设|信息|网络|软件|智能)$/;
// Left after stripping, these say nothing about one company.
const GENERIC = /^(?:华南|华北|华东|华中|华西|东方|南方|北方|西部|中国|国际|环球|世纪|新世纪|第一|联合|中心|总部)$/;
const MAX_NAMES = 2000;

// The short forms of one full company name, longest first: ["宏图化工", "宏图"]. Empty when it is not a company name.
export function companyShortNames(fullName) {
  let name = String(fullName ?? "").trim().replace(/[（(][^）)]*[）)]/g, "");
  if (!SUFFIX.test(name)) return [];
  name = name.replace(SUFFIX, "");
  let region = false;
  for (let match = REGION.exec(name); match && name.length - match[0].length >= 2; match = REGION.exec(name)) { name = name.slice(match[0].length); region = true; }
  if (region) for (let match = SUBREGION.exec(name); match; match = SUBREGION.exec(name)) name = name.slice(match[0].length);
  const shorts = [];
  if (name.length >= 3 && name !== fullName) shorts.push(name);
  let brand = name;
  while (TRADE.test(brand) && brand.replace(TRADE, "").length >= 2) brand = brand.replace(TRADE, "");
  // A brand that is itself a trade word (发展 in 广州发展贸易有限公司) would be replaced in ordinary sentences.
  if (brand !== name && brand.length >= 2 && !new RegExp(`^${TRADE.source}`).test(brand)) shorts.push(brand);
  else if (!shorts.length && name.length === 2) shorts.push(name);
  return shorts.filter(item => /^[一-龥A-Za-z0-9]+$/.test(item) && !GENERIC.test(item));
}

// fullNames: company names already chosen (column values or confirmed names). cells: [{ sheet, row, column, text }].
// known: values that already have a place in the list. Returns keyword candidates in the usual shape.
export function shortNameCandidates(fullNames, cells, known = new Set()) {
  const owners = new Map();
  const full = new Set();
  let taken = 0;
  for (const name of fullNames) {
    if (taken >= MAX_NAMES) break;
    const text = String(name ?? "").trim();
    const shorts = companyShortNames(text);
    if (!shorts.length) continue;
    taken += 1;
    full.add(text);
    for (const short of shorts) {
      if (!owners.has(short)) owners.set(short, []);
      owners.get(short).push(text);
    }
  }
  for (const short of [...owners.keys()]) if (known.has(short) || full.has(short)) owners.delete(short);
  if (!owners.size) return [];
  const longer = new Map([...owners.keys()].map(short => [short, [...owners.keys()].filter(other => other.length > short.length && other.includes(short))]));
  const found = new Map();
  for (const cell of cells ?? []) {
    for (const [short, names] of owners) {
      if (!cell.text.includes(short)) continue;
      // Inside its own full name, or inside a longer short form (宏图 in 宏图化工), it is already covered.
      let rest = cell.text;
      for (const name of [...names, ...longer.get(short)]) rest = rest.split(name).join("\n");
      const count = rest.split(short).length - 1;
      if (!count) continue;
      const item = found.get(short) ?? { count: 0, contexts: [], locations: [] };
      item.count += count;
      if (item.contexts.length < 3) item.contexts.push(cell.text.trim().slice(0, 180));
      if (item.locations.length < 3 && cell.row) item.locations.push({ sheet: cell.sheet, row: cell.row, column: cell.column });
      found.set(short, item);
    }
  }
  return [...found].map(([value, item]) => ({
    id: `TEXT::${encodeURIComponent(value)}`,
    value,
    label: "客户简称",
    category: "customer",
    prefix: "C",
    count: item.count,
    contexts: item.contexts,
    locations: item.locations,
    shortOf: owners.get(value)[0],
    suggested: true,
    manual: false,
  }));
}
