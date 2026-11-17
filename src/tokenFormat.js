const TOKEN_PATTERN_SOURCE = String.raw`\[\[(?:[^\[\]\r\n@:\|\x60]{1,16}:)?([CPSX]\d{3,6})@([A-F0-9]{8})\]\]`;
export const SHORT_MARKER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SHORT_PATTERN_SOURCE = String.raw`(客户|产品|人员|信息)-([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4})-([0-9]{2,})(?![A-Za-z0-9-])`;
const SHORT_LABELS = { C: "客户", P: "产品", S: "人员", X: "信息" };
const UNSAFE_LABEL_CHARACTERS = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\[\]@:\|`]/g;
const FALLBACK_LABELS = {
  customer: "客户",
  product: "产品",
  sales: "销售人员",
  custom: "敏感信息",
};

export function tokenPattern(flags = "g") {
  return new RegExp(`(?:${TOKEN_PATTERN_SOURCE})|(?:${SHORT_PATTERN_SOURCE})`, flags);
}

// An alias ends in digits, so a letter, digit or hyphen right after it would be read as part of it and the
// alias could not be restored ("宏图2026年" → "客户-K7M4-012026年"). When what follows an alias is such a
// character (with or without spaces before it) one space is put after the alias, and restoring takes one
// space away again, so the text comes back exactly: "宏图2026" ⇄ "客户-K7M4-01 2026", "宏图 2026" ⇄ "客户-K7M4-01  2026".
export function aliasWithGap(token, rest) {
  return /^ *[A-Za-z0-9-]/.test(rest ?? "") ? `${token} ` : token;
}

// Replaces every alias in the text with what restore(token) returns, removing the space aliasWithGap added.
// An alias restore() leaves unchanged stays exactly as it is.
export function replaceAliases(text, restore) {
  return String(text).replace(new RegExp(`(?:${tokenPattern().source})(?: (?= *[A-Za-z0-9-]))?`, "g"), (match) => {
    const token = match.endsWith(" ") ? match.slice(0, -1) : match;
    const restored = restore(token);
    return restored === token ? match : restored;
  });
}

export function sanitizeSemanticLabel(label, category = "custom") {
  const fallback = FALLBACK_LABELS[category] || FALLBACK_LABELS.custom;
  const normalized = String(label ?? "")
    .normalize("NFKC")
    .replace(UNSAFE_LABEL_CHARACTERS, "")
    .replace(/\s+/g, "")
    .slice(0, 16);
  return !normalized || normalized === "手动添加" ? fallback : normalized;
}

export function createEntityToken({ label, category = "custom", prefix, sequence, taskId }) {
  if (!/^[CPSX]$/.test(prefix)) throw new TypeError("Invalid token prefix");
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("Invalid token sequence");
  if (taskId && typeof taskId === "object" && taskId.tokenFormat === "short") {
    if (!new RegExp(`^[${SHORT_MARKER_ALPHABET}]{4}$`).test(taskId.marker)) throw new TypeError("Invalid task marker");
    return `${SHORT_LABELS[prefix]}-${taskId.marker}-${String(sequence).padStart(2, "0")}`;
  }
  if (sequence > 999999) throw new TypeError("Invalid token sequence");
  if (!/^[A-F0-9]{8}$/.test(taskId)) throw new TypeError("Invalid task id");
  const semanticLabel = sanitizeSemanticLabel(label, category);
  return `[[${semanticLabel}:${prefix}${String(sequence).padStart(3, "0")}@${taskId}]]`;
}

export function parseEntityToken(token) {
  const short = String(token).match(new RegExp(`^${SHORT_PATTERN_SOURCE}$`));
  if (short) return { token: String(token), semanticLabel: short[1], shortToken: String(token), taskId: null, marker: short[2], formatVersion: 3 };
  const match = String(token).match(new RegExp(`^${TOKEN_PATTERN_SOURCE}$`));
  if (!match) return null;
  const prefixEnd = String(token).lastIndexOf(`:${match[1]}@`);
  const semanticLabel = prefixEnd < 0 ? null : String(token).slice(2, prefixEnd);
  return {
    token: String(token),
    semanticLabel,
    shortToken: match[1],
    taskId: match[2],
    formatVersion: semanticLabel ? 2 : 1,
  };
}

// Scanners group references, never treat a four-character marker as a vault ID.
export function tokenOccurrence(token) {
  const parsed = parseEntityToken(token);
  return { token: parsed.token, shortToken: parsed.shortToken, taskId: parsed.formatVersion === 3 ? `short:${parsed.marker}` : parsed.taskId };
}
