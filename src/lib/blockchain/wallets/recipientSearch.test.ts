import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ candidates: [] as Array<Record<string, unknown>>, resolve: vi.fn() }));
vi.mock("@/lib/mentions", () => ({
  resolveMentionCandidates: async (q: string) =>
    state.candidates.filter(c => String(c.username).toLowerCase().startsWith(q.toLowerCase()) || String(c.displayName).toLowerCase().startsWith(q.toLowerCase())),
}));
vi.mock("./nativeAddress", () => ({ resolveNativeWalletRecipient: (id: string) => state.resolve(id) }));
const { searchWalletRecipients, resolveWalletRecipientInput, looksLikeWalletAddress, normalizeRecipientQuery } = await import("./recipientSearch");

const member = (userId: string, username: string, displayName = username, isEntity = false) => ({ userId, username, displayName, isEntity, trustScore: 50 });
beforeEach(() => {
  state.candidates = [member("u-sam", "sam", "Sam"), member("u-samantha", "samantha", "Samantha"), member("me", "samuel"), member("entity", "Infinity", "Infinity", true)];
  state.resolve.mockReset();
  state.resolve.mockImplementation(async (id: string) => {
    if (id === "infinity:donations") return { id, username: "Infinity" };
    if (["u-sam", "u-samantha", "u-imposter", "raw-id", "0x68588ba69f51bf95f0e040b0d8f646e9fe526218"].includes(id)) return { id: id.startsWith("0x") ? "alias-owner" : id, username: id };
    throw new Error("SWARM wallet recipient not found. Sync with this user first.");
  });
});

test("query normalization and address detection", () => {
  expect(normalizeRecipientQuery("  @@sam ")).toBe("sam");
  expect(looksLikeWalletAddress("0x68588ba69f51bf95f0e040b0d8f646e9fe526218")).toBe(true);
  expect(looksLikeWalletAddress("swarm:abc")).toBe(true);
  expect(looksLikeWalletAddress("@sam")).toBe(false);
});

test("search finds members by @username, skipping the sender, exact handle first", async () => {
  state.candidates.reverse();
  expect((await searchWalletRecipients("@sam", "me")).map(c => c.userId)).toEqual(["u-sam", "u-samantha"]);
  expect(await searchWalletRecipients("0x68588ba69f51bf95f0e040b0d8f646e9fe526218", "me")).toEqual([]);
});

test("an exact @username resolves to its wallet id even when other handles share the prefix", async () => {
  expect((await resolveWalletRecipientInput("@sam", "me")).id).toBe("u-sam");
  expect(state.resolve).toHaveBeenCalledWith("u-sam");
});

test("a unique prefix resolves; an ambiguous one asks the sender to pick", async () => {
  expect((await resolveWalletRecipientInput("samant", "me")).id).toBe("u-samantha");
  await expect(resolveWalletRecipientInput("sa", "me")).rejects.toThrow("Pick one from the list");
});

test("raw wallet ids and 0x aliases still resolve as a fallback", async () => {
  expect((await resolveWalletRecipientInput("raw-id", "me")).id).toBe("raw-id");
  expect((await resolveWalletRecipientInput("0x68588ba69f51bf95f0e040b0d8f646e9fe526218", "me")).id).toBe("alias-owner");
  await expect(resolveWalletRecipientInput("swarm:nobody", "me")).rejects.toThrow("recipient not found");
  await expect(resolveWalletRecipientInput("@ghost", "me")).rejects.toThrow("No synced member found for @ghost");
  await expect(resolveWalletRecipientInput("  ", "me")).rejects.toThrow("Enter a username");
});

test("a pasted raw wallet id beats a member whose handle shares those characters", async () => {
  state.candidates.push(member("u-imposter", "raw-id"));
  expect((await resolveWalletRecipientInput("raw-id", "me")).id).toBe("raw-id");
  expect((await resolveWalletRecipientInput("@raw-id", "me")).id).toBe("u-imposter");
});

test("Infinity shows up once and resolves to its donations vault by any of its names", async () => {
  state.candidates.push(member("entity", "Imagination", "Imagination", true));
  expect(await searchWalletRecipients("@inf", "me")).toEqual([{ userId: "infinity:donations", username: "Infinity", displayName: "Infinity" }]);
  for (const input of ["@infinity", "Infinity", "imagination", "network-entity", "0x5c5a27b9f1c8aeabf65254971b910385d105d9ab"]) {
    expect((await resolveWalletRecipientInput(input, "me")).id).toBe("infinity:donations");
  }
});
