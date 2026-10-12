import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptStatement, encryptStatement, sha256Hex } from "./crypto";

const utf8 = (text: string) => new TextEncoder().encode(text);
const aad = "userA/upload1";

describe("sha256Hex", () => {
  it("returns the known lowercase SHA-256 digest of abc", () => {
    const digest = sha256Hex(utf8("abc"));

    expect(digest).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("statement encryption", () => {
  it.each([0, 1, 4 * 1024 * 1024])("round-trips %i plaintext bytes", (size) => {
    const plaintext = new Uint8Array(randomBytes(size));
    const key = new Uint8Array(randomBytes(32));
    const payload = encryptStatement(plaintext, key, aad);

    expect(payload).toBeInstanceOf(Uint8Array);
    expect(payload[0]).toBe(0x01);
    expect(payload.byteLength).toBe(plaintext.byteLength + 29);
    expect(Buffer.from(decryptStatement(payload, key, aad))).toEqual(
      Buffer.from(plaintext),
    );
  });

  it("uses a new IV and ciphertext for the same plaintext on each call", () => {
    const plaintext = utf8("statement plaintext");
    const key = randomBytes(32);
    const first = encryptStatement(plaintext, key, aad);
    const second = encryptStatement(plaintext, key, aad);

    expect(first.subarray(1, 13)).not.toEqual(second.subarray(1, 13));
    expect(first).not.toEqual(second);
  });

  it("does not embed the plaintext byte sequence in the payload", () => {
    const plaintext = Uint8Array.from({ length: 256 }, (_, index) => index);
    const payload = encryptStatement(plaintext, randomBytes(32), aad);

    expect(Buffer.from(payload).includes(Buffer.from(plaintext))).toBe(false);
  });

  it("round-trips a UTF-8 storage path as AAD", () => {
    const key = randomBytes(32);
    const plaintext = utf8("statement plaintext");
    const path = "사용자/업로드.enc";

    expect(Buffer.from(decryptStatement(
      encryptStatement(plaintext, key, path), key, path,
    ))).toEqual(Buffer.from(plaintext));
  });

  it("rejects a 31-byte encryption key without revealing its value", () => {
    const key = randomBytes(31);
    const encrypt = () => encryptStatement(utf8("statement plaintext"), key, aad);

    expect(encrypt).toThrowError();
    expect(encrypt).not.toThrowError(key.toString("base64"));
  });
});

describe("statement decryption failures", () => {
  it.each([
    "different user AAD",
    "different upload AAD",
    "different key",
    "31-byte key",
    "IV bit flip",
    "tag bit flip",
    "ciphertext bit flip",
    "different version",
    "28-byte payload",
    "empty payload",
  ])("returns only decrypt_failed for %s", (failure) => {
    let key: Uint8Array = randomBytes(32);
    let path = aad;
    let payload = encryptStatement(utf8("statement plaintext"), key, path);

    switch (failure) {
      case "different user AAD": path = "userB/upload1"; break;
      case "different upload AAD": path = "userA/upload2"; break;
      case "different key": key = randomBytes(32); break;
      case "31-byte key": key = randomBytes(31); break;
      case "IV bit flip": payload[1] ^= 0x01; break;
      case "tag bit flip": payload[13] ^= 0x01; break;
      case "ciphertext bit flip": payload[29] ^= 0x01; break;
      case "different version": payload[0] = 0x02; break;
      case "28-byte payload": payload = payload.subarray(0, 28); break;
      case "empty payload": payload = new Uint8Array(); break;
    }

    expect(() => decryptStatement(payload, key, path)).toThrowError(/^decrypt_failed$/);
  });
});
