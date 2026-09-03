const TOKEN_PATTERN_SOURCE = String.raw`\[\[(?:[^\[\]\r\n@:\|\x60]{1,16}:)?([CPSX]\d{3,6})@([A-F0-9]{8})\]\]`;
const UNSAFE_LABEL_CHARACTERS = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\[\]@:\|`]/g;
const FALLBACK_LABELS = {
  customer: "客户",
  product: "产品",
  sales: "销售人员",
  custom: "敏感信息",
};

export function tokenPattern(flags = "g") {
  return new RegExp(TOKEN_PATTERN_SOURCE, flags);
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
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999999) throw new TypeError("Invalid token sequence");
  if (!/^[A-F0-9]{8}$/.test(taskId)) throw new TypeError("Invalid task id");
  const semanticLabel = sanitizeSemanticLabel(label, category);
  return `[[${semanticLabel}:${prefix}${String(sequence).padStart(3, "0")}@${taskId}]]`;
}

export function parseEntityToken(token) {
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
