import { describe, expect, it } from "bun:test";

import { computeEntropyScoreHash, isEntropyScoreHashValid } from "./proof";
import type { VerificationProofPayload } from "@/types/verification";

describe("computeEntropyScoreHash", () => {
  it("produces a deterministic base64 digest", async () => {
    const params = {
      entropyScore: 12.3456,
      issuedAt: "2024-01-01T00:00:00.000Z",
      userId: "user-123",
    };

    const first = await computeEntropyScoreHash(params);
    const second = await computeEntropyScoreHash(params);
    const altered = await computeEntropyScoreHash({
      ...params,
      entropyScore: params.entropyScore + 0.0001,
    });

    expect(first).toBe(second);
    expect(altered).not.toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("isEntropyScoreHashValid", () => {
  const basePayload = async (): Promise<VerificationProofPayload> => {
    const issuedAt = "2024-01-01T00:00:00.000Z";
    const userId = "user-123";
    const entropyScore = 42.9876;

    return {
      human_verified: true,
      userId,
      medal: "Dream_Matcher",
      medalCardImage: null,
      entropyScore,
      entropyScoreHash: await computeEntropyScoreHash({ entropyScore, issuedAt, userId }),
      totalTimeMs: 12345,
      moveCount: 18,
      accuracy: 0.98,
      creditsAwarded: 50,
      issuedAt,
      sessionId: "session-abc",
      manifestId: "manifest-abc",
    };
  };

  it("returns true when the payload hash matches the computed value", async () => {
    const payload = await basePayload();
    expect(await isEntropyScoreHashValid(payload)).toBe(true);
  });

  it("returns false when the hash does not match the payload", async () => {
    const payload = await basePayload();
    payload.entropyScoreHash = payload.entropyScoreHash.replace(/.$/, (char) =>
      char === "A" ? "B" : "A",
    );

    expect(await isEntropyScoreHashValid(payload)).toBe(false);
  });

  it("returns false when the hash is missing", async () => {
    const payload = await basePayload();
    payload.entropyScoreHash = "";

    expect(await isEntropyScoreHashValid(payload)).toBe(false);
  });
});
