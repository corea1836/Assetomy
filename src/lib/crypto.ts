import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = 0x01;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const TAG_OFFSET = 1 + IV_LENGTH;
const HEADER_LENGTH = TAG_OFFSET + TAG_LENGTH;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function encryptStatement(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: string,
): Uint8Array {
  if (key.byteLength !== KEY_LENGTH) {
    throw new Error("invalid_key");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptStatement(
  payload: Uint8Array,
  key: Uint8Array,
  aad: string,
): Uint8Array {
  try {
    if (
      payload.byteLength < HEADER_LENGTH || payload[0] !== VERSION ||
      key.byteLength !== KEY_LENGTH
    ) {
      throw new Error("decrypt_failed");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm", key, payload.subarray(1, TAG_OFFSET), { authTagLength: TAG_LENGTH },
    );
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(payload.subarray(TAG_OFFSET, HEADER_LENGTH));

    return Buffer.concat([
      decipher.update(payload.subarray(HEADER_LENGTH)), decipher.final(),
    ]);
  } catch {
    throw new Error("decrypt_failed");
  }
}
