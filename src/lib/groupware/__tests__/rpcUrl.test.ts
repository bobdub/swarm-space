import { describe, expect, it } from "vitest";
import { sanitizeRpcUrl } from "../groupwareNode";

describe("GroupWare advertised RPC URL", () => {
  it("accepts a public https endpoint", () => {
    expect(sanitizeRpcUrl("https://node.example.com/rpc")).toBe("https://node.example.com/rpc");
  });
  it("rejects plain http", () => {
    expect(sanitizeRpcUrl("http://node.example.com/rpc")).toBeUndefined();
  });
  it("rejects embedded credentials or tokens", () => {
    expect(sanitizeRpcUrl("https://user:pw@node.example.com/rpc")).toBeUndefined();
    expect(sanitizeRpcUrl("https://node.example.com/rpc?token=abc")).toBeUndefined();
  });
});
