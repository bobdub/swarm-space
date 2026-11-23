import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { getProtected, putProtected, verifyProtected } from "../storage/protectedStorage";
import { signContent, verifyContentSignature } from "../encryption/contentSigning";
import { canonicalJsonBytes } from "../utils/canonicalJson";
import { get, put } from "../store";

const b64 = (u: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(u)));
const enc = new TextEncoder();

async function ecPrivateKey(): Promise<string> {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
}

/** The pre-fix v1 writer: fixed PBKDF2 salts. */
async function putLegacy(store: string, id: string, data: unknown, priv: string) {
  const material = await crypto.subtle.importKey("raw", Uint8Array.from(atob(priv), (c) => c.charCodeAt(0)), "PBKDF2", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode("swarm-storage-v1"), iterations: 100000, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const mac = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode("swarm-hmac-v1"), iterations: 100000, hash: "SHA-256" },
    material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(JSON.stringify(data)));
  await put(store, {
    id, encryptedData: JSON.stringify({ cipher: b64(cipher), iv: b64(iv) }),
    hmac: b64(await crypto.subtle.sign("HMAC", mac, cipher)), version: 1, timestamp: 0,
  });
}

describe("protectedStorage per-record salts", () => {
  it("writes a random salt per record and round-trips", async () => {
    const priv = await ecPrivateKey();
    await putProtected("projects", "p1", { a: 1 }, priv);
    await putProtected("projects", "p2", { a: 1 }, priv);
    const r1 = await get<{ encryptedData: string; version: number }>("projects", "p1");
    const r2 = await get<{ encryptedData: string }>("projects", "p2");
    expect(r1?.version).toBe(2);
    const s1 = JSON.parse(r1!.encryptedData).salt;
    expect(s1).toBeTruthy();
    expect(s1).not.toBe(JSON.parse(r2!.encryptedData).salt);
    expect(await getProtected("projects", "p1", priv)).toEqual({ a: 1 });
    expect(await verifyProtected("projects", "p1", priv)).toBe(true);
  });

  it("reads legacy fixed-salt records and migrates them to v2", async () => {
    const priv = await ecPrivateKey();
    await putLegacy("projects", "legacy1", { hello: "world" }, priv);
    expect(await verifyProtected("projects", "legacy1", priv)).toBe(true);
    expect(await getProtected("projects", "legacy1", priv)).toEqual({ hello: "world" });
    const after = await get<{ version: number }>("projects", "legacy1");
    expect(after?.version).toBe(2);
    expect(await getProtected("projects", "legacy1", priv)).toEqual({ hello: "world" });
  });

  it("rejects a record whose salt was swapped", async () => {
    const priv = await ecPrivateKey();
    await putProtected("projects", "t1", { x: 1 }, priv);
    const rec = await get<{ id: string; encryptedData: string }>("projects", "t1");
    const data = JSON.parse(rec!.encryptedData);
    data.salt = b64(new Uint8Array(16));
    await put("projects", { ...rec, encryptedData: JSON.stringify(data) });
    expect(await getProtected("projects", "t1", priv)).toBeNull();
  });
});

async function ed25519Signer() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  return {
    publicKey: b64(await crypto.subtle.exportKey("spki", kp.publicKey)),
    sign: (data: Uint8Array) => crypto.subtle.sign("Ed25519", kp.privateKey, data),
    privateKey: kp.privateKey,
  };
}

describe("contentSigning canonical payloads", () => {
  it("verifies regardless of the content's key order", async () => {
    const signer = await ed25519Signer();
    const signed = await signContent({ b: 2, a: { d: 4, c: 3 } }, async () => signer);
    expect(await verifyContentSignature(signed)).toBe(true);
    const reordered = { ...signed, content: { a: { c: 3, d: 4 }, b: 2 } };
    expect(await verifyContentSignature(reordered)).toBe(true);
    expect(await verifyContentSignature({ ...signed, content: { a: { c: 3, d: 5 }, b: 2 } })).toBe(false);
  });

  it("still verifies signatures made with the old JSON.stringify payload", async () => {
    const signer = await ed25519Signer();
    const content = { z: 1, y: 2 };
    const contentString = JSON.stringify(content);
    const hashBuf = await crypto.subtle.digest("SHA-256", enc.encode(contentString));
    const contentHash = Array.from(new Uint8Array(hashBuf)).map((x) => x.toString(16).padStart(2, "0")).join("");
    const timestamp = 1_700_000_000_000;
    const sig = await signer.sign(enc.encode(JSON.stringify({ content: contentString, contentHash, timestamp })));
    const legacy = { content, signature: { signature: b64(sig), publicKey: signer.publicKey, contentHash, timestamp, algorithm: "ed25519" as const } };
    expect(await verifyContentSignature(legacy)).toBe(true);
    expect(canonicalJsonBytes({ b: 1, a: 2 })).toEqual(canonicalJsonBytes({ a: 2, b: 1 }));
  });
});
