/**
 * Encryption at rest for what Anchor must keep but nobody else should read:
 * a person's own Walrus Memory delegate key (state file) and their photo
 * proofs (public Walrus blobs). AES-256-GCM; the key is derived from Anchor's
 * own secret, per purpose and per person, so one person's key never opens
 * another's data.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { config } from "./config.js";

const master = () => createHash("sha256").update(`anchor-at-rest:${config.MEMWAL_PRIVATE_KEY}`).digest();
const keyFor = (purpose: string, userId: string) => createHmac("sha256", master()).update(`${purpose}:${userId}`).digest();

/** iv (12) | tag (16) | ciphertext */
export function seal(purpose: string, userId: string, plain: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(purpose, userId), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function open(purpose: string, userId: string, sealed: Uint8Array): Buffer {
  const b = Buffer.from(sealed);
  const d = createDecipheriv("aes-256-gcm", keyFor(purpose, userId), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

export const sealText = (purpose: string, userId: string, text: string) => seal(purpose, userId, Buffer.from(text, "utf8")).toString("base64");
export const openText = (purpose: string, userId: string, b64: string) => open(purpose, userId, Buffer.from(b64, "base64")).toString("utf8");
