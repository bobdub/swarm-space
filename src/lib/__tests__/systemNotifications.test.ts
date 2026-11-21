import { describe, it, expect, vi, beforeEach } from "vitest";

const stored: unknown[] = [];
vi.mock("@/lib/store", () => ({ put: vi.fn(async (_s: string, v: unknown) => { stored.push(v); }), get: vi.fn(), getAll: vi.fn(async () => stored) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => ({ id: "me" }) }));

import { notifySystem, notifyModeration } from "../notifications";

describe("system notifications", () => {
  beforeEach(() => { stored.length = 0; });

  it("stores a background notice for the current user with its link", async () => {
    await notifySystem({ type: "credits_received", title: "+5 credits", content: "from Ada · Tip", link: "/wallet", linkLabel: "Open wallet" });
    expect(stored).toEqual([expect.objectContaining({
      userId: "me", type: "credits_received", title: "+5 credits", content: "from Ada · Tip", link: "/wallet", linkLabel: "Open wallet", read: false,
    })]);
  });

  it("points a block at the list where it can be undone", async () => {
    notifyModeration("You blocked Bo.", "Their future posts are hidden from your feed.", "blockedUsers");
    await vi.waitFor(() => expect(stored).toHaveLength(1));
    expect(stored[0]).toEqual(expect.objectContaining({ type: "moderation", link: "/settings#blocked-users", linkLabel: "Manage blocked users" }));
  });
});
