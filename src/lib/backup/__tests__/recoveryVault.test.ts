import { describe, it, expect } from "vitest";
import { genIdentityKeyPair, computeUserId } from "@/lib/crypto";
import {
  sealRecoveryVault,
  openRecoveryVault,
  verifyRecoveryVault,
  supersedes,
  WrongRecoveryPassphraseError,
  recoveryUrl,
  parseRecoveryParams,
  recoverySearchFromLink,
  chooseRecoveryHolder,
  canonicalRecoverHref,
  VAULT_PBKDF2_ITERATIONS,
} from "../recoveryVault";

async function identity(username = "mike") {
  const keys = await genIdentityKeyPair();
  const id = await computeUserId(keys.publicKey);
  return {
    privateKey: keys.privateKey,
    user: { id, username, displayName: "Mike", publicKey: keys.publicKey, createdAt: "2026-01-01T00:00:00.000Z" },
  };
}

describe("recovery vault outer shell", () => {
  it("seals with AES-GCM + PBKDF2 250k and opens only with the shell passphrase", async () => {
    const me = await identity();
    const env = await sealRecoveryVault({ ...me, version: 1, passphrase: "correct horse battery" });
    expect(env.kdf.iterations).toBe(VAULT_PBKDF2_ITERATIONS);
    expect(env.ciphertext).not.toContain(me.privateKey.slice(0, 20));
    expect(await verifyRecoveryVault(env)).toBe(true);

    const opened = await openRecoveryVault(env, "  correct horse battery ");
    expect(opened.privateKey).toBe(me.privateKey);
    expect(opened.user.username).toBe("mike");

    await expect(openRecoveryVault(env, "wrong")).rejects.toBeInstanceOf(WrongRecoveryPassphraseError);
  });

  it("rotation: v2 supersedes v1 and the old phrase cannot open v2", async () => {
    const me = await identity();
    const v1 = await sealRecoveryVault({ ...me, version: 1, passphrase: "signup-password" });
    const v2 = await sealRecoveryVault({ ...me, version: 2, passphrase: "new recovery phrase" });
    expect(supersedes(v2, v1)).toBe(true);
    expect(supersedes(v1, v2)).toBe(false);
    expect(supersedes(v1, v1)).toBe(false);
    await expect(openRecoveryVault(v2, "signup-password")).rejects.toBeInstanceOf(WrongRecoveryPassphraseError);
    expect((await openRecoveryVault(v2, "new recovery phrase")).version).toBe(2);
  });

  it("rejects envelopes forged by another key, tampered versions and future dates", async () => {
    const me = await identity();
    const mallory = await identity("mallory");
    const env = await sealRecoveryVault({ ...me, version: 1, passphrase: "pw" });

    expect(await verifyRecoveryVault({ ...env, version: 9 })).toBe(false);
    expect(await verifyRecoveryVault({ ...env, ciphertext: env.ciphertext.slice(0, -4) + "AAAA" })).toBe(false);

    const forged = await sealRecoveryVault({ ...mallory, version: 50, passphrase: "pw" });
    expect(await verifyRecoveryVault({ ...forged, userId: me.user.id })).toBe(false);

    const future = await sealRecoveryVault({ ...me, version: 3, passphrase: "pw", now: new Date(Date.now() + 86_400_000) });
    expect(await verifyRecoveryVault(future)).toBe(false);
  });

  it("refuses to seal a profile that does not match its public key", async () => {
    const me = await identity();
    await expect(sealRecoveryVault({ ...me, user: { ...me.user, id: "0000000000000000" }, version: 1, passphrase: "pw" })).rejects.toThrow();
  });
});

describe("recovery links", () => {
  it("round-trips id, version and host peer", () => {
    const url = recoveryUrl("https://swarm.example", { id: "0123456789abcdef", v: 3, peer: "peer-abc_1" });
    expect(url).toBe("https://swarm.example/recover?id=0123456789abcdef&v=3&peer=peer-abc_1");
    expect(parseRecoveryParams(new URL(url).search)).toEqual({ id: "0123456789abcdef", v: 3, peer: "peer-abc_1" });
  });

  it("drops malformed ids and peers", () => {
    expect(parseRecoveryParams("?id=nothex&v=1")).toBeNull();
    expect(parseRecoveryParams("?id=0123456789abcdef&v=x&peer=evil")).toEqual({ id: "0123456789abcdef", v: 1, peer: null });
  });

  it("rewrites hash-routed recover links to the path route", () => {
    expect(canonicalRecoverHref("/", "#/recover?id=0123456789abcdef&v=2", "")).toBe("/recover?id=0123456789abcdef&v=2");
    expect(canonicalRecoverHref("/recover", "", "?id=0123456789abcdef")).toBeNull();
    expect(canonicalRecoverHref("/", "#/connect#peer-x", "")).toBeNull();
  });
});

describe("scanned and pasted recovery links", () => {
  const origin = "https://swarm.example";
  it("reads the link from a full URL, a hash-routed wrapper or a bare query", () => {
    const want = "?id=0123456789abcdef&v=3&peer=peer-abc_1";
    expect(recoverySearchFromLink("https://other.example/recover?id=0123456789abcdef&v=3&peer=peer-abc_1", origin)).toBe(want);
    expect(recoverySearchFromLink(" https://swarm.example/#/recover?id=0123456789abcdef&v=3&peer=peer-abc_1 ", origin)).toBe(want);
    expect(recoverySearchFromLink("?id=0123456789abcdef&v=3&peer=peer-abc_1", origin)).toBe(want);
  });

  it("refuses anything that is not a Recovery Link", () => {
    expect(recoverySearchFromLink("https://swarm.example/connect#peer-x", origin)).toBeNull();
    expect(recoverySearchFromLink("https://swarm.example/profile?id=0123456789abcdef", origin)).toBeNull();
    expect(recoverySearchFromLink("hello", origin)).toBeNull();
    expect(recoverySearchFromLink("", origin)).toBeNull();
  });
});

describe("recovery link holder", () => {
  it("names the chosen custodian, else a connected one, else any custodian, else this node", () => {
    const custodians = ["peer-a", "peer-b", "peer-c"];
    expect(chooseRecoveryHolder({ custodians, connected: ["peer-c"], selected: "peer-b", self: "peer-me" })).toBe("peer-b");
    expect(chooseRecoveryHolder({ custodians, connected: new Set(["peer-c"]), selected: "peer-gone", self: "peer-me" })).toBe("peer-c");
    expect(chooseRecoveryHolder({ custodians, connected: [], self: "peer-me" })).toBe("peer-a");
    expect(chooseRecoveryHolder({ custodians: [], connected: [], self: "peer-me" })).toBe("peer-me");
    expect(chooseRecoveryHolder({ custodians: [], connected: [] })).toBeNull();
  });
});
