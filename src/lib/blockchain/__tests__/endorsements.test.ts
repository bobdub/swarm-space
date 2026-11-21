import { describe, expect, it } from "vitest";
import { genIdentityKeyPair, computeUserId } from "@/lib/crypto";
import { CertificateBook, claimHeight, endorsementSignerFromKeys, signEndorsement, verifyEndorsement, type Endorsement } from "../endorsements";

function memoryStore(fail = false) {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { if (fail) throw new Error("full"); data.set(k, v); },
  };
}

async function newSigner() {
  const keys = await genIdentityKeyPair();
  return endorsementSignerFromKeys(await computeUserId(keys.publicKey), keys.publicKey, keys.privateKey);
}

const block = { hash: "00ab", index: 7, epoch: 2, tick: 59_000_000 };

describe("signed endorsements", () => {
  it("verifies a signed endorsement and rejects any tampering", async () => {
    const signer = await newSigner();
    const e = await signEndorsement(block, true, signer, 1_000);
    expect(e).toMatchObject({ blockHash: "00ab", height: 7, epoch: 2, round: 59_000_000, agree: true, voter: signer.userId });
    expect(await verifyEndorsement(e)).toBe(true);
    expect(await verifyEndorsement({ ...e, agree: false })).toBe(false);
    expect(await verifyEndorsement({ ...e, blockHash: "00ac" })).toBe(false);
    expect(await verifyEndorsement({ ...e, height: 8 })).toBe(false);
    const other = await newSigner();
    expect(await verifyEndorsement({ ...e, voter: other.userId })).toBe(false);
    expect(await verifyEndorsement({ ...e, publicKey: other.publicKey })).toBe(false);
  });

  it("agrees to one block per height, and remembers it across a restart", () => {
    const store = memoryStore();
    expect(claimHeight(7, "a", store)).toBe(true);
    expect(claimHeight(7, "a", store)).toBe(true);
    expect(claimHeight(7, "b", store)).toBe(false);
    expect(claimHeight(8, "b", store)).toBe(true);
    expect(claimHeight(7, "b", store)).toBe(false);
  });

  it("won't agree when the claim can't be saved", () => {
    expect(claimHeight(7, "a", memoryStore(true))).toBe(false);
    expect(claimHeight(7, "a", null)).toBe(false);
  });
});

describe("certificates", () => {
  const e = (voter: string, agree = true) => ({ blockHash: "h", voter, agree } as Endorsement);

  it("counts each voter once, never the producer, and reports who is missing", () => {
    const book = new CertificateBook(memoryStore());
    expect(book.add(e("a"))).toBe(true);
    expect(book.add(e("a"))).toBe(false);
    expect(book.add(e("a", false))).toBe(false);
    expect(book.add(e("miner"), "miner")).toBe(false);
    expect(book.add(e("b", false))).toBe(true);
    expect(book.summary("h", ["a", "b", "c"])).toEqual({ signed: ["a"], declined: ["b"], missing: ["c"] });
  });

  it("keeps certificates across a restart", () => {
    const store = memoryStore();
    new CertificateBook(store).add(e("a"));
    expect(new CertificateBook(store).get("h")?.signed.map((x) => x.voter)).toEqual(["a"]);
  });
});
