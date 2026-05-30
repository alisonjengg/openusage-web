import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Derive a stable 32-byte key from whatever the user put in APP_SECRET
// (hex, base64, or a plain passphrase — all accepted).
export function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export type Sealed = { iv: Buffer; blob: Buffer };

// AES-256-GCM. The returned blob is ciphertext || authTag(16 bytes).
export function seal(plaintext: string, key: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, blob: Buffer.concat([ct, tag]) };
}

export function open(sealed: Sealed, key: Buffer): string {
  const tag = sealed.blob.subarray(sealed.blob.length - 16);
  const ct = sealed.blob.subarray(0, sealed.blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function sealJSON(value: unknown, key: Buffer): Sealed {
  return seal(JSON.stringify(value), key);
}

export function openJSON<T>(sealed: Sealed, key: Buffer): T {
  return JSON.parse(open(sealed, key)) as T;
}
