import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getMintMeMinerEnabled, setMintMeMinerEnabled, onMintMeMinerEnabledChange,
  mintMeBridgeUrlForServer, getMintMeBridgeUrl, setMintMeMinerServerId,
} from "../mintmeMinerPreference";
import { upsertPersonalServer, type PersonalServer } from "@/lib/storage/providers/personalServerStore";

const server = (id: string, url: string): PersonalServer => ({
  id, name: id, kind: "https-blob", url, scope: "private", capBytes: 1, usedBytes: 0, paused: false, createdAt: 0,
});

describe("MintMe miner switch", () => {
  beforeEach(() => localStorage.clear());

  it("is off by default", () => {
    expect(getMintMeMinerEnabled()).toBe(false);
  });

  it("ignores the old always-on setting", () => {
    localStorage.setItem("swarm-mintme-miner-enabled", "true");
    expect(getMintMeMinerEnabled()).toBe(false);
  });

  it("derives the wss bridge from the personal server address", () => {
    expect(mintMeBridgeUrlForServer({ url: "https://files.example.org/blob" })).toBe("wss://files.example.org/mintme-bridge");
    expect(mintMeBridgeUrlForServer({ url: "https://files.example.org:8443" })).toBe("wss://files.example.org:8443/mintme-bridge");
    expect(mintMeBridgeUrlForServer({ url: "http://localhost:8787" })).toBeNull();
    expect(mintMeBridgeUrlForServer({ url: "https://192.168.1.4" })).toBeNull();
  });

  it("has no bridge without a personal server, and follows the chosen server", () => {
    expect(getMintMeBridgeUrl()).toBeNull();
    upsertPersonalServer(server("a", "https://a.example.org"));
    upsertPersonalServer(server("b", "https://b.example.org"));
    expect(getMintMeBridgeUrl()).toBe("wss://a.example.org/mintme-bridge");
    setMintMeMinerServerId("b");
    expect(getMintMeBridgeUrl()).toBe("wss://b.example.org/mintme-bridge");
  });

  it("remembers being turned off and back on", () => {
    setMintMeMinerEnabled(false);
    expect(getMintMeMinerEnabled()).toBe(false);
    setMintMeMinerEnabled(true);
    expect(getMintMeMinerEnabled()).toBe(true);
  });

  it("notifies listeners", () => {
    const seen: boolean[] = [];
    const off = onMintMeMinerEnabledChange((v) => seen.push(v));
    setMintMeMinerEnabled(false);
    off();
    setMintMeMinerEnabled(true);
    expect(seen).toEqual([false]);
  });
  it("remains off if storage refuses to save the switch", () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    setMintMeMinerEnabled(false);
    expect(getMintMeMinerEnabled()).toBe(false);
    write.mockRestore();
    setMintMeMinerEnabled(true);
  });
});
