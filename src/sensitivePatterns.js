// Phone numbers, ID numbers, bank cards and e-mail addresses are never wanted by an AI, so they are suggested
// for replacement wherever they appear in a file. ID and card numbers must pass their own check digit, so
// ordinary figures (amounts, order numbers, quantities) are not mistaken for them.

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = "10X98765432";

export function isValidIdNumber(value) {
  if (!/^[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(value)) return false;
  const sum = ID_WEIGHTS.reduce((total, weight, index) => total + weight * Number(value[index]), 0);
  return ID_CHECK[sum % 11] === value[17].toUpperCase();
}

// Luhn check used by bank cards.
export function isValidBankCard(value) {
  if (!/^[3-6]\d{15,18}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    let digit = Number(value[value.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// Unified social credit code (GB 32100): 18 characters with its own check character.
const CREDIT_CHARS = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const CREDIT_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
export function isValidCreditCode(value) {
  const code = String(value).toUpperCase();
  if (!/^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/.test(code)) return false;
  const sum = CREDIT_WEIGHTS.reduce((total, weight, index) => total + weight * CREDIT_CHARS.indexOf(code[index]), 0);
  return CREDIT_CHARS[(31 - (sum % 31)) % 31] === code[17];
}

const digitsOnly = value => value.replace(/\D/g, "");

// Earlier rules win when two of them match the same text.
const RULES = [
  { label: "身份证号", pattern: /(?<!\d)[1-9]\d{16}[\dXx](?!\d)/g, valid: isValidIdNumber },
  { label: "手机号", pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  // Written apart or with the country code: 138-1234-5678, 138 1234 5678, +86 13812345678.
  { label: "手机号", pattern: /(?<![\d\-])(?:\+?86[ \-]?)?1[3-9]\d(?:[ \-]?\d{4}){2}(?![\d\-])/g, valid: value => /[ \-+]/.test(value) || value.startsWith("86") },
  { label: "固定电话", pattern: /(?<!\d)0\d{2,3}[-\s]\d{7,8}(?!\d)/g },
  { label: "统一社会信用代码", pattern: /(?<![0-9A-Za-z])[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}(?![0-9A-Za-z])/g, valid: isValidCreditCode },
  { label: "银行卡号", pattern: /(?<!\d)[3-6]\d{15,18}(?!\d)/g, valid: isValidBankCard },
  // Card numbers written in groups: 6222 0212 3456 7890 123.
  { label: "银行卡号", pattern: /(?<![\d\-])[3-6]\d{3}(?:[ \-]\d{4}){3}(?:[ \-]\d{1,3})?(?![\d\-])/g, valid: value => isValidBankCard(digitsOnly(value)) },
  // Company accounts have no check digit, so they are only taken when the text says it is an account.
  { label: "银行账号", pattern: /(?<=(?:账号|帐号|账户|卡号)(?:为|是)?[：:\s]{0,3})\d(?:[ \-]?\d){8,29}(?!\d)/g },
  { label: "邮箱", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
];

function lineAround(text, index, length) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index + length);
  return text.slice(start, end < 0 ? text.length : end).trim().slice(0, 180);
}

// Candidates in the same shape the text analysis uses, found in one pass over the text.
export function sensitiveNumberCandidates(text) {
  const source = String(text ?? "");
  const found = new Map();
  for (const { label, pattern, valid } of RULES) {
    for (const match of source.matchAll(pattern)) {
      const value = match[0].trim();
      if (valid && !valid(value)) continue;
      const known = found.get(value);
      if (known && known.label !== label) continue;
      if (known) {
        known.count += 1;
        if (known.contexts.length < 3) known.contexts.push(lineAround(source, match.index, value.length));
        continue;
      }
      found.set(value, {
        id: `TEXT::${encodeURIComponent(value)}`,
        value,
        label,
        category: "contact",
        prefix: "X",
        count: 1,
        contexts: [lineAround(source, match.index, value.length)],
        suggested: true,
        manual: false,
      });
    }
  }
  return [...found.values()];
}
