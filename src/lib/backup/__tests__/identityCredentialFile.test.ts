import { describe, it, expect } from "vitest";
import { buildIdentityCredentialMarkdown, credentialFileName } from "../identityCredentialFile";

describe("identity credential .md", () => {
  const base = {
    username: "Mike", userId: "0123456789abcdef", discriminator: "7f2c1a9b", shellVersion: 2, genesisDefault: false,
    publicKey: "PUBKEY", coldAddress: "0x" + "ab".repeat(20), recoveryUrl: "https://s.example/recover?id=0123456789abcdef&v=2",
    generatedAt: new Date("2026-11-18T00:00:00Z"),
  };

  it("writes YAML frontmatter with public identity and the shell warning", () => {
    const md = buildIdentityCredentialMarkdown(base);
    expect(md.startsWith("---\nusername: \"Mike\"")).toBe(true);
    expect(md).toContain('handle: "Mike#7f2c1a9b"');
    expect(md).toContain("shell_version: 2");
    expect(md).toContain("sealed by Outer Shell Version 2");
    expect(md).toContain("Your local account password will NOT open this vault.");
    expect(md).not.toContain("Genesis shell");
  });

  it("flags a genesis shell and names the file safely", () => {
    const genesis = buildIdentityCredentialMarkdown({ ...base, shellVersion: 1, genesisDefault: true });
    expect(genesis).toContain("Genesis shell");
    expect(genesis).toContain("your account password opens it");
    expect(genesis).not.toContain("will NOT open");
    expect(credentialFileName("mi ke/..")).toBe("swarm-identity-mi_ke_.md");
  });
});
