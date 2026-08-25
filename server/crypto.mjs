import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptBytes(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptBytes(record, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, record.iv);
  decipher.setAuthTag(record.tag);
  return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]);
}

export function encryptMapping(mapping, masterKey, keyVersion = "v1") {
  if (masterKey.length !== 32) throw new Error("Vault master key must be 32 bytes");
  const dataKey = randomBytes(32);
  const data = encryptBytes(Buffer.from(JSON.stringify(mapping), "utf8"), dataKey);
  const wrappedKey = encryptBytes(dataKey, masterKey);
  return { ...data, wrappedKey, keyVersion };
}

export function decryptMapping(record, masterKey) {
  const dataKey = decryptBytes(record.wrappedKey, masterKey);
  return JSON.parse(decryptBytes(record, dataKey).toString("utf8"));
}
