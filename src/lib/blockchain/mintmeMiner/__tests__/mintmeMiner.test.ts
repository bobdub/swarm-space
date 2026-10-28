import { describe, it, expect, vi } from "vitest";
import { difficultyToTarget, targetToDifficulty, StratumClient } from "../stratum";
import { splitShareWeight, ShareTracker, MINTME_SHARE_CHANNEL } from "../shareTracker";

describe("mintme stratum", () => {
  it("round-trips difficulty 12,500 through the compact target", () => {
    expect(targetToDifficulty(difficultyToTarget(12_500))).toBe(12_500);
  });
  it("parses login job and share results", () => {
    const events: any[] = [];
    const c = new StratumClient({ proxyUrl: "wss://x", pool: "p", address: "a", onEvent: (e) => events.push(e) });
    (c as any).pending.set(1, { kind: "login" });
    (c as any).pending.set(2, { kind: "submit", jobId: "j1" });
    c.handle(JSON.stringify({ id: 1, result: { id: "w", job: { job_id: "j1", blob: "00ff", target: difficultyToTarget(12_500) } } }) + "\n"
      + JSON.stringify({ id: 2, result: { status: "OK" } }));
    expect(events.map((e) => e.type)).toEqual(["logged-in", "job", "share-accepted"]);
    expect(events[1].job.difficulty).toBe(12_500);
  });
});

describe("mintme share split", () => {
  it("splits 80/15/5 across connected peers", () => {
    const s = splitShareWeight(1000, 3);
    expect(s.miner).toBe(800); expect(s.peersTotal).toBe(150); expect(s.perPeer).toBe(50); expect(s.vault).toBeCloseTo(50);
  });
  it("sends the peer share to the vault when alone", () => {
    const s = splitShareWeight(1000, 0);
    expect(s.peersTotal).toBe(0); expect(s.vault).toBeCloseTo(200);
  });
  it("broadcasts local receipts once and rejects spoofed peer receipts", () => {
    let handler: any; const broadcast = vi.fn();
    const t = new ShareTracker({ broadcast, onMessage: (_c, h) => { handler = h; return () => {}; } }, () => {});
    const r = { minerPeerId: "me", jobId: "j", difficulty: 12500, acceptedAt: 1 };
    t.recordLocal(r); t.recordLocal(r);
    expect(broadcast).toHaveBeenCalledTimes(1); expect(broadcast).toHaveBeenCalledWith(MINTME_SHARE_CHANNEL, r);
    handler("peerB", { ...r, minerPeerId: "peerC" });
    expect(t.fromPeers).toHaveLength(0);
    handler("peerB", { ...r, minerPeerId: "peerB" });
    expect(t.fromPeers).toHaveLength(1);
  });
});
